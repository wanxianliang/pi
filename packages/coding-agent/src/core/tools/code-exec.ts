import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import chalk from "chalk";
import { createRequire } from "module";
import { type Static, Type } from "typebox";
import { highlightCode } from "../../modes/interactive/theme/theme.ts";
import type { ExtensionContext, ToolDefinition } from "../extensions/types.ts";

const require = createRequire(import.meta.url);

const codeExecSchema = Type.Object({
	code: Type.String({ description: "JavaScript code to execute in the pi agent runtime" }),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" })),
});

export type CodeExecInput = Static<typeof codeExecSchema>;

export function formatBashTruncatedOutput(text: string): string {
	const envMaxLines = process.env.CODE_EXEC_BASH_MAX_LINES || process.env.PI_CODE_EXEC_BASH_MAX_LINES;
	const threshold = envMaxLines ? parseInt(envMaxLines, 10) : 100;
	const maxLines = Number.isFinite(threshold) && threshold > 0 ? threshold : 100;

	const lines = text.split("\n");
	if (lines.length <= maxLines) {
		return text;
	}

	const tmpDir = existsSync("/tmp") ? "/tmp" : tmpdir();
	if (!existsSync(tmpDir)) {
		mkdirSync(tmpDir, { recursive: true });
	}

	const fileName = `code_exec_bash_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.log`;
	const filePath = join(tmpDir, fileName);
	writeFileSync(filePath, text, "utf8");

	const first5 = lines.slice(0, 5).join("\n");
	const last30Count = Math.min(30, Math.max(0, lines.length - 5));
	const last30 = lines.slice(lines.length - last30Count).join("\n");
	const omittedCount = lines.length - 5 - last30Count;

	const parts = [
		`[Output truncated: total ${lines.length} lines exceeds threshold of ${maxLines} lines. Full output saved to ${filePath}]`,
		"",
		"First 5 lines:",
		first5,
	];

	if (omittedCount > 0) {
		parts.push("", `... [${omittedCount} lines omitted, full output at ${filePath}] ...`);
	}

	parts.push("", "Last 30 lines:", last30);

	return parts.join("\n");
}

/**
 * Create a `code_exec` tool definition that executes JavaScript code in the pi agent runtime.
 * The executed code has access to a `pi` object with methods that wrap all registered tool
 * `execute()` calls, enabling parallel execution via Promise.all and conditional logic via
 * standard JavaScript if/else.
 *
 * Tool methods shadow the tool name: `pi.read(params)`, `pi.bash(params)`, etc.
 * Each returns a Promise resolving to the full `AgentToolResult` (with `content`, `details`).
 *
 * @param tools - Record of all registered tool definitions, keyed by tool name
 */
export function createCodeExecToolDefinition(
	tools: Record<string, ToolDefinition<any, any, any>>,
	getExtraTools?: () => Record<string, ToolDefinition<any, any, any>>,
): ToolDefinition<typeof codeExecSchema> {
	return {
		name: "code_exec",
		label: "code_exec",
		description:
			"Execute JavaScript code to coordinate and orchestrate basic pi tools (pi.read, pi.bash, pi.write, etc.). " +
			"Prefer this tool over sequential single tool calls to achieve maximum execution efficiency and minimize turn overhead.",
		promptSnippet:
			"Coordinate and orchestrate basic pi tools (pi.read, pi.bash, pi.write) using JavaScript to boost efficiency",
		promptGuidelines: [],
		parameters: codeExecSchema,
		executionMode: "sequential" as const,
		async execute(
			_toolCallId: string,
			{ code, timeout }: { code: string; timeout?: number },
			signal?: AbortSignal,
			_onUpdate?: any,
			ctx?: ExtensionContext,
		) {
			const pi: Record<string, (params: unknown) => Promise<unknown>> = {};
			const bashOutputs = new Set<string>();
			const bashErrors = new Set<Error>();

			const allTools = {
				...tools,
				...(getExtraTools ? getExtraTools() : {}),
			};

			for (const [name, toolDef] of Object.entries(allTools)) {
				pi[name] = async (params: unknown) => {
					if (signal?.aborted) {
						return Promise.reject(new Error("aborted"));
					}
					let res: any;
					try {
						res = await toolDef.execute(`${name}-${Date.now()}`, params, signal, undefined, ctx!);
					} catch (err) {
						if (name === "bash" && err instanceof Error) {
							bashErrors.add(err);
						}
						throw err;
					}
					let text: string | undefined;
					if (res && Array.isArray(res.content)) {
						text = res.content
							.filter((c: any) => c && typeof c.text === "string")
							.map((c: any) => c.text)
							.join("\n");
					} else if (typeof res === "string") {
						text = res;
					}

					if (name === "bash" && text !== undefined) {
						bashOutputs.add(text);
						return text;
					}
					return text ?? res;
				};
			}

			let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
			const timeoutPromise =
				timeout !== undefined
					? new Promise<never>((_, reject) => {
							timeoutHandle = setTimeout(() => reject(new Error(`timeout:${timeout}`)), timeout * 1000);
						})
					: undefined;

			const logs: string[] = [];
			const formatLog =
				(prefix = "") =>
				(...args: any[]) => {
					const msg = args.map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : String(arg))).join(" ");
					logs.push(prefix ? `[${prefix}] ${msg}` : msg);
				};
			const customConsole = {
				log: formatLog(),
				info: formatLog(),
				warn: formatLog("WARN"),
				error: formatLog("ERROR"),
			};

			try {
				// Create an async function to support await, require, process, fs, and path
				const AsyncFunction = (async () => {}).constructor as new (
					...args: string[]
				) => (...args: any[]) => Promise<any>;
				const fn = new AsyncFunction("pi", "console", "require", "process", "fs", "path", code);
				const nodeFs = require("node:fs");
				const nodePath = require("node:path");
				const result = timeoutPromise
					? await Promise.race([fn(pi, customConsole, require, process, nodeFs, nodePath), timeoutPromise])
					: await fn(pi, customConsole, require, process, nodeFs, nodePath);

				let output = "";
				if (logs.length > 0) {
					if (result !== undefined) {
						let resultStr = typeof result === "object" ? JSON.stringify(result, null, 2) : String(result);
						if (typeof result === "string" && bashOutputs.has(result)) {
							resultStr = formatBashTruncatedOutput(result);
						}
						output = `[stdout]\n${logs.join("\n")}\n\n[return]\n${resultStr}`;
					} else {
						output = logs.join("\n");
					}
				} else if (result !== undefined) {
					if (typeof result === "string" && bashOutputs.has(result)) {
						output = formatBashTruncatedOutput(result);
					} else {
						output = typeof result === "object" ? JSON.stringify(result, null, 2) : String(result);
					}
				} else {
					output = "Success";
				}
				return {
					content: [
						{
							type: "text" as const,
							text: output,
						},
					],
					details: {
						code,
					},
				};
			} catch (err) {
				if (err instanceof Error && bashErrors.has(err)) {
					err.message = formatBashTruncatedOutput(err.message);
				}
				const message = err instanceof Error ? err.message : String(err);
				if (message.startsWith("timeout:")) {
					const timeoutSecs = message.split(":")[1];
					throw new Error(`Code execution timed out after ${timeoutSecs} seconds`);
				}
				throw new Error(`Code execution failed: ${message}`);
			} finally {
				if (timeoutHandle) clearTimeout(timeoutHandle);
			}
		},
		renderCall(args, _theme, context) {
			const state = context.state;
			let spinnerStr = "";
			if (context.isPartial) {
				if (context.executionStarted) {
					const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
					if (!state.spinnerInterval) {
						state.spinnerFrame = 0;
						state.spinnerInterval = setInterval(() => {
							state.spinnerFrame = (state.spinnerFrame + 1) % frames.length;
							context.invalidate();
						}, 80);
					}
					spinnerStr = ` ${chalk.yellow(frames[state.spinnerFrame])} ${chalk.gray("Running...")}`;
				} else {
					spinnerStr = ` ${chalk.gray("Writing code...")}`;
				}
			} else {
				if (state.spinnerInterval) {
					clearInterval(state.spinnerInterval);
					state.spinnerInterval = undefined;
				}
			}

			const container = (context.lastComponent as Container | undefined) ?? new Container();
			container.clear();

			const headerText = new Text(`${chalk.hex("#C0392B").bold("code_exec")}${spinnerStr}`, 0, 0);
			container.addChild(headerText);

			if (args.code) {
				container.addChild(new Spacer(1));
				const lines = highlightCode(args.code, "javascript");
				for (const line of lines) {
					container.addChild(new Text(`  ${line}`, 0, 0));
				}
			}
			return container;
		},
		renderResult(result, _options, _theme, context) {
			if (context.state.spinnerInterval) {
				clearInterval(context.state.spinnerInterval);
				context.state.spinnerInterval = undefined;
			}
			const container = (context.lastComponent as Container | undefined) ?? new Container();
			container.clear();

			const outputBlock = result.content.find((c: any) => c.type === "text") as any;
			if (outputBlock?.text) {
				container.addChild(new Spacer(1));
				container.addChild(new Text(chalk.bold("Result:"), 0, 0));
				const lines = (outputBlock.text as string).split("\n");
				for (const line of lines) {
					container.addChild(new Text(`  ${line}`, 0, 0));
				}
			}
			return container;
		},
	};
}
