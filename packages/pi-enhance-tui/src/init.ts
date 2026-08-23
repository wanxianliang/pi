/**
 * Initialization and activation helper for pi-enhance-tui.
 * Dynamically enhances TUI components with minimal footprint on upstream sources.
 */

import { Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { FastTextMeasureEngine } from "./measure.ts";
import { createStartupHero } from "./ui/banner.ts";
import { renderCardBox } from "./ui/card-box.ts";
import { SPINNER_FRAMES } from "./ui/spinner.ts";
import { PALETTE } from "./ui/theme.ts";
import { formatToolExecutionLines } from "./ui/tool-card.ts";
import { BunTerminalWriter } from "./writer.ts";

let footerSuppressed = false;

export function setFooterSuppressed(suppressed: boolean): void {
	footerSuppressed = suppressed;
}

export function isFooterSuppressed(): boolean {
	return footerSuppressed;
}

export function getMaxVisibleMessages(): number {
	const envVal = process.env.PI_MAX_VISIBLE_MESSAGES;
	if (envVal !== undefined) {
		const parsed = Number.parseInt(envVal, 10);
		if (Number.isFinite(parsed) && parsed >= 0) {
			return parsed;
		}
	}
	return 50; // default 50 (allows retaining multiple tool-calling turns before folding)
}

export interface EnhanceTuiOptions {
	enableBunWriter?: boolean;
	enableFastMeasure?: boolean;
	enableHighlighting?: boolean;
	UserMessageComponent?: any;
	AssistantMessageComponent?: any;
	ToolExecutionComponent?: any;
	FooterComponent?: any;
	InteractiveMode?: any;
	ProcessTerminal?: any;
	theme?: any;
}

export interface EnhanceTuiInstance {
	writer?: InstanceType<typeof BunTerminalWriter>;
	measureEngine?: InstanceType<typeof FastTextMeasureEngine>;
	restore(): void;
}

export function initPiEnhanceTui(options?: EnhanceTuiOptions): EnhanceTuiInstance {
	const enableBunWriter = options?.enableBunWriter ?? true;
	const enableFastMeasure = options?.enableFastMeasure ?? true;
	const restorers: Array<() => void> = [];

	let writer: InstanceType<typeof BunTerminalWriter> | undefined;
	let measureEngine: InstanceType<typeof FastTextMeasureEngine> | undefined;

	if (enableBunWriter) {
		writer = new BunTerminalWriter();
	}

	if (enableFastMeasure) {
		measureEngine = new FastTextMeasureEngine();
	}

	setFooterSuppressed(true);
	restorers.push(() => setFooterSuppressed(false));

	// 1. ProcessTerminal optimization (Bun stdout writer)
	if (options?.ProcessTerminal && writer?.isBunWriterActive) {
		const TermClass = options.ProcessTerminal;
		const origWrite = TermClass.prototype.write;
		TermClass.prototype.write = function (this: any, data: string): void {
			writer!.write(data);
		};
		restorers.push(() => {
			TermClass.prototype.write = origWrite;
		});
	}

	// 2. FooterComponent suppression hook
	if (options?.FooterComponent) {
		const FooterClass = options.FooterComponent;
		const origFooterRender = FooterClass.prototype.render;
		FooterClass.prototype.render = function (this: any, width: number): string[] {
			if (isFooterSuppressed()) return [];
			return origFooterRender.call(this, width);
		};
		restorers.push(() => {
			FooterClass.prototype.render = origFooterRender;
		});
	}

	const ANSI_BG_REGEX = /\x1b\[(?:4[0-8]|10[0-7]|48;[25];[^m]+)m|\x1b\[49m/g;
	function stripAnsiBackgrounds(lines: string[]): string[] {
		const result: string[] = [];
		for (const line of lines) {
			const clean = line.replace(ANSI_BG_REGEX, "");
			if (clean.includes("\n") || clean.includes("\r")) {
				result.push(...clean.split(/\r\n|\r|\n/));
			} else {
				result.push(clean);
			}
		}
		return result;
	}

	// 3. UserMessageComponent card styling
	if (options?.UserMessageComponent) {
		const UserClass = options.UserMessageComponent;
		const origUserRender = UserClass.prototype.render;
		const OSC133_ZONE_START = "\x1b]133;A\x07";
		const OSC133_ZONE_END = "\x1b]133;B\x07";
		const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

		UserClass.prototype.render = function (this: any, width: number): string[] {
			const contentBox = this.children?.[0];
			const markdown = contentBox?.children?.[0] ?? this.children?.[0];
			const rawLines = markdown ? markdown.render(Math.max(20, width - 4)) : this.text ? [this.text] : [];

			if (rawLines.length === 0) return [];

			const cardLines = renderCardBox({
				title: "You",
				variant: "user",
				contentLines: stripAnsiBackgrounds(rawLines),
				width,
				paddingX: 2,
				limitHeight: false,
			});

			cardLines[0] = OSC133_ZONE_START + cardLines[0];
			cardLines[cardLines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + cardLines[cardLines.length - 1];
			return ["", ...cardLines];
		};
		restorers.push(() => {
			UserClass.prototype.render = origUserRender;
		});
	}

	// Safe markdown transformer runner
	function createTransform(
		messageType: string,
		isStreaming: boolean,
		transformers?: readonly any[],
	): ((markdown: string, availableWidth: number) => string) | undefined {
		if (!transformers || transformers.length === 0) return undefined;
		return (markdown: string, availableWidth: number) => {
			let transformed = markdown;
			for (const t of transformers) {
				try {
					const res = t(transformed, { messageType, isStreaming, availableWidth });
					if (typeof res === "string") transformed = res;
				} catch {}
			}
			return transformed;
		};
	}

	// 4. AssistantMessageComponent thinking card
	if (options?.AssistantMessageComponent) {
		const AssistantClass = options.AssistantMessageComponent;
		const origAssistantUpdateContent = AssistantClass.prototype.updateContent;
		AssistantClass.prototype.updateContent = function (this: any, message: any, isStreaming = this.isStreaming) {
			this.lastMessage = message;
			this.isStreaming = isStreaming;
			this.contentContainer.clear();

			const hasVisibleContent = message.content?.some(
				(c: any) => (c.type === "text" && c.text?.trim()) || (c.type === "thinking" && c.thinking?.trim()),
			);

			if (hasVisibleContent) {
				this.contentContainer.addChild(new Spacer(1));
			}

			for (let i = 0; i < message.content.length; i++) {
				const content = message.content[i];
				if (content.type === "text" && content.text?.trim()) {
					const textMarkdown = new Markdown(content.text.trim(), 0, 0, this.markdownTheme, undefined, {
						transform: createTransform("assistant", this.isStreaming, this.markdownTransformers),
					});
					const streaming = this.isStreaming;
					const assistantCard = {
						render: (w: number): string[] => {
							const contentWidth = Math.max(10, Math.min(w, 120) - 2 - 4);
							const rawLines = textMarkdown.render(contentWidth);
							const cleanLines = stripAnsiBackgrounds(rawLines);
							const frame = SPINNER_FRAMES[Math.floor(Date.now() / 80) % SPINNER_FRAMES.length];
							const card = renderCardBox({
								title: "Pi",
								variant: "assistant",
								status: streaming ? "running" : "default",
								spinnerFrame: frame,
								contentLines: cleanLines,
								width: w,
								paddingX: 2,
								paddingY: 1,
								limitHeight: false,
							});
							return ["", ...card];
						},
						invalidate: () => textMarkdown.invalidate(),
					};
					this.contentContainer.addChild(assistantCard as any);
				} else if (content.type === "thinking") {
					const thinkingBlocks: string[] = [];
					for (; i < message.content.length; i++) {
						const thinkingContent = message.content[i];
						if (thinkingContent.type !== "thinking") break;
						const thinking = thinkingContent.thinking?.trim();
						if (thinking) thinkingBlocks.push(thinking);
					}
					i--;

					if (thinkingBlocks.length === 0) continue;

					if (this.hideThinkingBlock) {
						this.contentContainer.addChild(new Text(this.hiddenThinkingLabel, this.outputPad, 0));
					} else {
						const thinkingMarkdown = new Markdown(
							thinkingBlocks.join("\n\n"),
							0,
							0,
							this.markdownTheme,
							undefined,
							{
								transform: createTransform("assistant-thinking", this.isStreaming, this.markdownTransformers),
							},
						);

						const streaming = this.isStreaming;
						const thinkingCard = {
							render: (w: number): string[] => {
								const lines = thinkingMarkdown.render(Math.max(20, w - 4));
								const frame = SPINNER_FRAMES[Math.floor(Date.now() / 80) % SPINNER_FRAMES.length];
								const card = renderCardBox({
									title: "Thinking",
									variant: "thinking",
									status: streaming ? "running" : "default",
									spinnerFrame: frame,
									contentLines: lines,
									width: w,
									paddingX: 2,
									limitHeight: streaming,
									maxHeightRunning: 8,
								});
								return ["", ...card];
							},
							invalidate: () => thinkingMarkdown.invalidate(),
						};
						this.contentContainer.addChild(thinkingCard as any);
					}
				}
			}

			const hasToolCalls = message.content?.some((c: any) => c.type === "toolCall");
			this.hasToolCalls = hasToolCalls;
			if (message.stopReason === "length") {
				this.contentContainer.addChild(new Spacer(1));
				this.contentContainer.addChild(new Text("Response was truncated before completion.", this.outputPad, 0));
			} else if (!hasToolCalls) {
				if (message.stopReason === "aborted") {
					const abortMessage =
						message.errorMessage && message.errorMessage !== "Request was aborted"
							? message.errorMessage
							: "Operation aborted";
					this.contentContainer.addChild(new Spacer(1));
					this.contentContainer.addChild(new Text(abortMessage, this.outputPad, 0));
				} else if (message.stopReason === "error") {
					const errorMsg = message.errorMessage || "Unknown error";
					this.contentContainer.addChild(new Spacer(1));
					this.contentContainer.addChild(new Text(`Error: ${errorMsg}`, this.outputPad, 0));
				}
			}
		};
		restorers.push(() => {
			AssistantClass.prototype.updateContent = origAssistantUpdateContent;
		});
	}

	// 5. ToolExecutionComponent card styling & animated spinner
	if (options?.ToolExecutionComponent) {
		const ToolClass = options.ToolExecutionComponent;
		const origToolRender = ToolClass.prototype.render;
		const origUpdateArgs = ToolClass.prototype.updateArgs;
		const origUpdateResult = ToolClass.prototype.updateResult;
		const origMarkExecutionStarted = ToolClass.prototype.markExecutionStarted;
		const origSetArgsComplete = ToolClass.prototype.setArgsComplete;

		function updateSpinnerState(comp: any) {
			if (comp.isPartial && comp.executionStarted) {
				if (!comp.__spinnerInterval) {
					comp.__spinnerInterval = setInterval(() => {
						comp.ui?.requestRender?.();
					}, 80);
				}
			} else if (comp.__spinnerInterval) {
				clearInterval(comp.__spinnerInterval);
				comp.__spinnerInterval = undefined;
			}
		}

		ToolClass.prototype.updateArgs = function (this: any, args: any, isComplete = false) {
			origUpdateArgs.call(this, args, isComplete);
			updateSpinnerState(this);
		};

		ToolClass.prototype.markExecutionStarted = function (this: any) {
			origMarkExecutionStarted?.call(this);
			updateSpinnerState(this);
		};

		ToolClass.prototype.setArgsComplete = function (this: any) {
			origSetArgsComplete?.call(this);
			updateSpinnerState(this);
		};

		ToolClass.prototype.updateResult = function (this: any, result: any, isPartial = false) {
			origUpdateResult.call(this, result, isPartial);
			updateSpinnerState(this);
		};

		ToolClass.prototype.render = function (this: any, width: number): string[] {
			if (this.hideComponent) return [];

			let rawLines: string[];
			if (this.hasRendererDefinition?.() && this.getRenderShell?.() === "self") {
				rawLines = this.selfRenderContainer.render(width);
			} else {
				rawLines = formatToolExecutionLines(this.toolName, this.args, this.result);
				if (rawLines.length === 0) {
					rawLines = origToolRender.call(this, width);
					if (rawLines.length > 0 && rawLines[0] === "") {
						rawLines = rawLines.slice(1);
					}
				}
			}

			if (rawLines.length === 0 && (!this.imageComponents || this.imageComponents.length === 0)) {
				return [];
			}

			const status = this.isPartial
				? this.executionStarted
					? "running"
					: "pending"
				: this.result?.isError
					? "error"
					: "success";

			const frame = SPINNER_FRAMES[Math.floor(Date.now() / 80) % SPINNER_FRAMES.length];
			const cardLines = renderCardBox({
				toolName: this.toolName,
				status,
				spinnerFrame: frame,
				contentLines: stripAnsiBackgrounds(rawLines),
				width,
				isExpanded: this.expanded,
				paddingX: 2,
				maxHeightRunning: 10,
				maxHeightFinished: 10,
			});

			const lines: string[] = ["", ...cardLines];

			if (this.imageComponents) {
				for (let i = 0; i < this.imageComponents.length; i++) {
					const spacer = this.imageSpacers?.[i];
					if (spacer) lines.push(...spacer.render(width));
					const imageComponent = this.imageComponents[i];
					if (imageComponent) lines.push(...imageComponent.render(width));
				}
			}

			return lines;
		};

		restorers.push(() => {
			ToolClass.prototype.render = origToolRender;
			ToolClass.prototype.updateArgs = origUpdateArgs;
			ToolClass.prototype.updateResult = origUpdateResult;
			if (origMarkExecutionStarted) ToolClass.prototype.markExecutionStarted = origMarkExecutionStarted;
			if (origSetArgsComplete) ToolClass.prototype.setArgsComplete = origSetArgsComplete;
		});
	}

	// 6. InteractiveMode startup hero & windowed chat history
	if (options?.InteractiveMode) {
		const ModeClass = options.InteractiveMode;
		const origInit = ModeClass.prototype.init;
		ModeClass.prototype.init = async function (this: any) {
			const res = await origInit.call(this);
			if (this.loadedResourcesContainer) {
				this.loadedResourcesContainer.clear();
			}
			if (this.headerContainer && (!this.settingsManager || !this.settingsManager.getQuietStartup())) {
				const hero = createStartupHero(() => this.session?.model, this.version);
				this.builtInHeader = hero;
				if (this.headerContainer.children?.length >= 2) {
					this.headerContainer.children[1] = hero;
				} else if (this.headerContainer.children?.length === 1) {
					this.headerContainer.children[0] = hero;
				} else {
					this.headerContainer.addChild(hero);
				}
			}

			// Windowed chat container rendering (default 25 latest messages/cards)
			if (this.chatContainer && !this.chatContainer.__piEnhanceTuiWindowed) {
				const container = this.chatContainer;
				const origChatRender = container.render.bind(container);
				const origChatInvalidate = container.invalidate?.bind(container);

				container.render = function (width: number): string[] {
					const maxVisible = getMaxVisibleMessages();
					if (maxVisible <= 0 || this.children.length <= maxVisible) {
						return origChatRender(width);
					}
					const hiddenCount = this.children.length - maxVisible;
					const visibleChildren = this.children.slice(hiddenCount);

					const lines: string[] = [
						PALETTE.muted(`... (已折叠 ${hiddenCount} 条早期历史消息，完整上下文仍在 LLM 记忆中)`),
						"",
					];
					for (const child of visibleChildren) {
						const childLines = child.render(width);
						for (const line of childLines) {
							lines.push(line);
						}
					}
					return lines;
				};

				if (origChatInvalidate) {
					container.invalidate = function (): void {
						const maxVisible = getMaxVisibleMessages();
						if (maxVisible <= 0 || this.children.length <= maxVisible) {
							origChatInvalidate();
							return;
						}
						const visibleChildren = this.children.slice(this.children.length - maxVisible);
						for (const child of visibleChildren) {
							child.invalidate?.();
						}
					};
				}

				container.__piEnhanceTuiWindowed = true;
				restorers.push(() => {
					container.render = origChatRender;
					if (origChatInvalidate) container.invalidate = origChatInvalidate;
					delete container.__piEnhanceTuiWindowed;
				});
			}

			this.ui?.requestRender?.();
			return res;
		};
		restorers.push(() => {
			ModeClass.prototype.init = origInit;
		});
	}

	return {
		writer,
		measureEngine,
		restore() {
			for (const r of restorers) {
				try {
					r();
				} catch {}
			}
		},
	};
}
