/**
 * Extension enhancement module for tools & system prompt filtering and context interceptors.
 */

import type { ContextEvent, ContextEventResult, ExtensionContext } from "./types.ts";

export interface ExtensionContextHandlerItem {
	handlers: Map<
		string,
		Array<(event: ContextEvent, ctx: ExtensionContext) => Promise<ContextEventResult> | ContextEventResult>
	>;
	path: string;
}

export interface EnhancedContextResult<T = any> {
	systemPrompt?: string;
	tools?: T[];
}

/**
 * Filter tools & systemPrompt across loaded extensions using context event.
 */
export async function filterContextWithExtensions<T = any>(
	extensions: ExtensionContextHandlerItem[],
	ctx: ExtensionContext,
	options: { systemPrompt?: string; tools?: T[] },
	onError?: (errorInfo: { extensionPath: string; event: string; error: string; stack?: string }) => void,
): Promise<EnhancedContextResult<T>> {
	if (extensions.length === 0) return options;

	let currentTools = options.tools ? options.tools.slice() : undefined;
	let currentSystemPrompt = options.systemPrompt;

	for (const ext of extensions) {
		const handlers = ext.handlers.get("context");
		if (!handlers || handlers.length === 0) continue;

		for (const handler of handlers) {
			try {
				const event: ContextEvent = {
					type: "context",
					messages: [],
					tools: currentTools ? currentTools.slice() : undefined,
					systemPrompt: currentSystemPrompt,
				};
				const handlerResult = await handler(event, ctx);

				if (handlerResult) {
					const res = handlerResult as ContextEventResult;
					if (res.tools !== undefined) {
						currentTools = res.tools as T[];
					}
					if (typeof res.systemPrompt === "string") {
						currentSystemPrompt = res.systemPrompt;
					}
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				const stack = err instanceof Error ? err.stack : undefined;
				onError?.({
					extensionPath: ext.path,
					event: "context",
					error: message,
					stack,
				});
			}
		}
	}

	return {
		systemPrompt: currentSystemPrompt,
		tools: currentTools,
	};
}

export interface ExecuteToolOptions {
	parentToolCallId?: string;
	callerTool?: string;
	signal?: AbortSignal;
	onUpdate?: (partialResult: unknown) => void;
}

export interface ExtensionRunnerLike {
	hasHandlers(event: "tool_call" | "tool_result"): boolean;
	emitToolCall(event: any): Promise<any>;
	emitToolResult(event: any): Promise<any>;
}

/**
 * Execute a registered tool through the extension lifecycle (tool_call and tool_result hooks, agent events).
 */
export async function executeToolWithExtensions(
	runner: ExtensionRunnerLike,
	ctx: ExtensionContext,
	toolName: string,
	input: unknown,
	options?: ExecuteToolOptions,
): Promise<any> {
	const allTools = ctx.getAllToolDefinitions ? ctx.getAllToolDefinitions() : {};
	const toolDef = allTools[toolName];
	if (!toolDef) {
		throw new Error(`Tool not found: ${toolName}`);
	}

	const toolCallId = options?.parentToolCallId
		? `${options.parentToolCallId}:${toolName}:${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
		: `${toolName}:${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

	const execInput = typeof input === "object" && input !== null ? { ...(input as object) } : (input as any);

	if (runner.hasHandlers("tool_call")) {
		const hookResult = await runner.emitToolCall({
			type: "tool_call",
			toolName,
			toolCallId,
			parentToolCallId: options?.parentToolCallId,
			callerTool: options?.callerTool,
			input: execInput,
		});

		if (hookResult) {
			if (hookResult.block) {
				throw new Error(hookResult.reason || `Tool execution blocked: ${toolName}`);
			}
		}
	}

	ctx.emitAgentEvent?.({
		type: "tool_execution_start",
		toolCallId,
		toolName,
		args: execInput,
	} as any);

	const onUpdate = (partialResult: unknown) => {
		options?.onUpdate?.(partialResult);
		ctx.emitAgentEvent?.({
			type: "tool_execution_update",
			toolCallId,
			toolName,
			args: execInput,
			partialResult,
		} as any);
	};

	let res: any;
	let isError = false;

	try {
		res = await toolDef.execute(toolCallId, execInput, options?.signal ?? ctx.signal, onUpdate, ctx);

		ctx.emitAgentEvent?.({
			type: "tool_execution_end",
			toolCallId,
			toolName,
			result: res,
			isError: false,
		} as any);
	} catch (err) {
		isError = true;
		const errorMsg = err instanceof Error ? err.message : String(err);
		const errorResult = { content: [{ type: "text" as const, text: errorMsg }], details: {} };

		ctx.emitAgentEvent?.({
			type: "tool_execution_end",
			toolCallId,
			toolName,
			result: errorResult,
			isError: true,
		} as any);

		throw err;
	} finally {
		if (runner.hasHandlers("tool_result")) {
			try {
				const hookResult = await runner.emitToolResult({
					type: "tool_result",
					toolName,
					toolCallId,
					input: execInput,
					content: res?.content,
					details: res?.details,
					isError,
					usage: res?.usage,
				});

				if (hookResult && res && typeof res === "object") {
					if (hookResult.content) res.content = hookResult.content;
					if (hookResult.details) res.details = hookResult.details;
				}
			} catch (_e) {
				// Ignore hook error
			}
		}
	}

	return res;
}
