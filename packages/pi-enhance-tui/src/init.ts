/**
 * Initialization and activation helper for pi-enhance-tui.
 * Dynamically enhances TUI components with minimal footprint on upstream sources.
 */

import { Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { FastTextMeasureEngine } from "./measure.ts";
import { createStartupHero } from "./ui/banner.ts";
import { renderCardBox } from "./ui/card-box.ts";
import { SPINNER_FRAMES } from "./ui/spinner.ts";
import { BunTerminalWriter } from "./writer.ts";

let footerSuppressed = false;

export function setFooterSuppressed(suppressed: boolean): void {
	footerSuppressed = suppressed;
}

export function isFooterSuppressed(): boolean {
	return footerSuppressed;
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
				contentLines: rawLines,
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
					this.contentContainer.addChild(
						new Markdown(content.text.trim(), this.outputPad, 0, this.markdownTheme, undefined, {
							transform: this.markdownTransformers?.length
								? (token: any) => {
										let result = token;
										for (const t of this.markdownTransformers) {
											result = t("assistant", result, this.isStreaming) ?? result;
										}
										return result;
									}
								: undefined,
						}),
					);
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
								transform: this.markdownTransformers?.length
									? (token: any) => {
											let result = token;
											for (const t of this.markdownTransformers) {
												result = t("assistant-thinking", result, this.isStreaming) ?? result;
											}
											return result;
										}
									: undefined,
							},
						);

						const streaming = this.isStreaming;
						const thinkingCard = {
							render: (w: number): string[] => {
								const lines = thinkingMarkdown.render(Math.max(20, w - 4));
								const card = renderCardBox({
									title: "Thinking",
									variant: "thinking",
									status: streaming ? "running" : "default",
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

		function updateSpinnerState(comp: any) {
			if (comp.isPartial && comp.executionStarted) {
				if (!comp.__spinnerInterval) {
					comp.__spinnerFrame = 0;
					comp.__spinnerInterval = setInterval(() => {
						comp.__spinnerFrame = ((comp.__spinnerFrame ?? 0) + 1) % SPINNER_FRAMES.length;
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

		ToolClass.prototype.updateResult = function (this: any, result: any) {
			origUpdateResult.call(this, result);
			updateSpinnerState(this);
		};

		ToolClass.prototype.render = function (this: any, width: number): string[] {
			if (this.hideComponent) return [];

			let rawLines: string[];
			if (this.hasRendererDefinition?.() && this.getRenderShell?.() === "self") {
				rawLines = this.selfRenderContainer.render(width);
			} else {
				rawLines = origToolRender.call(this, width);
				if (rawLines.length > 0 && rawLines[0] === "") {
					rawLines = rawLines.slice(1);
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

			const frame = this.__spinnerFrame ?? 0;
			const cardLines = renderCardBox({
				toolName: this.toolName,
				status,
				spinnerFrame: SPINNER_FRAMES[frame],
				contentLines: rawLines,
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
		});
	}

	// 6. InteractiveMode startup hero
	if (options?.InteractiveMode) {
		const ModeClass = options.InteractiveMode;
		const origInit = ModeClass.prototype.init;
		ModeClass.prototype.init = async function (this: any) {
			if (this.session && this.headerContainer) {
				this.builtInHeader = createStartupHero(() => this.session.model, this.version);
				if (this.headerContainer.children?.length > 1) {
					this.headerContainer.children[1] = this.builtInHeader;
				}
			}
			return origInit.call(this);
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
