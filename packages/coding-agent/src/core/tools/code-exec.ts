import { Text } from "@earendil-works/pi-tui";
import { createRequire } from "module";
import { type Static, Type } from "typebox";
import type { ExtensionContext, ToolDefinition } from "../extensions/types.ts";

const require = createRequire(import.meta.url);

const codeExecSchema = Type.Object({
	code: Type.String({ description: "JavaScript code to execute in the pi agent runtime" }),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" })),
});

export type CodeExecInput = Static<typeof codeExecSchema>;

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

			const allTools = {
				...tools,
				...(getExtraTools ? getExtraTools() : {}),
			};

			for (const [name, toolDef] of Object.entries(allTools)) {
				pi[name] = async (params: unknown) => {
					if (signal?.aborted) {
						return Promise.reject(new Error("aborted"));
					}
					const res = await toolDef.execute(`${name}-${Date.now()}`, params, signal, undefined, ctx!);
					if (res && Array.isArray(res.content)) {
						return res.content
							.filter((c: any) => c && typeof c.text === "string")
							.map((c: any) => c.text)
							.join("\n");
					}
					return res;
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
				// Create an async function to support await, require and process
				const AsyncFunction = (async () => {}).constructor as new (
					...args: string[]
				) => (...args: any[]) => Promise<any>;
				const fn = new AsyncFunction("pi", "console", "require", "process", code);
				const result = timeoutPromise
					? await Promise.race([fn(pi, customConsole, require, process), timeoutPromise])
					: await fn(pi, customConsole, require, process);

				let output = "";
				if (logs.length > 0) {
					if (result !== undefined) {
						const resultStr = typeof result === "object" ? JSON.stringify(result, null, 2) : String(result);
						output = `[stdout]\n${logs.join("\n")}\n\n[return]\n${resultStr}`;
					} else {
						output = logs.join("\n");
					}
				} else if (result !== undefined) {
					output = typeof result === "object" ? JSON.stringify(result, null, 2) : String(result);
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
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const formattedCode = args.code ? `\n${args.code}` : "";
			text.setText(`code_exec:${formattedCode}`);
			return text;
		},
	};
}
