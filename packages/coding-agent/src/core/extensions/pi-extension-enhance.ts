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
