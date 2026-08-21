import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { getBottomInputIcons } from "./icons.ts";
import { sanitizeTerminalSingleLineText, sanitizeTerminalText } from "./sanitize.ts";
import type {
	AssistantUsage,
	BottomInputFrameStatus,
	BottomInputIconSet,
	BottomInputStatusRender,
	BottomInputStatusState,
	ContextUsage,
	ThemeLike,
} from "./types.ts";

export const CONTEXT_BAR_WIDTH = 10;
const CONTEXT_COLORS = {
	normal: "#00afaf",
	warning: "#febc38",
	error: "#ff5f5f",
	empty: "#444444",
};
const RAINBOW_COLORS = ["#b281d6", "#d787af", "#febc38", "#e4c00f", "#89d281", "#00afaf", "#178fb9", "#b281d6"];
const MAX_NEON_COLORS = ["#f06ecf", "#cf83ed", "#a993ff"];
const INTERNAL_STATUS_KEYS = new Set([
	"pi-ui-custom-bottom-input",
	"pi-ui-custom-bottom-status",
	"pi-ui-custom-last-prompt",
]);

export function renderBottomInputStatus(input: BottomInputStatusState): BottomInputStatusRender {
	const safeWidth = Math.max(1, Math.floor(input.width));
	const enabled = input.beautifiedInputEnabled;
	const extensionStatuses = getVisibleExtensionStatuses(input.footerData);
	if (!enabled) {
		return {
			topLines: [],
			secondaryLines: renderExtensionStatusLines(extensionStatuses, safeWidth, input.theme),
			lastPromptLines: renderLastPromptLines(input.lastPrompt, safeWidth, input.theme),
			frameStatus: emptyFrameStatus(),
			cacheKey: JSON.stringify({
				width: safeWidth,
				enabled: false,
				lastPrompt: input.lastPrompt,
				extensionStatuses,
			}),
		};
	}

	const icons = input.icons ?? getBottomInputIcons();
	const elapsedSeconds = Math.floor(Math.max(0, input.now - input.sessionStartTime) / 1000);
	const usage = readContextUsageSnapshot(input.ctx, input.isStreaming, input.liveUsage, input.latestAssistantUsage);
	const rawUsage = input.liveUsage ?? input.latestAssistantUsage ?? readLatestAssistantUsage(input.ctx);
	const cacheHitRatio = rawUsage ? cacheHitRatioFromUsage(rawUsage) : null;
	const modelName = readModelName(input.ctx);
	const provider = readModelProvider(input.ctx);
	const thinking =
		readThinkingLevel(input.ctx) ?? input.currentThinkingLevel ?? readThinkingLevelFromSession(input.ctx);
	const cacheKey = JSON.stringify({
		width: safeWidth,
		beautifiedInputEnabled: enabled,
		model: modelName,
		provider,
		thinking,
		cacheHitRatio,
		context: usage,
		elapsedSeconds,
		lastPrompt: input.lastPrompt,
		extensionStatuses,
		icons,
	});

	return {
		topLines: [],
		secondaryLines: [],
		lastPromptLines: [],
		frameStatus: renderFrameStatus(
			{ ...input, width: safeWidth, icons },
			modelName,
			provider,
			thinking,
			usage,
			cacheHitRatio,
		),
		cacheKey,
	};
}

export function renderDetailedTokenStatus(
	usage: ContextUsage | null,
	_rawUsage: AssistantUsage | null,
	provider: string | null,
	theme: ThemeLike,
): string | null {
	const parts: string[] = [];

	if (usage?.contextWindow && usage.contextWindow > 0) {
		const percent =
			typeof usage.percent === "number" && Number.isFinite(usage.percent)
				? usage.percent
				: (usage.tokens / usage.contextWindow) * 100;
		const color = contextColor(percent);
		const pctStr = `${percent.toFixed(1)}%/${formatTokens(usage.contextWindow)}`;
		parts.push(applyHexColor(color, pctStr));
	} else if (usage && usage.tokens > 0) {
		parts.push(safeFg(theme, "cyan", formatTokens(usage.tokens)));
	}

	if (provider) {
		parts.push(safeFg(theme, "muted", `(${provider})`));
	}

	if (parts.length === 0) return null;
	return parts.join(" ");
}

export function renderFrameStatus(
	input: BottomInputStatusState & { icons?: BottomInputIconSet },
	modelName = readModelName(input.ctx),
	provider = readModelProvider(input.ctx),
	thinkingLevel = readThinkingLevel(input.ctx) ??
		input.currentThinkingLevel ??
		readThinkingLevelFromSession(input.ctx),
	usage = readContextUsageSnapshot(input.ctx, input.isStreaming, input.liveUsage, input.latestAssistantUsage),
	_cacheHitRatio: number | null = null,
): BottomInputFrameStatus {
	const rawUsage = input.liveUsage ?? input.latestAssistantUsage ?? readLatestAssistantUsage(input.ctx);
	return {
		model: renderModelSegment(modelName, null, input.theme, input.icons ?? getBottomInputIcons()),
		thinking: renderThinkingSegment(thinkingLevel, input.theme),
		context: renderDetailedTokenStatus(usage, rawUsage, provider, input.theme),
		elapsed: renderElapsedSegment(
			input.theme,
			input.sessionStartTime,
			input.now,
			input.icons ?? getBottomInputIcons(),
		),
	};
}

export function renderExtensionStatusLines(statuses: readonly string[], width: number, theme: ThemeLike): string[] {
	const safeStatuses = statuses
		.map((status) => sanitizeTerminalSingleLineText(status, { preserveSgr: false }))
		.filter(Boolean);
	if (safeStatuses.length === 0) return [];
	const separator = safeFg(theme, "borderMuted", " › ");
	const line = ` ${safeStatuses.join(separator)} `;
	return [truncateToWidth(line, Math.max(1, Math.floor(width)), "…", false)];
}

export function renderLastPromptLines(prompt: string, width: number, theme: ThemeLike): string[] {
	const safeWidth = Math.max(1, Math.floor(width));
	const safePrompt = sanitizeTerminalSingleLineText(prompt, { preserveSgr: false });
	if (!safePrompt) return [];

	const prefix = ` ${safeFg(theme, "borderMuted", "↳")} `;
	const availableWidth = safeWidth - visibleWidth(prefix);
	if (availableWidth < 4) return [];

	const value = truncateToWidth(safePrompt, availableWidth, "…", false);
	return [truncateToWidth(`${prefix}${safeFg(theme, "muted", value)}`, safeWidth, "…", false)];
}

export function getVisibleExtensionStatuses(footerData: any): string[] {
	let statuses: unknown;
	try {
		statuses = footerData?.getExtensionStatuses?.();
	} catch {
		return [];
	}
	const entries: Array<[unknown, unknown]> =
		statuses instanceof Map ? [...statuses.entries()] : isRecord(statuses) ? Object.entries(statuses) : [];
	const visible: string[] = [];
	for (const [key, value] of entries) {
		if (typeof key === "string" && INTERNAL_STATUS_KEYS.has(key)) continue;
		if (typeof value !== "string") continue;
		const normalized = sanitizeTerminalSingleLineText(value, { preserveSgr: false });
		if (!normalized) continue;
		if (normalized.trimStart().startsWith("[")) continue;
		if (visibleWidth(stripAnsi(normalized)) <= 0) continue;
		visible.push(normalized);
	}
	return visible;
}

export function normalizePromptText(value: unknown): string {
	return sanitizeTerminalSingleLineText(value, { preserveSgr: false });
}

export function readContextUsageSnapshot(
	ctx: any,
	isStreaming: boolean,
	liveUsage: AssistantUsage | null,
	latestAssistantUsage: AssistantUsage | null,
): ContextUsage | null {
	const coreUsage = isStreaming && liveUsage ? null : readCoreContextUsage(ctx);
	const assistantUsage = liveUsage ?? latestAssistantUsage ?? readLatestAssistantUsage(ctx);
	const tokens = coreUsage?.tokens ?? (assistantUsage ? getUsageTokenTotal(assistantUsage) : 0);
	const contextWindow = coreUsage?.contextWindow ?? readModelContextWindow(ctx);
	const percent = coreUsage?.percent ?? (contextWindow > 0 ? (tokens / contextWindow) * 100 : undefined);

	if (!Number.isFinite(tokens) || tokens <= 0) return null;
	return {
		tokens,
		contextWindow: contextWindow > 0 ? contextWindow : undefined,
		percent: typeof percent === "number" && Number.isFinite(percent) ? percent : undefined,
	};
}

export function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isAssistantUsage(value: unknown): value is AssistantUsage {
	return (
		isRecord(value) &&
		typeof value.input === "number" &&
		typeof value.output === "number" &&
		typeof value.cacheRead === "number" &&
		typeof value.cacheWrite === "number"
	);
}

export function getUsageTokenTotal(usage: AssistantUsage): number {
	return typeof usage.totalTokens === "number" && usage.totalTokens > 0
		? usage.totalTokens
		: usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

export function cacheHitRatioFromUsage(usage: Record<string, any>): number | null {
	if (
		typeof usage.cacheRead === "number" &&
		(typeof usage.cacheWrite === "number" || typeof usage.input === "number")
	) {
		const input = typeof usage.input === "number" ? usage.input : 0;
		const cacheWrite = typeof usage.cacheWrite === "number" ? usage.cacheWrite : 0;
		const total = input + usage.cacheRead + cacheWrite;
		if (total > 0) return (usage.cacheRead / total) * 100;
	}
	const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
	const cacheCreation = typeof usage.cache_creation_input_tokens === "number" ? usage.cache_creation_input_tokens : 0;
	const cacheRead = typeof usage.cache_read_input_tokens === "number" ? usage.cache_read_input_tokens : 0;
	const total = inputTokens + cacheCreation + cacheRead;
	if (total > 0) return (cacheRead / total) * 100;

	const inputTokens2 = typeof usage.input === "number" ? usage.input : 0;
	const cacheRead2 = typeof usage.cache_read === "number" ? usage.cache_read : 0;
	const cacheWrite2 = typeof usage.cache_write === "number" ? usage.cache_write : 0;
	const total2 = inputTokens2 + cacheRead2 + cacheWrite2;
	if (total2 > 0) return (cacheRead2 / total2) * 100;

	if (isRecord(usage.prompt_tokens_details)) {
		const cached = usage.prompt_tokens_details.cached_tokens;
		if (typeof cached === "number" && cached > 0) {
			const promptTokens = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0;
			if (promptTokens > 0) return (cached / promptTokens) * 100;
		}
	}
	if (typeof usage.cachedContentTokenCount === "number" && usage.cachedContentTokenCount > 0) {
		const promptTokens = typeof usage.promptTokenCount === "number" ? usage.promptTokenCount : 0;
		if (promptTokens > 0) return (usage.cachedContentTokenCount / promptTokens) * 100;
	}
	return null;
}

function emptyFrameStatus(): BottomInputFrameStatus {
	return { model: null, thinking: null, context: null, elapsed: null };
}

function renderModelSegment(
	modelName: string | null,
	provider: string | null,
	theme: ThemeLike,
	_icons: BottomInputIconSet,
): string | null {
	if (!modelName) return null;
	if (provider) {
		const suffix = `(${provider})`;
		if (modelName.toLowerCase().endsWith(suffix.toLowerCase())) {
			return safeFg(theme, "accent", modelName);
		}
		return safeFg(theme, "accent", modelName) + safeFg(theme, "muted", suffix);
	}
	return safeFg(theme, "accent", modelName);
}

function renderThinkingSegment(level: string | null, theme: ThemeLike): string | null {
	if (!level) return null;
	const label = normalizeThinkingLevel(level);
	if (!label) return null;
	let result: string;
	if (level === "max") result = rainbow(label, MAX_NEON_COLORS);
	else if (level === "high" || level === "xhigh") result = rainbow(label);
	else result = safeFg(theme, thinkingColorToken(level), label);
	return result;
}

function renderElapsedSegment(
	theme: ThemeLike,
	startedAt: number,
	now: number,
	_icons: BottomInputIconSet,
): string | null {
	const elapsed = Math.max(0, now - startedAt);
	if (elapsed < 1000) return null;
	return safeFg(theme, "muted", `◷ ${formatDuration(elapsed)}`);
}

function normalizeModelName(value: unknown): string | null {
	if (typeof value !== "string") return null;
	let modelName = value.trim();
	if (!modelName) return null;
	if (modelName.includes("/")) modelName = modelName.split("/").filter(Boolean).at(-1) ?? modelName;
	if (modelName.includes(":")) modelName = modelName.split(":").filter(Boolean).at(-1) ?? modelName;
	if (modelName.startsWith("Claude ")) modelName = modelName.slice("Claude ".length);
	return modelName.trim() || null;
}

function readThinkingLevel(ctx: any): string | null {
	try {
		const level = ctx?.getThinkingLevel?.();
		return typeof level === "string" && level ? level : null;
	} catch {
		return null;
	}
}

function readThinkingLevelFromSession(ctx: any): string | null {
	let latest: string | null = null;
	for (const entry of readBranchEntries(ctx)) {
		if (
			isRecord(entry) &&
			entry.type === "thinking_level_change" &&
			typeof entry.thinkingLevel === "string" &&
			entry.thinkingLevel
		) {
			latest = entry.thinkingLevel;
		}
	}
	return latest;
}

function normalizeThinkingLevel(level: string): string {
	const labels: Record<string, string> = {
		off: "off",
		minimal: "min",
		low: "low",
		medium: "med",
		high: "high",
		xhigh: "xhigh",
		max: "max",
	};
	return labels[level] ?? level;
}

function thinkingColorToken(level: string): string {
	const tokens: Record<string, string> = {
		off: "thinking",
		minimal: "thinkingMinimal",
		low: "thinkingLow",
		medium: "thinkingMedium",
	};
	return tokens[level] ?? "thinking";
}

function readCoreContextUsage(ctx: any): ContextUsage | null {
	try {
		if (typeof ctx?.getContextUsage !== "function") return null;
		const usage = ctx.getContextUsage();
		if (!isRecord(usage)) return null;
		const tokens = usage.tokens;
		if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens <= 0) return null;
		const contextWindow = usage.contextWindow;
		const percent = usage.percent;
		return {
			tokens,
			contextWindow:
				typeof contextWindow === "number" && Number.isFinite(contextWindow) && contextWindow > 0
					? contextWindow
					: undefined,
			percent: typeof percent === "number" && Number.isFinite(percent) ? percent : undefined,
		};
	} catch {
		return null;
	}
}

function readLatestAssistantUsage(ctx: any): AssistantUsage | null {
	let latestUsage: AssistantUsage | null = null;
	for (const entry of readBranchEntries(ctx)) {
		if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message)) continue;
		if (entry.message.role !== "assistant" || !isAssistantUsage(entry.message.usage)) continue;
		if (entry.message.stopReason === "error" || entry.message.stopReason === "aborted") continue;
		if (getUsageTokenTotal(entry.message.usage) > 0) latestUsage = entry.message.usage;
	}
	return latestUsage;
}

function readBranchEntries(ctx: any): any[] {
	try {
		const entries = ctx?.sessionManager?.getBranch?.();
		return Array.isArray(entries) ? entries : [];
	} catch {
		return [];
	}
}

function readModelContextWindow(ctx: any): number {
	try {
		const contextWindow = ctx?.model?.contextWindow;
		return typeof contextWindow === "number" && Number.isFinite(contextWindow) && contextWindow > 0
			? contextWindow
			: 0;
	} catch {
		return 0;
	}
}

function readModelName(ctx: any): string | null {
	try {
		return normalizeModelName(ctx?.model?.name || ctx?.model?.id);
	} catch {
		return null;
	}
}

function readModelProvider(ctx: any): string | null {
	try {
		const provider = ctx?.model?.provider;
		if (typeof provider === "string" && provider.trim()) {
			return provider.trim();
		}
		const modelName = ctx?.model?.name || ctx?.model?.id;
		if (typeof modelName === "string") {
			const trimmed = modelName.trim();
			const slashIndex = trimmed.indexOf("/");
			if (slashIndex > 0) {
				return trimmed.slice(0, slashIndex).trim() || null;
			}
		}
		return null;
	} catch {
		return null;
	}
}

export function renderContextBar(percent: number, color = CONTEXT_COLORS.normal): string {
	const clamped = Math.max(0, Math.min(100, percent));
	const filledCells = Math.floor((clamped / 100) * CONTEXT_BAR_WIDTH);
	const hasPartial = clamped > 0 && filledCells < CONTEXT_BAR_WIDTH;
	const filled = "━".repeat(filledCells);
	const partial = hasPartial ? "╸" : "";
	const empty = "─".repeat(Math.max(0, CONTEXT_BAR_WIDTH - filledCells - (hasPartial ? 1 : 0)));
	return `${applyHexColor(color, `${filled}${partial}`)}${applyHexColor(CONTEXT_COLORS.empty, empty)}`;
}

function contextColor(percent: number): string {
	if (percent > 90) return CONTEXT_COLORS.error;
	if (percent > 70) return CONTEXT_COLORS.warning;
	return CONTEXT_COLORS.normal;
}

function formatTokens(n: number): string {
	if (n < 1000) return String(n);
	if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
	if (n < 1000000) return `${Math.round(n / 1000)}k`;
	if (n < 10000000) return `${(n / 1000000).toFixed(1)}M`;
	return `${Math.round(n / 1000000)}M`;
}

function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	if (hours > 0) return `${hours}h${minutes % 60}m`;
	if (minutes > 0) return `${minutes}m${seconds % 60}s`;
	return `${seconds}s`;
}

function rainbow(text: string, colors: readonly string[] = RAINBOW_COLORS): string {
	let result = "";
	let colorIndex = 0;
	for (const char of text) {
		if (char === " " || char === ":") {
			result += char;
			continue;
		}
		result += `${hexToAnsi(colors[colorIndex % colors.length]!)}${char}`;
		colorIndex += 1;
	}
	return `${result}\x1b[0m`;
}

function applyHexColor(hex: string, text: string): string {
	return `${hexToAnsi(hex)}${text}\x1b[0m`;
}

function hexToAnsi(hex: string): string {
	const value = hex.replace("#", "");
	const red = Number.parseInt(value.slice(0, 2), 16);
	const green = Number.parseInt(value.slice(2, 4), 16);
	const blue = Number.parseInt(value.slice(4, 6), 16);
	return `\x1b[38;2;${red};${green};${blue}m`;
}

function safeFg(theme: ThemeLike, token: string, text: string, fallback = "text"): string {
	try {
		return theme.fg(token, text);
	} catch {
		try {
			return theme.fg(fallback, text);
		} catch {
			return text;
		}
	}
}

function stripAnsi(input: string): string {
	return sanitizeTerminalText(input, { allowNewline: false, allowTab: false, preserveSgr: false });
}
