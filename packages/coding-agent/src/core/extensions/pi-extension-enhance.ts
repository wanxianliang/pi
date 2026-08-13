/**
 * Extension enhancement module for tools & system prompt filtering and context interceptors.
 */

import * as fs from "node:fs";
import { createSyntheticSourceInfo } from "../source-info.ts";
import type { ContextEvent, ContextEventResult, ExtensionContext } from "./types.ts";

const ENHANCE_CONFIG_PATH = "/Users/sean/Documents/node-base/pi-agent-suite/config/pi-enhance.json";

export interface PiEnhanceConfig {
	skills?: { enabled?: boolean; disabledNames?: string[] };
	extensions?: { enabled?: boolean; disabledNames?: string[] };
	tools?: { enabled?: boolean; builtinEnabled?: boolean; pluginEnabled?: boolean; disabledNames?: string[] };
	webPort?: number;
}

export function loadEnhanceConfig(): PiEnhanceConfig {
	try {
		if (fs.existsSync(ENHANCE_CONFIG_PATH)) {
			return JSON.parse(fs.readFileSync(ENHANCE_CONFIG_PATH, "utf-8"));
		}
	} catch {
		// Ignore
	}
	return {
		skills: { enabled: true, disabledNames: [] },
		extensions: { enabled: true, disabledNames: [] },
		tools: { enabled: true, builtinEnabled: true, pluginEnabled: true, disabledNames: [] },
		webPort: 10240,
	};
}

export function isToolEnabledInConfig(name: string, isBuiltin?: boolean): boolean {
	const cfg = loadEnhanceConfig();
	if (cfg.tools?.enabled === false) return false;
	const builtin = isBuiltin ?? ["read", "bash", "edit", "write"].includes(name);
	if (builtin && cfg.tools?.builtinEnabled === false) return false;
	if (!builtin && cfg.tools?.pluginEnabled === false) return false;
	if (cfg.tools?.disabledNames?.includes(name)) return false;
	return true;
}

export function buildAllToolsCatalog(
	baseToolDefinitions?: Map<string, any>,
	extensionRunner?: any,
	customTools?: any[],
): any[] {
	const map = new Map<string, any>();
	if (baseToolDefinitions) {
		for (const [name, definition] of baseToolDefinitions.entries()) {
			map.set(name, {
				name: definition.name,
				description: definition.description,
				parameters: definition.parameters,
				promptGuidelines: definition.promptGuidelines,
				sourceInfo: createSyntheticSourceInfo(`<builtin:${name}>`, { source: "builtin" }),
			});
		}
	}
	if (extensionRunner) {
		for (const tool of extensionRunner.getAllRegisteredTools()) {
			map.set(tool.definition.name, {
				name: tool.definition.name,
				description: tool.definition.description,
				parameters: tool.definition.parameters,
				promptGuidelines: tool.definition.promptGuidelines,
				sourceInfo: tool.sourceInfo,
			});
		}
	}
	if (customTools) {
		for (const tool of customTools) {
			map.set(tool.name, {
				name: tool.name,
				description: tool.description,
				parameters: tool.parameters,
				promptGuidelines: tool.promptGuidelines,
				sourceInfo: createSyntheticSourceInfo(`<sdk:${tool.name}>`, { source: "sdk" }),
			});
		}
	}
	return Array.from(map.values());
}

export function filterAllToolDefinitions(
	baseToolDefinitions?: Map<string, any>,
	toolDefinitions?: Map<string, any>,
): Record<string, any> {
	const map: Record<string, any> = {};
	if (baseToolDefinitions) {
		for (const [name, tool] of baseToolDefinitions.entries()) {
			if (isToolEnabledInConfig(name, true)) {
				map[name] = tool;
			}
		}
	}
	if (toolDefinitions) {
		for (const [name, entry] of toolDefinitions.entries()) {
			if (isToolEnabledInConfig(name, false)) {
				map[name] = entry.definition;
			}
		}
	}
	return map;
}

export function filterEnabledExtensionPaths(extensionPaths: string[]): string[] {
	const cfg = loadEnhanceConfig();
	if (cfg.extensions?.enabled === false) {
		return extensionPaths.filter((p) => p === "pi-manager" || p.includes("pi-manager"));
	}
	const disabled = cfg.extensions?.disabledNames;
	if (disabled && disabled.length > 0) {
		return extensionPaths.filter((p) => {
			if (p === "pi-manager" || p.includes("pi-manager")) return true;

			const segments = p.split(/[\\/]/);
			const fileName = segments[segments.length - 1] || "";
			const fileStem = fileName.replace(/\.(ts|js|json)$/, "");

			for (const dis of disabled) {
				if (!dis) continue;
				if (dis === p || dis === fileName || dis === fileStem || segments.includes(dis)) {
					return false;
				}
			}
			return true;
		});
	}
	return extensionPaths;
}

export function filterEnabledSkillPaths(skillPaths: string[]): string[] {
	const cfg = loadEnhanceConfig();
	if (cfg.skills?.enabled === false) {
		return [];
	}
	const disabled = cfg.skills?.disabledNames;
	if (disabled && disabled.length > 0) {
		return skillPaths.filter((p) => {
			const segments = p.split(/[\\/]/);
			const fileName = segments[segments.length - 1] || "";
			const fileStem = fileName.replace(/\.(md|json)$/, "");

			for (const dis of disabled) {
				if (!dis) continue;
				if (dis === p || dis === fileName || dis === fileStem || segments.includes(dis)) {
					return false;
				}
			}
			return true;
		});
	}
	return skillPaths;
}

export function filterEnabledSkills<T extends { name: string }>(skills: T[]): T[] {
	const cfg = loadEnhanceConfig();
	if (cfg.skills?.enabled === false) {
		return [];
	}
	const disabled = cfg.skills?.disabledNames;
	if (disabled && disabled.length > 0) {
		return skills.filter((s) => !disabled.includes(s.name));
	}
	return skills;
}

export function filterEnabledExtensions<T extends { extensions: any[] }>(baseResult: T): T {
	const cfg = loadEnhanceConfig();
	let exts = baseResult.extensions ? baseResult.extensions.slice() : [];

	if (cfg.extensions?.enabled === false) {
		exts = exts.filter(
			(ext: any) => ext.name === "pi-manager" || (typeof ext.path === "string" && ext.path.includes("pi-manager")),
		);
	} else if (cfg.extensions?.disabledNames && cfg.extensions.disabledNames.length > 0) {
		const disabled = cfg.extensions.disabledNames;
		exts = exts.filter((ext: any) => {
			const extName = ext.name || "";
			const extPath = typeof ext.path === "string" ? ext.path : "";
			if (extName === "pi-manager" || extPath.includes("pi-manager")) return true;

			const segments = extPath.split(/[\\/]/);
			const fileName = segments[segments.length - 1] || "";
			const fileStem = fileName.replace(/\.(ts|js|json)$/, "");

			for (const dis of disabled) {
				if (!dis) continue;
				if (dis === extName || dis === extPath || dis === fileName || dis === fileStem || segments.includes(dis)) {
					return false;
				}
			}
			return true;
		});
	}

	// 确保 pi-manager 管理插件始终置顶在 Index 0
	const managerIndex = exts.findIndex(
		(ext: any) => ext.name === "pi-manager" || (typeof ext.path === "string" && ext.path.includes("pi-manager")),
	);
	if (managerIndex > 0) {
		const [mgr] = exts.splice(managerIndex, 1);
		exts.unshift(mgr);
	}

	return {
		...baseResult,
		extensions: exts,
	};
}

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
	if (!isToolEnabledInConfig(toolName)) {
		throw new Error(`Tool is disabled: ${toolName}`);
	}
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
