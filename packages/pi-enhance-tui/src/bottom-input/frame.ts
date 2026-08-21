import { CURSOR_MARKER, Editor, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { sanitizeTerminalText } from "./sanitize.ts";
import type { BeautifiedEditorFrameInput, BottomInputEditorState, BottomInputFrameStatus, ThemeLike } from "./types.ts";

export const FIXED_EDITOR_CURSOR_MARKER = CURSOR_MARKER;
export const MIN_FRAME_WIDTH = 8;
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function renderBeautifiedEditorFrame(input: BeautifiedEditorFrameInput): string[] {
	const width = Number.isFinite(input.width) ? Math.max(0, Math.floor(input.width)) : 0;
	if (width < MIN_FRAME_WIDTH) return [...input.editorLines];
	const editorLines = input.editorLines.length > 0 ? [...input.editorLines] : [""];
	return [
		buildTopBorder(width, input.theme, input.status),
		...editorLines.map((line) => renderContentLine(line, width, input.theme)),
		buildBottomBorder(width, input.theme, input.status.elapsed),
	];
}

function buildTopBorder(width: number, theme: ThemeLike, status: BottomInputFrameStatus): string {
	const leftLabel = joinStyledSegments([status.model, status.thinking], safeFg(theme, "borderMuted", " · "));
	const rightLabel = status.context ?? "";
	return buildBorderLine({
		width,
		theme,
		leftCorner: "╭",
		rightCorner: "╮",
		leftLabel,
		rightLabel,
	});
}

function buildBottomBorder(width: number, theme: ThemeLike, elapsed: string | null): string {
	return buildBorderLine({
		width,
		theme,
		leftCorner: "╰",
		rightCorner: "╯",
		rightLabel: elapsed?.trim() || "",
	});
}

function buildBorderLine(input: {
	width: number;
	theme: ThemeLike;
	leftCorner: string;
	rightCorner: string;
	leftLabel?: string;
	rightLabel?: string;
}): string {
	const { width, theme, leftCorner, rightCorner } = input;
	const safeWidth = Math.max(2, width);
	const innerBudget = Math.max(0, safeWidth - 2);
	let leftLabel = fitStatusLabel(input.leftLabel ?? "", Math.max(0, Math.floor(innerBudget * 0.45) - 2));
	let rightLabel = fitStatusLabel(
		input.rightLabel ?? "",
		Math.max(0, innerBudget - visibleWidth(labelPart(leftLabel)) - 2),
	);

	for (
		let guard = 0;
		guard < 6 && visibleWidth(labelPart(leftLabel)) + visibleWidth(labelPart(rightLabel)) > innerBudget;
		guard += 1
	) {
		const overflow = visibleWidth(labelPart(leftLabel)) + visibleWidth(labelPart(rightLabel)) - innerBudget;
		if (rightLabel) {
			rightLabel = fitStatusLabel(rightLabel, Math.max(0, visibleWidth(rightLabel) - overflow));
		} else if (leftLabel) {
			leftLabel = fitStatusLabel(leftLabel, Math.max(0, visibleWidth(leftLabel) - overflow));
		}
	}
	if (visibleWidth(labelPart(leftLabel)) + visibleWidth(labelPart(rightLabel)) > innerBudget) rightLabel = "";
	if (visibleWidth(labelPart(leftLabel)) + visibleWidth(labelPart(rightLabel)) > innerBudget) leftLabel = "";
	return composeBorderLine(theme, leftCorner, rightCorner, leftLabel, rightLabel, innerBudget);
}

function labelPart(label: string): string {
	return label ? ` ${label} ` : "";
}

function composeBorderLine(
	theme: ThemeLike,
	leftCorner: string,
	rightCorner: string,
	leftLabel: string,
	rightLabel: string,
	innerBudget: number,
): string {
	const leftPart = labelPart(leftLabel);
	const rightPart = labelPart(rightLabel);
	const dashCount = Math.max(0, innerBudget - visibleWidth(leftPart) - visibleWidth(rightPart));
	return (
		styleBorder(theme, leftCorner) +
		leftPart +
		styleBorder(theme, "─".repeat(dashCount)) +
		rightPart +
		styleBorder(theme, rightCorner)
	);
}

function fitStatusLabel(label: string, maxWidth: number): string {
	if (!label || maxWidth <= 0) return "";
	if (visibleWidth(label) <= maxWidth) return label;
	const plain = stripAnsi(label);
	return truncateToWidth(plain, maxWidth, "…", false);
}

function renderContentLine(line: string, width: number, theme: ThemeLike): string {
	const innerWidth = Math.max(0, width - 4);
	const safeLine = sanitizeEditorLine(line);
	const clipped = closeOpenAnsiCodes(truncateEditorLinePreservingCursor(safeLine, innerWidth));
	const padded = padToWidth(clipped, innerWidth);
	return `${styleBorder(theme, "│")} ${padded} ${styleBorder(theme, "│")}`;
}

export function stripBottomInputFrameCopy(text: string): string {
	return text.split("\n").map(stripFrameLineDecoration).join("\n");
}

function stripFrameLineDecoration(line: string): string {
	let cleaned = line;
	cleaned = cleaned.replace(/^[\s\t]*[│▍▎▌▋][\s\t]*/u, "");
	cleaned = cleaned.replace(/[\s\t]*│[\s\t]*$/u, "");
	return cleaned;
}

function sanitizeEditorLine(line: string): string {
	const placeholder = "\uE000ALPS_CURSOR\uE000";
	const withPlaceholder = String(line).split(FIXED_EDITOR_CURSOR_MARKER).join(placeholder);
	return sanitizeTerminalText(withPlaceholder, { allowNewline: false, allowTab: true, preserveSgr: true })
		.split(placeholder)
		.join(FIXED_EDITOR_CURSOR_MARKER);
}

function truncateEditorLinePreservingCursor(line: string, width: number): string {
	if (width <= 0) return line.includes(FIXED_EDITOR_CURSOR_MARKER) ? FIXED_EDITOR_CURSOR_MARKER : "";
	if (!line.includes(FIXED_EDITOR_CURSOR_MARKER)) return truncateToWidth(line, width, "", false);
	const markerIndex = line.indexOf(FIXED_EDITOR_CURSOR_MARKER);
	const beforeCursor = line.slice(0, markerIndex);
	const afterCursor = line.slice(markerIndex + FIXED_EDITOR_CURSOR_MARKER.length);
	const beforeWidth = visibleWidth(beforeCursor);
	const totalWidth = beforeWidth + visibleWidth(afterCursor);
	if (totalWidth <= width) return line;

	const startCol = Math.max(0, beforeWidth - Math.max(0, width - 1));
	const before = sliceVisibleColumns(beforeCursor, startCol, beforeWidth - startCol);
	const remaining = Math.max(0, width - visibleWidth(before));
	const after = sliceVisibleColumns(afterCursor, 0, remaining);
	return `${before}${FIXED_EDITOR_CURSOR_MARKER}${after}`;
}

function closeOpenAnsiCodes(line: string): string {
	return containsSgr(line) ? `${line}\x1b[0m` : line;
}

function containsSgr(line: string): boolean {
	for (let index = 0; index < line.length; ) {
		const ansi = extractAnsiSequence(line, index);
		if (!ansi) {
			index += 1;
			continue;
		}
		if (ansi.code.startsWith("\x1b[") && ansi.code.endsWith("m")) return true;
		index += ansi.length;
	}
	return false;
}

function sliceVisibleColumns(line: string, startCol: number, length: number): string {
	if (length <= 0) return "";
	const endCol = startCol + length;
	let result = "";
	let currentCol = 0;
	let pendingAnsi = "";
	for (let index = 0; index < line.length; ) {
		const ansi = extractAnsiSequence(line, index);
		if (ansi) {
			if (currentCol >= startCol && currentCol < endCol) {
				result += ansi.code;
			} else if (currentCol < startCol) {
				pendingAnsi += ansi.code;
			}
			index += ansi.length;
			continue;
		}

		let textEnd = index;
		while (textEnd < line.length && !extractAnsiSequence(line, textEnd)) textEnd += 1;
		for (const { segment } of segmenter.segment(line.slice(index, textEnd))) {
			const segmentWidth = visibleWidth(segment);
			const inRange = currentCol >= startCol && currentCol < endCol;
			const fits = currentCol + segmentWidth <= endCol;
			if (inRange && fits) {
				if (pendingAnsi) {
					result += pendingAnsi;
					pendingAnsi = "";
				}
				result += segment;
			}
			currentCol += segmentWidth;
			if (currentCol >= endCol) break;
		}
		index = textEnd;
		if (currentCol >= endCol) break;
	}
	return result;
}

function extractAnsiSequence(line: string, index: number): { code: string; length: number } | null {
	if (line[index] !== "\x1b") return null;
	const next = line[index + 1];
	if (next === "[") {
		for (let end = index + 2; end < line.length; end += 1) {
			const code = line.charCodeAt(end);
			if (code >= 0x40 && code <= 0x7e) return { code: line.slice(index, end + 1), length: end + 1 - index };
		}
		return null;
	}
	if (next === "]" || next === "_" || next === "P" || next === "^") {
		for (let end = index + 2; end < line.length; end += 1) {
			if (line[end] === "\x07") return { code: line.slice(index, end + 1), length: end + 1 - index };
			if (line[end] === "\x1b" && line[end + 1] === "\\")
				return { code: line.slice(index, end + 2), length: end + 2 - index };
		}
	}
	return null;
}

function padToWidth(line: string, width: number): string {
	const current = visibleWidth(line);
	return current >= width ? line : line + " ".repeat(width - current);
}

function joinStyledSegments(segments: Array<string | null>, separator: string): string {
	return segments.filter((segment): segment is string => Boolean(segment)).join(separator);
}

function styleBorder(theme: ThemeLike, text: string): string {
	return safeFg(theme, "borderMuted", text, "border");
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

export type SplitEditorRenderResult = {
	editorLines: string[];
	popupLines: string[];
};

export function isNativeEditorRule(line: string): boolean {
	const plain = stripAnsi(line).trim();
	return plain.includes("─") && [...plain].every((char) => "─↑↓ 0123456789more".includes(char));
}

export function splitNativeEditorRender(lines: readonly string[]): SplitEditorRenderResult {
	if (lines.length === 0) return { editorLines: [], popupLines: [] };
	const withoutTop = isNativeEditorRule(lines[0] ?? "") ? lines.slice(1) : [...lines];
	const bottomRuleIndex = withoutTop.findIndex(isNativeEditorRule);
	if (bottomRuleIndex === -1) {
		return { editorLines: [...withoutTop], popupLines: [] };
	}
	return {
		editorLines: withoutTop.slice(0, bottomRuleIndex),
		popupLines: withoutTop.slice(bottomRuleIndex + 1),
	};
}

export function renderBottomInputEditorLines(input: {
	lines: readonly string[];
	width: number;
	theme: ThemeLike;
	state: BottomInputEditorState;
}): string[] {
	const width = Number.isFinite(input.width) ? Math.max(0, Math.floor(input.width)) : 0;
	if (!input.state.beautifiedInputEnabled || width < MIN_FRAME_WIDTH) return [...input.lines];
	const { editorLines, popupLines } = splitNativeEditorRender(input.lines);
	return [
		...renderBeautifiedEditorFrame({
			editorLines,
			width,
			theme: input.theme,
			status: input.state.getFrameStatus(width),
		}),
		...fitPopupLines(popupLines, width),
	];
}

export function createBottomInputEditor(
	tui: any,
	theme: any,
	keybindings: any,
	state: BottomInputEditorState,
	options: { CustomEditor?: new (tui: any, theme: any, keybindings: any, options?: any) => any } = {},
): any {
	const BaseEditor = options.CustomEditor;
	const editorTheme = theme ?? createFallbackEditorTheme();
	if (typeof BaseEditor === "function") {
		class BeautifiedEditor extends BaseEditor {
			private readonly stateRef: BottomInputEditorState;

			constructor() {
				super(tui, editorTheme, keybindings, { paddingX: 0 });
				this.stateRef = state;
			}

			render(width: number): string[] {
				if (!this.stateRef.beautifiedInputEnabled || width < MIN_FRAME_WIDTH) return super.render(width);
				const innerWidth = Math.max(1, Math.floor(width) - 4);
				const base = super.render(innerWidth);
				return renderBottomInputEditorLines({
					lines: base,
					width,
					theme: this.stateRef.getTheme(),
					state: this.stateRef,
				});
			}
		}
		return new BeautifiedEditor();
	}
	return new FallbackBeautifiedInputEditor(tui, editorTheme, state);
}

class FallbackBeautifiedInputEditor extends Editor {
	private readonly stateRef: BottomInputEditorState;

	constructor(tui: any, editorTheme: ThemeLike, stateRef: BottomInputEditorState) {
		super(tui, editorTheme as any, { paddingX: 0 });
		this.stateRef = stateRef;
	}

	render(width: number): string[] {
		if (!this.stateRef.beautifiedInputEnabled || width < MIN_FRAME_WIDTH) return super.render(width);
		const innerWidth = Math.max(1, Math.floor(width) - 4);
		const base = super.render(innerWidth);
		return renderBottomInputEditorLines({
			lines: base,
			width,
			theme: this.stateRef.getTheme(),
			state: this.stateRef,
		});
	}
}

function fitPopupLines(lines: readonly string[], width: number): string[] {
	return lines.map((line) => {
		const clipped = truncateToWidth(line, Math.max(1, width), "", true);
		const padding = " ".repeat(Math.max(0, width - visibleWidth(clipped)));
		return clipped + padding;
	});
}

function createFallbackEditorTheme(): ThemeLike {
	return {
		fg: (_token: string, text: string) => text,
		bg: (_token: string, text: string) => text,
		bold: (text: string) => text,
	};
}
