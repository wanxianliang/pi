import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";

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
): ToolDefinition<typeof codeExecSchema> {
	return {
		name: "code_exec",
		label: "code_exec",
		description:
			"Execute JavaScript code in the pi agent runtime. " +
			"The code has access to a `pi` object with methods for all available tools: " +
			"pi.read(params), pi.bash(params), pi.edit(params), pi.write(params), " +
			"pi.grep(params), pi.find(params), pi.ls(params). " +
			"Each method returns a Promise resolving to the tool result content. " +
			"Supports Promise.all() for parallel execution and standard JavaScript if/else " +
			"for conditional logic.",
		promptSnippet: "Execute JavaScript code (pi.read, pi.bash, pi.find, etc.)",
		promptGuidelines: [
			"Use pi.read({ path }) to read files",
			"Use pi.bash({ command, timeout? }) to run shell commands",
			"Use pi.edit({ filePath, oldString, newText }) to edit files",
			"Use pi.write({ path, content }) to write files",
			"Use pi.grep({ pattern, path }) to search files",
			"Use pi.find({ path, glob }) to find files",
			"Use pi.ls({ path }) to list directory contents",
			"Use Promise.all([...]) for parallel tool execution",
			"Use standard JavaScript if/else for conditional logic",
		],
		parameters: codeExecSchema,
		executionMode: "sequential" as const,
		async execute(_toolCallId: string, { code, timeout }: { code: string; timeout?: number }, signal?: AbortSignal) {
			const pi: Record<string, (params: unknown) => Promise<unknown>> = {};

			for (const [name, toolDef] of Object.entries(tools)) {
				pi[name] = (params: unknown) => {
					if (signal?.aborted) {
						return Promise.reject(new Error("aborted"));
					}
					return toolDef.execute(`${name}-${Date.now()}`, params, signal, undefined, undefined as any);
				};
			}

			let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
			const timeoutPromise =
				timeout !== undefined
					? new Promise<never>((_, reject) => {
							timeoutHandle = setTimeout(() => reject(new Error(`timeout:${timeout}`)), timeout * 1000);
						})
					: undefined;

			try {
				const fn = new Function("pi", code);
				const result = timeoutPromise ? await Promise.race([fn(pi), timeoutPromise]) : await fn(pi);

				return {
					content: [
						{
							type: "text" as const,
							text: String(result === undefined ? "undefined" : result),
						},
					],
					details: undefined,
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
	};
}
