import { CURSOR_MARKER, Editor, matchesKey, truncateToWidth, visibleWidth, wordWrapLine } from "@earendil-works/pi-tui";
import { copyToSystemClipboard } from "../clipboard.ts";
import { PALETTE } from "../ui/theme.ts";
import { sanitizeTerminalText } from "./sanitize.ts";
import { isCopyShortcutInput, isCutShortcutInput, isSelectAllShortcutInput } from "./shortcuts.ts";
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

export interface EditorTextSelection {
	anchor: { line: number; col: number };
	focus: { line: number; col: number };
}

export function compareDocPositions(a: { line: number; col: number }, b: { line: number; col: number }): number {
	return a.line === b.line ? a.col - b.col : a.line - b.line;
}

export function getNormalizedSelectionRange(
	selection: EditorTextSelection | null,
): { start: { line: number; col: number }; end: { line: number; col: number } } | null {
	if (!selection) return null;
	const cmp = compareDocPositions(selection.anchor, selection.focus);
	if (cmp === 0) return null;
	const start = cmp < 0 ? { ...selection.anchor } : { ...selection.focus };
	const end = cmp < 0 ? { ...selection.focus } : { ...selection.anchor };
	return { start, end };
}

export function computeEditorVisualLines(
	lines: readonly string[],
	width: number,
): Array<{ logicalLine: number; startCol: number; length: number; text: string }> {
	const visualLines: Array<{ logicalLine: number; startCol: number; length: number; text: string }> = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] || "";
		if (line.length === 0) {
			visualLines.push({ logicalLine: i, startCol: 0, length: 0, text: "" });
		} else if (visibleWidth(line) <= width) {
			visualLines.push({ logicalLine: i, startCol: 0, length: line.length, text: line });
		} else {
			const chunks = wordWrapLine(line, width);
			for (const chunk of chunks) {
				visualLines.push({
					logicalLine: i,
					startCol: chunk.startIndex,
					length: chunk.endIndex - chunk.startIndex,
					text: chunk.text,
				});
			}
		}
	}
	return visualLines;
}

export function highlightVisualLineSelection(
	text: string,
	startCol: number,
	length: number,
	logicalLine: number,
	range: { start: { line: number; col: number }; end: { line: number; col: number } } | null,
	cursor?: { line: number; col: number; visible?: boolean },
): string {
	const lineStartCol =
		range && logicalLine >= range.start.line && logicalLine <= range.end.line
			? logicalLine === range.start.line
				? Math.max(startCol, range.start.col)
				: startCol
			: startCol;
	const lineEndCol =
		range && logicalLine >= range.start.line && logicalLine <= range.end.line
			? logicalLine === range.end.line
				? Math.min(startCol + length, range.end.col)
				: startCol + length
			: startCol;

	const hasSelectionOnLine = Boolean(range && lineStartCol < lineEndCol);
	const isCursorLine = cursor && cursor.line === logicalLine;
	const isCursorOnVL = Boolean(
		isCursorLine &&
			cursor.col >= startCol &&
			(cursor.col < startCol + length || (startCol + length === text.length && cursor.col === startCol + length)),
	);
	const cursorPosOnVL = isCursorOnVL ? cursor!.col - startCol : -1;
	const showBlink = cursor ? cursor.visible !== false : true;

	if (!hasSelectionOnLine) {
		if (!isCursorOnVL) return text;
		const before = text.slice(0, cursorPosOnVL);
		const after = text.slice(cursorPosOnVL);
		if (after.length > 0) {
			const cursorBeam = showBlink ? PALETTE.cursor("▎") : "\x1b[38;2;60;75;90m▎\x1b[0m";
			return `${before}${CURSOR_MARKER}${cursorBeam}${after}`;
		}
		const cursorChar = showBlink ? PALETTE.cursor("▎") : " ";
		return `${before}${CURSOR_MARKER}${cursorChar}`;
	}

	const selStart = lineStartCol - startCol;
	const selEnd = lineEndCol - startCol;

	const beforeSel = text.slice(0, selStart);
	const selectedText = text.slice(selStart, selEnd);
	const afterSel = text.slice(selEnd);

	if (!isCursorOnVL) {
		return `${beforeSel}\x1b[7m${selectedText}\x1b[27m${afterSel}`;
	}

	if (cursorPosOnVL <= selStart) {
		return `${beforeSel}${CURSOR_MARKER}\x1b[7m${selectedText}\x1b[27m${afterSel}`;
	}
	if (cursorPosOnVL >= selEnd) {
		return `${beforeSel}\x1b[7m${selectedText}\x1b[27m${CURSOR_MARKER}${afterSel}`;
	}
	const cOff = cursorPosOnVL - selStart;
	return `${beforeSel}\x1b[7m${selectedText.slice(0, cOff)}${CURSOR_MARKER}${selectedText.slice(cOff)}\x1b[27m${afterSel}`;
}

export class EnhancedEditorBase extends Editor {
	public stateRef: BottomInputEditorState;
	public keybindings?: any;
	public actionHandlers: Map<string, () => void> = new Map();
	public onEscape?: () => void;
	public onCtrlD?: () => void;
	public onPasteImage?: () => void;
	public onExtensionShortcut?: (data: string) => boolean;

	public selection: EditorTextSelection | null = null;
	public isDraggingSelection = false;
	private lastInteractionTime = Date.now();
	private blinkTimer: ReturnType<typeof setInterval> | null = null;

	public isCursorBlinkVisible(): boolean {
		const now = Date.now();
		const diff = now - this.lastInteractionTime;
		if (diff < 500) return true;
		return Math.floor(diff / 500) % 2 === 0;
	}

	public resetCursorBlink(): void {
		this.lastInteractionTime = Date.now();
	}

	public startBlinkTimer(): void {
		if (this.blinkTimer) return;
		this.blinkTimer = setInterval(() => {
			if (this.tui && typeof this.tui.requestRender === "function") {
				this.tui.requestRender();
			}
		}, 500);
		this.blinkTimer.unref?.();
	}

	public stopBlinkTimer(): void {
		if (this.blinkTimer) {
			clearInterval(this.blinkTimer);
			this.blinkTimer = null;
		}
	}

	public dispose(): void {
		this.stopBlinkTimer();
	}

	constructor(tui: any, editorTheme: ThemeLike, keybindings: any, stateRef: BottomInputEditorState) {
		const safeTheme = {
			borderColor: (s: string) => s,
			selectList: {},
			...(editorTheme as any),
		};
		if (typeof (editorTheme as any)?.borderColor !== "function") {
			safeTheme.borderColor = (s: string) => s;
		}
		super(tui, safeTheme as any, { paddingX: 0 });
		this.borderColor = safeTheme.borderColor;
		this.keybindings = keybindings;
		this.stateRef = stateRef;
		this.startBlinkTimer();
	}

	onAction(action: string, handler: () => void): void {
		this.actionHandlers.set(action, handler);
	}

	getNormalizedRange(): { start: { line: number; col: number }; end: { line: number; col: number } } | null {
		return getNormalizedSelectionRange(this.selection);
	}

	hasSelectionRange(): boolean {
		return this.getNormalizedRange() !== null;
	}

	clearSelection(): void {
		this.selection = null;
		this.isDraggingSelection = false;
	}

	setCursorFromClick(visualRow: number, visualCol: number): void {
		this.resetCursorBlink();
		const pos = this.mapVisualPosToLogicalPos(visualRow, visualCol);
		(this as any).state.cursorLine = pos.line;
		this.setCursorColumn(pos.col);
		(this as any).preferredVisualCol = null;
		(this as any).snappedFromCursorCol = null;
		this.clearSelection();
		this.tui.requestRender();
	}

	startSelection(visualRow: number, visualCol: number): void {
		this.resetCursorBlink();
		const pos = this.mapVisualPosToLogicalPos(visualRow, visualCol);
		(this as any).state.cursorLine = pos.line;
		this.setCursorColumn(pos.col);
		this.selection = { anchor: { ...pos }, focus: { ...pos } };
		this.isDraggingSelection = true;
		this.tui.requestRender();
	}

	updateSelection(visualRow: number, visualCol: number): void {
		this.resetCursorBlink();
		const pos = this.mapVisualPosToLogicalPos(visualRow, visualCol);
		(this as any).state.cursorLine = pos.line;
		this.setCursorColumn(pos.col);
		if (this.selection) {
			this.selection.focus = { ...pos };
		} else {
			this.selection = { anchor: { ...pos }, focus: { ...pos } };
		}
		this.tui.requestRender();
	}

	finishSelection(): void {
		this.isDraggingSelection = false;
		if (
			this.selection &&
			this.selection.anchor.line === this.selection.focus.line &&
			this.selection.anchor.col === this.selection.focus.col
		) {
			this.selection = null;
		}
		this.tui.requestRender();
	}

	selectWordAt(visualRow: number, visualCol: number): void {
		const pos = this.mapVisualPosToLogicalPos(visualRow, visualCol);
		const lines = (this as any).state.lines;
		const line = lines[pos.line] || "";
		if (line.length === 0) return;

		let startCol = Math.min(pos.col, line.length);
		let endCol = startCol;

		const isWordChar = (ch: string) => /[\p{L}\p{N}_]/u.test(ch);
		const charAt = line[startCol] || line[startCol - 1] || "";
		const testFn = isWordChar(charAt) ? isWordChar : (ch: string) => !/\s/.test(ch);

		while (startCol > 0 && testFn(line[startCol - 1]!)) {
			startCol--;
		}
		while (endCol < line.length && testFn(line[endCol]!)) {
			endCol++;
		}

		if (startCol < endCol) {
			this.selection = {
				anchor: { line: pos.line, col: startCol },
				focus: { line: pos.line, col: endCol },
			};
			(this as any).state.cursorLine = pos.line;
			this.setCursorColumn(endCol);
			this.tui.requestRender();
		}
	}

	selectLineAt(visualRow: number): void {
		const pos = this.mapVisualPosToLogicalPos(visualRow, 0);
		const lines = (this as any).state.lines;
		const line = lines[pos.line] || "";
		this.selection = {
			anchor: { line: pos.line, col: 0 },
			focus: { line: pos.line, col: line.length },
		};
		(this as any).state.cursorLine = pos.line;
		this.setCursorColumn(line.length);
		this.tui.requestRender();
	}

	selectAll(): void {
		const lines = (this as any).state.lines;
		if (lines.length === 0) return;
		const lastL = lines.length - 1;
		const lastLine = lines[lastL] || "";
		this.selection = {
			anchor: { line: 0, col: 0 },
			focus: { line: lastL, col: lastLine.length },
		};
		(this as any).state.cursorLine = lastL;
		this.setCursorColumn(lastLine.length);
		this.tui.requestRender();
	}

	getSelectedText(): string {
		const range = this.getNormalizedRange();
		if (!range) return "";
		const lines = (this as any).state.lines;
		const { start, end } = range;
		if (start.line === end.line) {
			const line = lines[start.line] || "";
			return line.slice(start.col, end.col);
		}
		const parts: string[] = [];
		for (let l = start.line; l <= end.line; l++) {
			const line = lines[l] || "";
			if (l === start.line) parts.push(line.slice(start.col));
			else if (l === end.line) parts.push(line.slice(0, end.col));
			else parts.push(line);
		}
		return parts.join("\n");
	}

	deleteSelection(): boolean {
		const range = this.getNormalizedRange();
		if (!range) return false;
		(this as any).pushUndoSnapshot?.();
		const lines = (this as any).state.lines;
		const { start, end } = range;
		if (start.line === end.line) {
			const line = lines[start.line] || "";
			lines[start.line] = line.slice(0, start.col) + line.slice(end.col);
		} else {
			const firstLine = lines[start.line] || "";
			const lastLine = lines[end.line] || "";
			const merged = firstLine.slice(0, start.col) + lastLine.slice(end.col);
			(this as any).state.lines = [...lines.slice(0, start.line), merged, ...lines.slice(end.line + 1)];
		}
		(this as any).state.cursorLine = start.line;
		this.setCursorColumn(start.col);
		this.clearSelection();
		this.onChange?.(this.getText());
		this.tui.requestRender();
		return true;
	}

	mapVisualPosToLogicalPos(visualRow: number, visualCol: number): { line: number; col: number } {
		const lines: string[] = (this as any).state.lines;
		const width = Math.max(1, (this as any).lastWidth || 80);
		const visualLines = computeEditorVisualLines(lines, width);

		if (visualLines.length === 0) return { line: 0, col: 0 };
		const scrollOffset = (this as any).scrollOffset || 0;
		const targetVLIndex = Math.max(0, Math.min(scrollOffset + visualRow, visualLines.length - 1));
		const vl = visualLines[targetVLIndex]!;
		if (vl.length === 0) return { line: vl.logicalLine, col: 0 };

		let accW = 0;
		let colOff = 0;
		for (const { segment: seg } of segmenter.segment(vl.text)) {
			const gW = visibleWidth(seg);
			if (accW + gW / 2 >= visualCol) break;
			accW += gW;
			colOff += seg.length;
		}
		return {
			line: vl.logicalLine,
			col: Math.min(vl.startCol + colOff, vl.startCol + vl.length),
		};
	}

	private setCursorColumn(col: number): void {
		(this as any).state.cursorCol = col;
		(this as any).preferredVisualCol = null;
		(this as any).snappedFromCursorCol = null;
	}

	override handleInput(data: string): void {
		this.resetCursorBlink();
		if (this.onExtensionShortcut?.(data)) {
			return;
		}

		if (isSelectAllShortcutInput(data)) {
			this.selectAll();
			return;
		}

		if (isCopyShortcutInput(data)) {
			if (this.hasSelectionRange()) {
				const text = this.getSelectedText();
				void copyToSystemClipboard(text);
				return;
			}
		}

		if (isCutShortcutInput(data)) {
			if (this.hasSelectionRange()) {
				const text = this.getSelectedText();
				void copyToSystemClipboard(text);
				this.deleteSelection();
				return;
			}
		}

		if (matchesKey(data, "escape")) {
			if (this.hasSelectionRange()) {
				this.clearSelection();
				this.tui.requestRender();
				return;
			}
		}

		if (
			matchesKey(data, "backspace") ||
			matchesKey(data, "delete") ||
			matchesKey(data, "shift+backspace") ||
			matchesKey(data, "shift+delete")
		) {
			if (this.hasSelectionRange()) {
				this.deleteSelection();
				return;
			}
		}

		if (matchesKey(data, "left") || matchesKey(data, "home")) {
			if (this.hasSelectionRange()) {
				const range = this.getNormalizedRange();
				if (range) {
					(this as any).state.cursorLine = range.start.line;
					this.setCursorColumn(range.start.col);
				}
				this.clearSelection();
				this.tui.requestRender();
				return;
			}
		}

		if (matchesKey(data, "right") || matchesKey(data, "end")) {
			if (this.hasSelectionRange()) {
				const range = this.getNormalizedRange();
				if (range) {
					(this as any).state.cursorLine = range.end.line;
					this.setCursorColumn(range.end.col);
				}
				this.clearSelection();
				this.tui.requestRender();
				return;
			}
		}

		if (matchesKey(data, "up") || matchesKey(data, "down")) {
			if (this.hasSelectionRange()) {
				this.clearSelection();
			}
		}

		if (this.keybindings?.matches?.(data, "app.clipboard.pasteImage")) {
			this.onPasteImage?.();
			return;
		}

		if (this.keybindings?.matches?.(data, "app.interrupt")) {
			if (!this.isShowingAutocomplete()) {
				const handler = this.onEscape ?? this.actionHandlers.get("app.interrupt");
				if (handler) {
					handler();
					return;
				}
			}
			super.handleInput(data);
			return;
		}

		if (this.keybindings?.matches?.(data, "app.exit")) {
			if (this.getText().length === 0) {
				const handler = this.onCtrlD ?? this.actionHandlers.get("app.exit");
				if (handler) {
					handler();
					return;
				}
			}
		}

		if (
			this.keybindings?.matches?.(data, "tui.editor.historyPrevious") ||
			this.keybindings?.matches?.(data, "tui.editor.historyNext")
		) {
			super.handleInput(data);
			return;
		}

		for (const [action, handler] of this.actionHandlers) {
			if (action !== "app.interrupt" && action !== "app.exit" && this.keybindings?.matches?.(data, action)) {
				handler();
				return;
			}
		}

		if (this.hasSelectionRange()) {
			if (data.charCodeAt(0) >= 32 || data.includes("\x1b[200~") || data === "\n" || data === "\r") {
				this.deleteSelection();
			}
		}

		super.handleInput(data);
	}

	override render(width: number): string[] {
		if (!this.stateRef.beautifiedInputEnabled || width < MIN_FRAME_WIDTH) return super.render(width);
		const innerWidth = Math.max(1, Math.floor(width) - 4);
		const base = super.render(innerWidth);
		const range = this.getNormalizedRange();
		const layoutWidth = (this as any).lastWidth || Math.max(1, innerWidth - 1);
		const visualLines = computeEditorVisualLines(this.getLines(), layoutWidth);
		const scrollOffset = (this as any).scrollOffset || 0;
		const cursor = {
			line: (this as any).state.cursorLine,
			col: (this as any).state.cursorCol,
			visible: this.isCursorBlinkVisible(),
		};
		const { editorLines, popupLines } = splitNativeEditorRender(base);
		const styledEditorLines = editorLines.map((_line, idx) => {
			const vl = visualLines[scrollOffset + idx];
			if (!vl) return _line;
			return highlightVisualLineSelection(vl.text, vl.startCol, vl.length, vl.logicalLine, range, cursor);
		});
		const decoratedBase = isNativeEditorRule(base[0] ?? "")
			? [base[0]!, ...styledEditorLines, ...popupLines]
			: [...styledEditorLines, ...popupLines];
		return renderBottomInputEditorLines({
			lines: decoratedBase,
			width,
			theme: this.stateRef.getTheme(),
			state: this.stateRef,
		});
	}
}

export class BeautifiedEditor extends EnhancedEditorBase {}
export class FallbackBeautifiedInputEditor extends EnhancedEditorBase {}

export function createBottomInputEditor(
	tui: any,
	theme: any,
	keybindings: any,
	state: BottomInputEditorState,
	_options: { CustomEditor?: new (tui: any, theme: any, keybindings: any, options?: any) => any } = {},
): any {
	const editorTheme = theme ?? createFallbackEditorTheme();
	return new FallbackBeautifiedInputEditor(tui, editorTheme, keybindings, state);
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
