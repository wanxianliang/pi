import { isKeyRelease, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { sanitizeTerminalText } from "./sanitize.ts";
import { matchesConfiguredShortcut } from "./shortcuts.ts";
import type { FixedEditorCluster, FixedEditorClusterInput } from "./types.ts";
export const FIXED_EDITOR_CURSOR_MARKER = "\x1b_pi:cursor\x07";

type ProcessWithExit = Pick<typeof process, "once" | "removeListener">;

export type FixedEditorTerminal = {
	columns?: number;
	rows: number;
	write(data: string): void;
};

export type FixedEditorRenderable = {
	render(width: number): string[];
};

export type FixedBottomEditorCompositorOptions = {
	tui: any;
	terminal: FixedEditorTerminal;
	renderCluster: (width: number, terminalRows: number) => FixedEditorCluster;
	getShowHardwareCursor?: () => boolean;
	keyboardScrollShortcuts?: { up: string; down: string };
	onCopySelection?: (text: string) => void;
	decorateCopyText?: (text: string) => string;
	processLike?: ProcessWithExit;
	onEditorClick?: (visualRow: number, visualCol: number, clickType: "single" | "double" | "triple") => void;
	onEditorDrag?: (visualRow: number, visualCol: number) => void;
	onEditorRelease?: () => void;
	isBeautifiedEditor?: () => boolean;
};

type TerminalWrite = (data: string) => void;
type TuiRender = (width: number, ...args: unknown[]) => string[];
type TuiDoRender = (...args: unknown[]) => unknown;

type RenderPatch = {
	target: FixedEditorRenderable;
	originalRender: (width: number) => string[];
	hiddenRender: (width: number) => string[];
};

type SgrMousePacket = {
	code: number;
	col: number;
	row: number;
	final: "M" | "m";
};

type SelectionPoint = {
	line: number;
	col: number;
};

type SelectionArea = "root" | "cluster";

type SelectionLocation = {
	area: SelectionArea;
	point: SelectionPoint;
};

type ScrollMetrics = {
	width: number;
	rawRows: number;
	cluster: FixedEditorCluster;
	scrollableRows: number;
};

const COMPOSITOR_OWNER = Symbol("pi.enhance.tui.fixedBottomEditor.compositorOwner.v1");
const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 24;
const DOUBLE_CLICK_MS = 500;
const CONTEXT_MENU_MOUSE_REPORTING_PAUSE_MS = 1200;
const WHEEL_REPAINT_COALESCE_MS = 8;

export function enterAlternateScreen(): string {
	return "\x1b[?1049h";
}

export function exitAlternateScreen(): string {
	return "\x1b[?1049l";
}

export function disableAlternateScrollMode(): string {
	return "\x1b[?1007l";
}

export function enableMouseReporting(): string {
	return "\x1b[?1002h\x1b[?1006h";
}

export function disableMouseReporting(): string {
	return "\x1b[?1006l\x1b[?1002l\x1b[?1000l";
}

export function enableAlternateScrollMode(): string {
	return "\x1b[?1007h";
}

export function beginSynchronizedOutput(): string {
	return "\x1b[?2026h";
}

export function endSynchronizedOutput(): string {
	return "\x1b[?2026l";
}

export function setScrollRegion(top: number, bottom: number): string {
	return `\x1b[${top};${bottom}r`;
}

export function resetScrollRegion(): string {
	return "\x1b[r";
}

export function moveCursor(row: number, col: number): string {
	return `\x1b[${row};${col}H`;
}

export function clearLine(): string {
	return "\x1b[2K";
}

export function hideCursor(): string {
	return "\x1b[?25l";
}

export function showCursor(): string {
	return "\x1b[?25h";
}

export function resetFixedBottomEditorTerminalState(): string {
	return (
		beginSynchronizedOutput() +
		resetScrollRegion() +
		disableMouseReporting() +
		enableAlternateScrollMode() +
		exitAlternateScreen() +
		showCursor() +
		endSynchronizedOutput()
	);
}

export function buildFixedEditorClusterPaint(
	cluster: FixedEditorCluster,
	terminalRows: number,
	width: number,
	showHardwareCursor: boolean,
): string {
	if (cluster.lines.length === 0) return "";

	const safeRows = Math.max(1, Math.floor(terminalRows));
	const safeWidth = Math.max(1, Math.floor(width));
	const startRow = Math.max(1, safeRows - cluster.lines.length + 1);
	let buffer = resetScrollRegion();

	for (let index = 0; index < cluster.lines.length; index++) {
		buffer += moveCursor(startRow + index, 1);
		buffer += clearLine();
		buffer += sanitizeLine(cluster.lines[index] ?? "", safeWidth);
	}

	buffer += buildFixedEditorCursorRestore(cluster, terminalRows, width, showHardwareCursor);
	return buffer;
}

export function buildFixedEditorCursorRestore(
	cluster: FixedEditorCluster,
	terminalRows: number,
	width: number,
	showHardwareCursor: boolean,
): string {
	if (cluster.lines.length === 0) return resetScrollRegion() + hideCursor();

	const safeRows = Math.max(1, Math.floor(terminalRows));
	const safeWidth = Math.max(1, Math.floor(width));
	const startRow = Math.max(1, safeRows - cluster.lines.length + 1);
	let buffer = resetScrollRegion();

	if (cluster.cursor && showHardwareCursor) {
		const cursorRow = Math.max(0, Math.min(cluster.cursor.row, cluster.lines.length - 1));
		const cursorCol = Math.max(0, Math.min(cluster.cursor.col, safeWidth - 1));
		buffer += moveCursor(startRow + cursorRow, cursorCol + 1);
		buffer += showCursor();
	} else {
		buffer += hideCursor();
	}

	return buffer;
}

export function renderFixedEditorCluster(input: FixedEditorClusterInput): FixedEditorCluster {
	const width = coerceDimension(input.width);
	const maxHeight = coerceDimension(input.maxHeight);
	if (width <= 0 || maxHeight <= 0) {
		return { lines: [] };
	}

	const sections = collectClusterSections(input, width);
	if (Object.values(sections).every((lines) => lines.length === 0)) {
		return { lines: [] };
	}

	const editor = capEditorLines(sections.editor, maxHeight);
	let remaining = maxHeight - editor.length;

	const top = takeTail(sections.top, remaining);
	remaining -= top.length;

	const secondary = takeTail(sections.secondary, remaining);
	remaining -= secondary.length;

	const lastPrompt = takeTail(sections.lastPrompt, remaining);
	remaining -= lastPrompt.length;

	const status = takeTail(sections.status, remaining);

	const visibleLines = [...status, ...top, ...editor, ...secondary, ...lastPrompt];
	const lines = visibleLines.map((line) => line.line);
	const cursorRow = findCursorLineIndex(visibleLines);

	const editorStartIndex = status.length + top.length;
	const editorCount = editor.length;
	const editorBounds = editorCount > 0 ? { start: editorStartIndex, count: editorCount } : undefined;

	if (cursorRow === -1) {
		return { lines, editorBounds };
	}

	return {
		lines,
		cursor: {
			row: cursorRow,
			col: visibleLines[cursorRow]!.cursorCol!,
		},
		editorBounds,
	};
}

function coerceDimension(value: number): number {
	return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

type ClusterLine = {
	line: string;
	cursorCol?: number;
};

type ClusterSections = {
	status: ClusterLine[];
	top: ClusterLine[];
	editor: ClusterLine[];
	secondary: ClusterLine[];
	lastPrompt: ClusterLine[];
};

function collectClusterSections(input: FixedEditorClusterInput, width: number): ClusterSections {
	return {
		status: normalizeLines(input.statusLines, width),
		top: normalizeLines(input.topLines, width),
		editor: normalizeLines(input.editorLines, width),
		secondary: normalizeLines(input.secondaryLines, width),
		lastPrompt: normalizeLines(input.lastPromptLines, width),
	};
}

function normalizeLines(lines: readonly string[] | undefined, width: number): ClusterLine[] {
	return lines
		? [...lines].map((line) => extractCursorMarker(truncateVisibleLine(sanitizeClusterLine(line), width)))
		: [];
}

function sanitizeClusterLine(line: string): string {
	const placeholder = "\uE000ALPS_CURSOR\uE000";
	const withPlaceholder = String(line).split(FIXED_EDITOR_CURSOR_MARKER).join(placeholder);
	return sanitizeTerminalText(withPlaceholder, { allowNewline: false, allowTab: true, preserveSgr: true })
		.split(placeholder)
		.join(FIXED_EDITOR_CURSOR_MARKER);
}

function extractCursorMarker(line: string): ClusterLine {
	let cleanedLine = line;
	let cursorCol: number | undefined;
	let markerIndex = cleanedLine.indexOf(FIXED_EDITOR_CURSOR_MARKER);
	while (markerIndex !== -1) {
		if (cursorCol === undefined) {
			cursorCol = visibleWidth(cleanedLine.slice(0, markerIndex));
		}
		cleanedLine =
			cleanedLine.slice(0, markerIndex) + cleanedLine.slice(markerIndex + FIXED_EDITOR_CURSOR_MARKER.length);
		markerIndex = cleanedLine.indexOf(FIXED_EDITOR_CURSOR_MARKER, markerIndex);
	}
	return cursorCol === undefined ? { line: cleanedLine } : { line: cleanedLine, cursorCol };
}

function truncateVisibleLine(line: string, width: number): string {
	return visibleWidth(line) <= width ? line : truncateToWidth(line, width, "", false);
}

function capEditorLines(lines: ClusterLine[], count: number): ClusterLine[] {
	if (count <= 0) return [];
	if (lines.length <= count) return lines;

	const cursorIndex = findCursorLineIndex(lines);
	if (cursorIndex !== -1) {
		const start = Math.max(0, Math.min(cursorIndex - count + 1, lines.length - count));
		return lines.slice(start, start + count);
	}

	return lines.slice(0, count);
}

function takeTail(lines: ClusterLine[], count: number): ClusterLine[] {
	if (count <= 0) return [];
	return lines.length <= count ? lines : lines.slice(lines.length - count);
}

function findCursorLineIndex(lines: readonly ClusterLine[]): number {
	for (let index = lines.length - 1; index >= 0; index--) {
		if (lines[index]!.cursorCol !== undefined) {
			return index;
		}
	}
	return -1;
}

export class FixedBottomEditorCompositor {
	private readonly tui: any;
	private readonly terminal: FixedEditorTerminal;
	private readonly renderCluster: (width: number, terminalRows: number) => FixedEditorCluster;
	private readonly getShowHardwareCursor: () => boolean;
	private keyboardScrollShortcuts: { up: string; down: string };
	private readonly onCopySelection: ((text: string) => void) | null;
	private readonly decorateCopyText: ((text: string) => string) | null;
	private readonly processLike: ProcessWithExit;
	private readonly onEditorClick?: (
		visualRow: number,
		visualCol: number,
		clickType: "single" | "double" | "triple",
	) => void;
	private readonly onEditorDrag?: (visualRow: number, visualCol: number) => void;
	private readonly onEditorRelease?: () => void;
	private readonly isBeautifiedEditor?: () => boolean;
	private lastEditorClick: { row: number; col: number; at: number } | null = null;
	private editorClickCount = 0;
	private editorDragging = false;
	private lastCluster: FixedEditorCluster | null = null;
	private readonly patchedRenders: RenderPatch[] = [];
	private originalWrite: TerminalWrite | null = null;
	private originalRender: TuiRender | null = null;
	private originalDoRender: TuiDoRender | null = null;
	private originalOwnRowsDescriptor: PropertyDescriptor | undefined;
	private originalRowsDescriptor: PropertyDescriptor | undefined;
	private writeWrapper: TerminalWrite | null = null;
	private renderWrapper: TuiRender | null = null;
	private doRenderWrapper: TuiDoRender | null = null;
	private rowsGetter: (() => number) | null = null;
	private removeInputListener: (() => void) | null = null;
	private mouseReportingResumeTimer: ReturnType<typeof setTimeout> | null = null;
	private wheelFlushTimer: ReturnType<typeof setTimeout> | null = null;
	private pendingWheelDelta = 0;
	private readonly ownerToken = Symbol("pi.enhance.tui.fixedBottomEditor.compositor.instance");
	private installed = false;
	private disposed = false;
	private writing = false;
	private renderingCluster = false;
	private renderingScrollableRoot = false;
	private checkingOverlay = false;
	private doRendering = false;
	private emergencyCleanup: (() => void) | null = null;
	private scrollOffset = 0;
	private maxScrollOffset = 0;
	private lastRootLineCount = 0;
	private rootLines: string[] = [];
	private visibleRootStart = 0;
	private visibleRootLines: string[] = [];
	private visibleClusterLines: string[] = [];
	private visibleScrollableRows = 0;
	private selectionArea: SelectionArea | null = null;
	private selectionAnchor: SelectionPoint | null = null;
	private selectionFocus: SelectionPoint | null = null;
	private selectionDragging = false;
	private preserveSelectionFocusOnRelease = false;
	private lastLeftPress: { area: SelectionArea; line: number; at: number } | null = null;

	constructor(options: FixedBottomEditorCompositorOptions) {
		this.tui = options.tui;
		this.terminal = options.terminal;
		this.renderCluster = options.renderCluster;
		this.getShowHardwareCursor = options.getShowHardwareCursor ?? (() => true);
		this.keyboardScrollShortcuts = options.keyboardScrollShortcuts ?? { up: "super+up", down: "super+down" };
		this.onCopySelection = options.onCopySelection ?? null;
		this.decorateCopyText = options.decorateCopyText ?? null;
		this.processLike = options.processLike ?? process;
		this.onEditorClick = options.onEditorClick;
		this.onEditorDrag = options.onEditorDrag;
		this.onEditorRelease = options.onEditorRelease;
		this.isBeautifiedEditor = options.isBeautifiedEditor;
	}

	install(): void {
		if (this.installed) return;
		if (this.disposed) {
			throw new Error("[pi-enhance-tui] fixed bottom editor compositor has been disposed");
		}
		if (typeof this.terminal.write !== "function") {
			throw new Error("[pi-enhance-tui] fixed bottom editor compositor expected terminal.write(data) to exist");
		}
		this.assertCanOwnCompositor();

		this.originalWrite = this.terminal.write;
		const tuiProto = this.tui ? Object.getPrototypeOf(this.tui) : undefined;
		this.originalRender = typeof tuiProto?.render === "function" ? (tuiProto.render as TuiRender) : null;
		this.originalDoRender = typeof tuiProto?.doRender === "function" ? (tuiProto.doRender as TuiDoRender) : null;
		this.originalOwnRowsDescriptor = Object.getOwnPropertyDescriptor(this.terminal, "rows");
		this.originalRowsDescriptor = findRowsDescriptor(this.terminal);

		try {
			this.writeOriginal(
				beginSynchronizedOutput() +
					enterAlternateScreen() +
					disableAlternateScrollMode() +
					enableMouseReporting() +
					endSynchronizedOutput(),
			);
			this.emergencyCleanup = () => {
				if (!this.disposed) {
					this.writeResetSequenceBestEffort();
				}
			};
			this.processLike.once("exit", this.emergencyCleanup);

			this.rowsGetter = () => this.getScrollableRows();
			Object.defineProperty(this.terminal, "rows", {
				configurable: true,
				get: this.rowsGetter,
			});

			this.renderWrapper = (width: number, ...args: unknown[]) => this.renderScrollableRoot(width, ...args);
			this.doRenderWrapper = (...args: unknown[]) => this.doRender(...args);
			this.writeWrapper = (data: string) => this.write(data);

			if (this.originalRender) {
				this.tui.render = this.renderWrapper;
			}
			if (this.originalDoRender) {
				this.tui.doRender = this.doRenderWrapper;
			}
			if (typeof this.tui.addInputListener === "function") {
				this.removeInputListener = this.tui.addInputListener((data: string) => this.handleInput(data));
			}
			this.terminal.write = this.writeWrapper;
			this.markOwner();
			this.installed = true;
		} catch (error) {
			this.restorePatches(true);
			throw error;
		}
	}

	hideRenderable(target: FixedEditorRenderable): void {
		if (this.patchedRenders.some((patch) => patch.target === target)) return;
		if (typeof target.render !== "function") {
			throw new Error("[pi-enhance-tui] hideRenderable expected target.render(width) to exist");
		}

		const originalRender = target.render;
		const hiddenRender = () => [];
		this.patchedRenders.push({ target, originalRender, hiddenRender });
		target.render = hiddenRender;
	}

	renderHidden(target: FixedEditorRenderable, width: number): string[] {
		const patch = this.patchedRenders.find((candidate) => candidate.target === target);
		const render = patch?.originalRender ?? target.render;
		return render.call(target, width);
	}

	requestRepaint(): void {
		if (this.disposed || this.hasVisibleOverlay()) return;

		const rawRows = this.getRawRows();
		const width = this.getTerminalWidth();
		const cluster = this.getCluster(width, rawRows);
		if (cluster.lines.length === 0) return;

		this.writeOriginal(
			beginSynchronizedOutput() +
				buildFixedEditorClusterPaint(this.decorateCluster(cluster), rawRows, width, this.getShowHardwareCursor()) +
				endSynchronizedOutput(),
		);
	}

	setKeyboardScrollShortcuts(shortcuts: { up: string; down: string }): void {
		this.keyboardScrollShortcuts = shortcuts;
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;

		for (const patch of this.patchedRenders.splice(0)) {
			if (patch.target.render === patch.hiddenRender) {
				patch.target.render = patch.originalRender;
			}
		}

		this.restorePatches(true);
	}

	private restorePatches(writeResetSequence: boolean): void {
		const shouldRestoreWrite = this.originalWrite && this.terminal.write === this.writeWrapper;
		const shouldRestoreRows = Object.getOwnPropertyDescriptor(this.terminal, "rows")?.get === this.rowsGetter;
		if (this.originalWrite && shouldRestoreWrite) {
			this.terminal.write = this.originalWrite;
		}
		if (this.emergencyCleanup) {
			this.processLike.removeListener("exit", this.emergencyCleanup);
			this.emergencyCleanup = null;
		}
		this.removeInputListener?.();
		this.removeInputListener = null;
		if (this.mouseReportingResumeTimer) {
			clearTimeout(this.mouseReportingResumeTimer);
			this.mouseReportingResumeTimer = null;
		}
		this.clearPendingWheelScroll();
		this.clearSelection();
		if (this.originalRender && this.tui.render === this.renderWrapper) {
			this.tui.render = this.originalRender;
		}
		if (this.originalDoRender && this.tui.doRender === this.doRenderWrapper) {
			this.tui.doRender = this.originalDoRender;
		}
		if (shouldRestoreRows) {
			this.restoreRowsDescriptor();
		}
		this.clearOwner();
		this.installed = false;
		if (writeResetSequence && this.originalWrite) {
			this.writeResetSequenceBestEffort();
		}
	}

	private doRender(...args: unknown[]): unknown {
		if (!this.originalDoRender) return undefined;
		if (this.doRendering) {
			return this.originalDoRender.apply(this.tui, args);
		}
		if (this.disposed || this.hasVisibleOverlay()) {
			return this.originalDoRender.apply(this.tui, args);
		}

		this.doRendering = true;
		try {
			const result = this.originalDoRender.apply(this.tui, args);
			this.requestRepaint();
			return result;
		} finally {
			this.doRendering = false;
		}
	}

	private renderScrollableRoot(width: number, ...args: unknown[]): string[] {
		if (!this.originalRender) return [];
		if (this.disposed || this.renderingScrollableRoot || this.hasVisibleOverlay()) {
			return this.originalRender.call(this.tui, width, ...args);
		}

		this.renderingScrollableRoot = true;
		try {
			this.refreshRootWindow(coercePositiveInteger(width, DEFAULT_COLUMNS), ...args);
			return this.visibleRootLines.map((line: string, index: number) =>
				this.renderSelectionHighlight(line, this.visibleRootStart + index, "root"),
			);
		} finally {
			this.renderingScrollableRoot = false;
		}
	}

	private write(data: string): void {
		if (this.disposed || this.writing || this.hasVisibleOverlay()) {
			this.writeOriginal(data);
			return;
		}

		this.writing = true;
		try {
			const rawRows = this.getRawRows();
			const width = this.getTerminalWidth();
			const cluster = this.getCluster(width, rawRows);
			if (cluster.lines.length === 0) {
				this.writeOriginal(data);
				return;
			}

			const scrollBottom = Math.max(1, rawRows - cluster.lines.length);
			const screenRow = this.getCurrentScreenRow(scrollBottom);
			this.writeOriginal(
				beginSynchronizedOutput() +
					setScrollRegion(1, scrollBottom) +
					moveCursor(screenRow, 1) +
					data +
					buildFixedEditorClusterPaint(
						this.decorateCluster(cluster),
						rawRows,
						width,
						this.getShowHardwareCursor(),
					) +
					endSynchronizedOutput(),
			);
		} finally {
			this.writing = false;
		}
	}

	private handleInput(data: string): { consume?: boolean; data?: string } | undefined {
		if (this.disposed || this.hasVisibleOverlay()) return undefined;

		if (this.copySelectionOnCopyCommand(data)) {
			return { consume: true };
		}

		const mousePackets = parseSgrMousePackets(data);
		if (mousePackets) {
			this.handleMousePackets(mousePackets);
			return { consume: true };
		}

		this.flushWheelScroll();
		const keyboardDelta = parseKeyboardScrollDelta(data, this.keyboardScrollShortcuts);
		if (keyboardDelta === 0) return undefined;

		this.scrollBy(keyboardDelta);
		return { consume: true };
	}

	private copySelectionOnCopyCommand(data: string): boolean {
		if (!isCopyCommandInput(data)) return false;
		const selectedText = this.getSelectedText();
		if (!selectedText) return false;
		this.onCopySelection?.(selectedText);
		return true;
	}

	private getScrollableRows(): number {
		this.flushWheelScroll();
		const rawRows = this.getRawRows();
		if (this.disposed || this.writing || this.renderingCluster || this.checkingOverlay || this.hasVisibleOverlay()) {
			return rawRows;
		}

		const cluster = this.getCluster(this.getTerminalWidth(), rawRows);
		return Math.max(1, rawRows - cluster.lines.length);
	}

	private refreshRootWindow(width: number, ...args: unknown[]): void {
		if (!this.originalRender) return;

		const rawRows = this.getRawRows();
		const renderWidth = Math.max(1, Math.floor(width));
		const cluster = this.getCluster(renderWidth, rawRows);
		const scrollableRows = Math.max(1, rawRows - cluster.lines.length);
		const lines = this.originalRender.call(this.tui, renderWidth, ...args);
		this.rootLines = Array.isArray(lines) ? lines : [];
		if (this.scrollOffset > 0 && this.lastRootLineCount > 0 && this.rootLines.length > this.lastRootLineCount) {
			this.scrollOffset += this.rootLines.length - this.lastRootLineCount;
		}
		this.lastRootLineCount = this.rootLines.length;
		this.maxScrollOffset = Math.max(0, this.rootLines.length - scrollableRows);
		this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, this.maxScrollOffset));
		this.updateVisibleRootWindow(scrollableRows);
	}

	private updateVisibleRootWindow(scrollableRows = this.visibleScrollableRows): number {
		const rows = Math.max(1, scrollableRows);
		const start = Math.max(0, this.rootLines.length - rows - this.scrollOffset);
		const visibleLines = this.rootLines.slice(start, start + rows);
		while (visibleLines.length < rows) {
			visibleLines.push("");
		}
		this.visibleRootStart = start;
		this.visibleScrollableRows = rows;
		this.visibleRootLines = visibleLines;
		return start;
	}

	private scrollBy(delta: number, options: { paintCluster?: boolean } = {}): void {
		const metrics = this.prepareScrollMetrics(this.getTerminalWidth());
		const nextOffset = Math.max(0, Math.min(this.scrollOffset + delta, this.maxScrollOffset));
		if (nextOffset === this.scrollOffset) return;

		const hadClusterSelection = this.selectionArea === "cluster";
		this.clearSelection();
		this.lastLeftPress = null;
		this.scrollOffset = nextOffset;
		this.repaintScrollableViewport(metrics, {
			paintCluster: options.paintCluster === true || hadClusterSelection,
		});
	}

	private prepareScrollMetrics(width: number): ScrollMetrics {
		const safeWidth = coercePositiveInteger(width, DEFAULT_COLUMNS);
		if (this.rootLines.length === 0 || this.visibleScrollableRows <= 0) {
			this.refreshRootWindow(safeWidth);
		}

		const metrics = this.getScrollMetrics(safeWidth);
		this.updateScrollBoundsFromMetrics(metrics);
		return metrics;
	}

	private getScrollMetrics(width: number): ScrollMetrics {
		const rawRows = this.getRawRows();
		const cluster = this.getCluster(width, rawRows);
		return {
			width,
			rawRows,
			cluster,
			scrollableRows: Math.max(1, rawRows - cluster.lines.length),
		};
	}

	private updateScrollBoundsFromMetrics(metrics: ScrollMetrics): void {
		this.maxScrollOffset = Math.max(0, this.rootLines.length - metrics.scrollableRows);
		this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, this.maxScrollOffset));
		this.updateVisibleRootWindow(metrics.scrollableRows);
	}

	private repaintScrollableViewport(metrics: ScrollMetrics, options: { paintCluster?: boolean } = {}): void {
		if (this.disposed || this.writing || this.hasVisibleOverlay() || !this.installed) return;

		const cluster = this.decorateCluster(metrics.cluster);
		const start = this.updateVisibleRootWindow(metrics.scrollableRows);
		let buffer = beginSynchronizedOutput() + setScrollRegion(1, metrics.scrollableRows) + moveCursor(1, 1);

		for (let row = 0; row < metrics.scrollableRows; row++) {
			if (row > 0) buffer += "\r\n";
			buffer += clearLine();
			buffer += sanitizeLine(
				this.renderSelectionHighlight(this.visibleRootLines[row] ?? "", start + row, "root"),
				metrics.width,
			);
		}

		buffer +=
			options.paintCluster === true
				? buildFixedEditorClusterPaint(cluster, metrics.rawRows, metrics.width, this.getShowHardwareCursor())
				: buildFixedEditorCursorRestore(cluster, metrics.rawRows, metrics.width, this.getShowHardwareCursor());
		buffer += endSynchronizedOutput();
		this.writeOriginal(buffer);
	}

	private getCluster(width: number, terminalRows: number): FixedEditorCluster {
		const wasRenderingCluster = this.renderingCluster;
		this.renderingCluster = true;
		try {
			const rendered = this.renderCluster(width, terminalRows) ?? { lines: [] };
			const cluster = normalizeCluster(rendered, width, terminalRows);
			cluster.editorBounds = rendered.editorBounds;
			this.lastCluster = cluster;
			this.visibleClusterLines = cluster.lines;
			return cluster;
		} finally {
			this.renderingCluster = wasRenderingCluster;
		}
	}

	jumpToPreviousRootTarget(targetLines: readonly number[]): boolean {
		return this.jumpToRootTarget(targetLines, "previous");
	}

	jumpToNextRootTarget(targetLines: readonly number[]): boolean {
		return this.jumpToRootTarget(targetLines, "next");
	}

	jumpToRootBottom(): boolean {
		this.flushWheelScroll();
		if (this.disposed || this.hasVisibleOverlay() || this.scrollOffset === 0) return false;
		const metrics = this.prepareScrollMetrics(this.getTerminalWidth());
		const hadClusterSelection = this.selectionArea === "cluster";
		this.clearSelection();
		this.lastLeftPress = null;
		this.scrollOffset = 0;
		this.repaintScrollableViewport(metrics, { paintCluster: hadClusterSelection });
		return true;
	}

	private jumpToRootTarget(targetLines: readonly number[], direction: "previous" | "next"): boolean {
		this.flushWheelScroll();
		if (this.disposed || targetLines.length === 0 || this.hasVisibleOverlay()) return false;
		const width = this.getTerminalWidth();
		this.refreshRootWindow(width);
		const metrics = this.prepareScrollMetrics(width);
		const start = this.visibleRootStart;
		const candidates =
			direction === "previous"
				? targetLines.filter((line) => line < start).sort((a, b) => b - a)
				: targetLines.filter((line) => line > start).sort((a, b) => a - b);
		for (const target of candidates) {
			const nextOffset = Math.max(
				0,
				Math.min(this.lastRootLineCount - Math.max(1, this.visibleScrollableRows) - target, this.maxScrollOffset),
			);
			if (nextOffset === this.scrollOffset) continue;
			const hadClusterSelection = this.selectionArea === "cluster";
			this.clearSelection();
			this.lastLeftPress = null;
			this.scrollOffset = nextOffset;
			this.repaintScrollableViewport(metrics, { paintCluster: hadClusterSelection });
			return true;
		}
		return false;
	}

	private getRawRows(): number {
		const descriptor = this.originalRowsDescriptor;
		if (descriptor?.get) {
			return coercePositiveInteger(descriptor.get.call(this.terminal), DEFAULT_ROWS);
		}
		if (descriptor && "value" in descriptor) {
			return coercePositiveInteger(descriptor.value, DEFAULT_ROWS);
		}
		return DEFAULT_ROWS;
	}

	private getTerminalWidth(): number {
		return coercePositiveInteger(Reflect.get(this.terminal, "columns"), DEFAULT_COLUMNS);
	}

	private getCurrentScreenRow(scrollBottom: number): number {
		const cursorRow =
			typeof this.tui?.hardwareCursorRow === "number"
				? this.tui.hardwareCursorRow
				: typeof this.tui?.cursorRow === "number"
					? this.tui.cursorRow
					: 0;
		const viewportTop = typeof this.tui?.previousViewportTop === "number" ? this.tui.previousViewportTop : 0;
		return Math.max(1, Math.min(scrollBottom, cursorRow - viewportTop + 1));
	}

	private handleMousePackets(packets: SgrMousePacket[]): void {
		let wheelDelta = 0;
		for (const packet of packets) {
			const delta = mouseScrollDelta(packet);
			if (delta !== 0) {
				wheelDelta += delta;
				continue;
			}

			if (wheelDelta !== 0) {
				this.queueWheelScroll(wheelDelta);
				wheelDelta = 0;
			}
			this.flushWheelScroll();
			this.handleMousePacket(packet);
		}

		if (wheelDelta !== 0) {
			this.queueWheelScroll(wheelDelta);
		}
	}

	private queueWheelScroll(delta: number): void {
		this.selectionDragging = false;
		this.pendingWheelDelta += delta;
		if (this.wheelFlushTimer) return;

		this.wheelFlushTimer = setTimeout(() => this.flushWheelScroll(), WHEEL_REPAINT_COALESCE_MS);
		this.wheelFlushTimer.unref?.();
	}

	private flushWheelScroll(): void {
		if (this.wheelFlushTimer) {
			clearTimeout(this.wheelFlushTimer);
			this.wheelFlushTimer = null;
		}
		const delta = this.pendingWheelDelta;
		this.pendingWheelDelta = 0;
		if (delta !== 0) this.scrollBy(delta);
	}

	private clearPendingWheelScroll(): void {
		if (this.wheelFlushTimer) {
			clearTimeout(this.wheelFlushTimer);
			this.wheelFlushTimer = null;
		}
		this.pendingWheelDelta = 0;
	}

	private getEditorCoordinatesForPacket(
		packet: SgrMousePacket,
		clampIfDragging = false,
	): { visualRow: number; visualCol: number } | null {
		const rawRows = this.getRawRows();
		const width = this.getTerminalWidth();
		const cluster = this.lastCluster ?? this.getCluster(width, rawRows);
		if (cluster.lines.length === 0 || !cluster.editorBounds) return null;

		const startRow = Math.max(1, rawRows - cluster.lines.length + 1);
		const { start: editorStart, count: editorCount } = cluster.editorBounds;
		const isBeautified = this.isBeautifiedEditor?.() ?? true;
		const maxContentRows = isBeautified ? Math.max(1, editorCount - 2) : Math.max(1, editorCount);

		if (clampIfDragging && this.editorDragging) {
			let visualRow = 0;
			let visualCol = 0;

			if (packet.row < startRow + editorStart) {
				visualRow = 0;
				visualCol = 0;
			} else if (packet.row >= startRow + editorStart + editorCount) {
				visualRow = maxContentRows - 1;
				visualCol = Math.max(0, packet.col - 1 - (isBeautified ? 2 : 0));
			} else {
				const clusterLine = packet.row - startRow;
				const editorRow = clusterLine - editorStart;
				if (isBeautified) {
					if (editorRow === 0) {
						visualRow = 0;
						visualCol = 0;
					} else if (editorRow >= editorCount - 1) {
						visualRow = maxContentRows - 1;
						visualCol = Math.max(0, packet.col - 1 - 2);
					} else {
						visualRow = editorRow - 1;
						visualCol = Math.max(0, packet.col - 1 - 2);
					}
				} else {
					visualRow = editorRow;
					visualCol = Math.max(0, packet.col - 1);
				}
			}

			return { visualRow, visualCol };
		}

		if (packet.row < startRow || packet.row >= startRow + cluster.lines.length) return null;

		const clusterLine = packet.row - startRow;
		if (clusterLine < editorStart || clusterLine >= editorStart + editorCount) return null;

		const editorRow = clusterLine - editorStart;

		let visualRow: number;
		let visualCol: number;

		if (isBeautified) {
			if (editorRow === 0) {
				visualRow = 0;
				visualCol = 0;
			} else if (editorRow >= editorCount - 1) {
				visualRow = Math.max(0, editorCount - 3);
				visualCol = Math.max(0, packet.col - 1 - 2);
			} else {
				visualRow = editorRow - 1;
				visualCol = Math.max(0, packet.col - 1 - 2);
			}
		} else {
			visualRow = editorRow;
			visualCol = Math.max(0, packet.col - 1);
		}

		return { visualRow, visualCol };
	}

	private handleMousePacket(packet: SgrMousePacket): void {
		const editorCoords = this.getEditorCoordinatesForPacket(packet, true);

		if (isRightPress(packet)) {
			this.selectionDragging = false;
			this.editorDragging = false;
			this.preserveSelectionFocusOnRelease = false;

			if (editorCoords && this.getEditorCoordinatesForPacket(packet, false)) {
				this.pauseMouseReportingForContextMenu();
				return;
			}

			const location = this.selectionLocationForPacket(packet);
			const selectedText = this.isLocationInsideSelection(location) ? this.getSelectedText() : "";
			if (selectedText) {
				this.pauseMouseReportingForContextMenu();
				return;
			}
			const hadClusterSelection = this.selectionArea === "cluster";
			this.clearSelection();
			this.lastLeftPress = null;
			if (hadClusterSelection) {
				this.repaintScrollableViewport(this.getScrollMetrics(this.getTerminalWidth()), { paintCluster: true });
			}
			this.pauseMouseReportingForContextMenu();
			return;
		}

		if (this.scrollSelectionAtViewportEdge(packet)) return;

		if (isMouseRelease(packet)) {
			if (this.editorDragging) {
				this.editorDragging = false;
				this.onEditorRelease?.();
				this.requestRepaint();
				return;
			}
			if (this.selectionDragging) {
				this.finishSelection(packet, this.selectionLocationForPacket(packet));
				return;
			}
		}

		if (this.editorDragging && isLeftDrag(packet) && editorCoords) {
			this.onEditorDrag?.(editorCoords.visualRow, editorCoords.visualCol);
			this.requestRepaint();
			return;
		}

		const unconstrainedEditorCoords = this.getEditorCoordinatesForPacket(packet, false);
		if (unconstrainedEditorCoords && isLeftPress(packet)) {
			this.clearSelection();
			this.selectionDragging = false;

			const now = Date.now();
			if (
				this.lastEditorClick &&
				now - this.lastEditorClick.at <= DOUBLE_CLICK_MS &&
				this.lastEditorClick.row === unconstrainedEditorCoords.visualRow &&
				Math.abs(this.lastEditorClick.col - unconstrainedEditorCoords.visualCol) <= 2
			) {
				this.editorClickCount = (this.editorClickCount % 3) + 1;
			} else {
				this.editorClickCount = 1;
			}
			this.lastEditorClick = {
				row: unconstrainedEditorCoords.visualRow,
				col: unconstrainedEditorCoords.visualCol,
				at: now,
			};

			if (this.editorClickCount === 2) {
				this.onEditorClick?.(unconstrainedEditorCoords.visualRow, unconstrainedEditorCoords.visualCol, "double");
			} else if (this.editorClickCount === 3) {
				this.onEditorClick?.(unconstrainedEditorCoords.visualRow, unconstrainedEditorCoords.visualCol, "triple");
			} else {
				this.onEditorClick?.(unconstrainedEditorCoords.visualRow, unconstrainedEditorCoords.visualCol, "single");
			}

			this.editorDragging = true;
			this.requestRepaint();
			return;
		}

		const location = this.selectionLocationForPacket(packet);
		if (!location) return;

		if (isLeftPress(packet)) {
			this.startSelection(location);
			return;
		}

		if (this.selectionDragging && isLeftDrag(packet) && location.area === this.selectionArea) {
			this.lastLeftPress = null;
			this.preserveSelectionFocusOnRelease = false;
			this.selectionFocus = location.point;
			this.repaintScrollableViewport(this.getScrollMetrics(this.getTerminalWidth()), { paintCluster: true });
		}
	}

	private startSelection(location: SelectionLocation): void {
		const now = Date.now();
		const line = location.point.line;
		if (
			this.lastLeftPress &&
			this.lastLeftPress.area === location.area &&
			this.lastLeftPress.line === line &&
			now - this.lastLeftPress.at <= DOUBLE_CLICK_MS
		) {
			this.selectionArea = location.area;
			this.selectionAnchor = { line, col: 0 };
			this.selectionFocus = { line, col: this.selectionLineWidth(location.area, line) };
			this.selectionDragging = true;
			this.preserveSelectionFocusOnRelease = true;
			this.lastLeftPress = null;
			this.repaintScrollableViewport(this.getScrollMetrics(this.getTerminalWidth()), { paintCluster: true });
			return;
		}

		this.selectionArea = location.area;
		this.selectionAnchor = location.point;
		this.selectionFocus = location.point;
		this.selectionDragging = true;
		this.preserveSelectionFocusOnRelease = false;
		this.lastLeftPress = { area: location.area, line, at: now };
		this.repaintScrollableViewport(this.getScrollMetrics(this.getTerminalWidth()), { paintCluster: true });
	}

	private finishSelection(packet: SgrMousePacket, location: SelectionLocation | null): void {
		if (!this.preserveSelectionFocusOnRelease) {
			this.selectionFocus =
				location?.area === this.selectionArea
					? location.point
					: this.clampedSelectionPointForPacket(packet, this.selectionArea);
		}
		this.preserveSelectionFocusOnRelease = false;
		this.selectionDragging = false;
		const selectedText = this.getSelectedText();
		if (selectedText) {
			this.lastLeftPress = null;
			this.onCopySelection?.(selectedText);
		} else {
			this.clearSelection();
		}
		this.repaintScrollableViewport(this.getScrollMetrics(this.getTerminalWidth()), { paintCluster: true });
	}

	private selectionLocationForPacket(packet: SgrMousePacket): SelectionLocation | null {
		if (packet.row < 1) return null;
		const col = Math.max(0, packet.col - 1);
		if (packet.row <= this.visibleScrollableRows) {
			return { area: "root", point: { line: this.visibleRootStart + packet.row - 1, col } };
		}
		const clusterLine = packet.row - this.visibleScrollableRows - 1;
		if (clusterLine < 0 || clusterLine >= this.visibleClusterLines.length) return null;
		return { area: "cluster", point: { line: clusterLine, col } };
	}

	private scrollSelectionAtViewportEdge(packet: SgrMousePacket): boolean {
		if (!this.selectionDragging || this.selectionArea !== "root" || !isLeftDrag(packet)) return false;
		const delta = packet.row <= 1 ? 1 : packet.row >= this.visibleScrollableRows ? -1 : 0;
		if (delta === 0) return false;
		const metrics = this.prepareScrollMetrics(this.getTerminalWidth());
		const nextOffset = Math.max(0, Math.min(this.scrollOffset + delta, this.maxScrollOffset));
		if (nextOffset === this.scrollOffset) return false;
		this.lastLeftPress = null;
		this.preserveSelectionFocusOnRelease = true;
		this.scrollOffset = nextOffset;
		const start = this.updateVisibleRootWindow(metrics.scrollableRows);
		const edgeLine = delta > 0 ? start : start + Math.max(0, metrics.scrollableRows - 1);
		this.selectionFocus = { line: edgeLine, col: Math.max(0, packet.col - 1) };
		this.repaintScrollableViewport(metrics, { paintCluster: true });
		return true;
	}

	private clampedSelectionPointForPacket(packet: SgrMousePacket, area: SelectionArea | null): SelectionPoint {
		if (area === "cluster") {
			return {
				line: Math.max(
					0,
					Math.min(packet.row - this.visibleScrollableRows - 1, Math.max(0, this.visibleClusterLines.length - 1)),
				),
				col: Math.max(0, packet.col - 1),
			};
		}
		const row = Math.max(1, Math.min(packet.row, this.visibleScrollableRows));
		return { line: this.visibleRootStart + row - 1, col: Math.max(0, packet.col - 1) };
	}

	private decorateCluster(cluster: FixedEditorCluster): FixedEditorCluster {
		if (this.selectionArea !== "cluster") return cluster;
		return {
			...cluster,
			lines: cluster.lines.map((line: string, index: number) =>
				this.renderSelectionHighlight(line, index, "cluster"),
			),
		};
	}

	private renderSelectionHighlight(line: string, lineIndex: number, area: SelectionArea): string {
		const range = this.getSelectionRangeForLine(lineIndex, area);
		if (!range) return line;
		const plain = stripAnsi(line);
		const startCol = Math.max(0, Math.min(range.startCol, visibleWidth(plain)));
		const endCol = Math.max(startCol, Math.min(range.endCol, visibleWidth(plain)));
		if (startCol === endCol) return line;
		const before = sliceColumns(plain, 0, startCol);
		const selected = sliceColumns(plain, startCol, endCol);
		const after = sliceColumns(plain, endCol, Number.POSITIVE_INFINITY);
		return `${before}\x1b[7m${selected}\x1b[27m${after}`;
	}

	private selectionLineWidth(area: SelectionArea, lineIndex: number): number {
		const lines = area === "root" ? this.visibleRootLines : this.visibleClusterLines;
		const firstLine = area === "root" ? this.visibleRootStart : 0;
		return visibleWidth(stripAnsi(lines[lineIndex - firstLine] ?? ""));
	}

	public getSelectedText(): string {
		if (!this.selectionArea || !this.selectionAnchor || !this.selectionFocus) return "";
		const start =
			compareSelectionPoints(this.selectionAnchor, this.selectionFocus) <= 0
				? this.selectionAnchor
				: this.selectionFocus;
		const end = start === this.selectionAnchor ? this.selectionFocus : this.selectionAnchor;
		if (start.line === end.line && start.col === end.col) return "";
		const lines = this.selectionArea === "root" ? this.rootLines : this.visibleClusterLines;
		const selected: string[] = [];
		for (let lineIndex = start.line; lineIndex <= end.line; lineIndex++) {
			const line = stripAnsi(lines[lineIndex] ?? "");
			const startCol = lineIndex === start.line ? start.col : 0;
			const endCol = lineIndex === end.line ? end.col : Number.POSITIVE_INFINITY;
			selected.push(sliceColumns(line, startCol, endCol));
		}
		let copied = selected.join("\n");
		if (this.decorateCopyText) {
			copied = this.decorateCopyText(copied);
		}
		return copied.replace(/[ \t]+$/gm, "").trimEnd();
	}

	private getSelectionRangeForLine(
		lineIndex: number,
		area: SelectionArea,
	): { startCol: number; endCol: number } | null {
		if (this.selectionArea !== area || !this.selectionAnchor || !this.selectionFocus) return null;
		const start =
			compareSelectionPoints(this.selectionAnchor, this.selectionFocus) <= 0
				? this.selectionAnchor
				: this.selectionFocus;
		const end = start === this.selectionAnchor ? this.selectionFocus : this.selectionAnchor;
		if (lineIndex < start.line || lineIndex > end.line) return null;
		return {
			startCol: lineIndex === start.line ? start.col : 0,
			endCol: lineIndex === end.line ? end.col : Number.POSITIVE_INFINITY,
		};
	}

	private isLocationInsideSelection(location: SelectionLocation | null): boolean {
		if (!location || location.area !== this.selectionArea) return false;
		const range = this.getSelectionRangeForLine(location.point.line, location.area);
		return Boolean(range && location.point.col >= range.startCol && location.point.col < range.endCol);
	}

	private pauseMouseReportingForContextMenu(): void {
		if (this.mouseReportingResumeTimer) clearTimeout(this.mouseReportingResumeTimer);
		this.writeOriginal(beginSynchronizedOutput() + disableMouseReporting() + endSynchronizedOutput());
		this.mouseReportingResumeTimer = setTimeout(() => {
			this.mouseReportingResumeTimer = null;
			if (!this.disposed)
				this.writeOriginal(beginSynchronizedOutput() + enableMouseReporting() + endSynchronizedOutput());
		}, CONTEXT_MENU_MOUSE_REPORTING_PAUSE_MS);
		this.mouseReportingResumeTimer.unref?.();
	}

	private clearSelection(): void {
		this.selectionArea = null;
		this.selectionAnchor = null;
		this.selectionFocus = null;
		this.selectionDragging = false;
		this.preserveSelectionFocusOnRelease = false;
	}

	private writeOriginal(data: string): void {
		const write = this.originalWrite ?? this.terminal.write;
		write.call(this.terminal, data);
	}

	private restoreRowsDescriptor(): void {
		if (this.originalOwnRowsDescriptor) {
			Object.defineProperty(this.terminal, "rows", this.originalOwnRowsDescriptor);
			return;
		}

		Reflect.deleteProperty(this.terminal, "rows");
	}

	private writeResetSequenceBestEffort(): void {
		try {
			this.writeOriginal(resetFixedBottomEditorTerminalState());
		} catch {
			// ignore
		}
	}

	private assertCanOwnCompositor(): void {
		for (const target of [this.terminal, this.tui]) {
			const owner = getOwner(target);
			if (owner && owner !== this.ownerToken) {
				throw new Error(
					"[pi-enhance-tui] fixed bottom editor compositor conflict: terminal/TUI is already owned by another fixed editor",
				);
			}
		}
		if (this.hasTerminalWriteConflict() || this.hasRowsConflict() || this.hasTuiRenderConflict()) {
			throw new Error(
				"[pi-enhance-tui] fixed bottom editor compositor conflict: terminal/TUI is already patched by another compositor",
			);
		}
	}

	private hasTerminalWriteConflict(): boolean {
		const prototypeWrite = findPrototypeDescriptor(this.terminal, "write")?.value;
		return (
			typeof prototypeWrite === "function" &&
			Object.hasOwn(this.terminal, "write") &&
			this.terminal.write !== prototypeWrite
		);
	}

	private hasRowsConflict(): boolean {
		const ownRows = Object.getOwnPropertyDescriptor(this.terminal, "rows");
		return Boolean(ownRows?.get && !ownRows.set && findPrototypeDescriptor(this.terminal, "rows"));
	}

	private hasTuiRenderConflict(): boolean {
		return hasPrototypeMethodOverride(this.tui, "render") || hasPrototypeMethodOverride(this.tui, "doRender");
	}

	private markOwner(): void {
		setOwner(this.terminal, this.ownerToken);
		setOwner(this.tui, this.ownerToken);
	}

	private clearOwner(): void {
		clearOwner(this.terminal, this.ownerToken);
		clearOwner(this.tui, this.ownerToken);
	}

	private hasVisibleOverlay(): boolean {
		if (this.checkingOverlay) return false;

		this.checkingOverlay = true;
		try {
			if (typeof this.tui?.hasOverlay === "function") {
				return Boolean(this.tui.hasOverlay());
			}

			const overlayStack = Reflect.get(this.tui ?? {}, "overlayStack");
			return (
				Array.isArray(overlayStack) && overlayStack.some((entry) => isOverlayEntryVisible(entry, this.terminal))
			);
		} finally {
			this.checkingOverlay = false;
		}
	}
}

function parseKeyboardScrollDelta(
	data: string,
	shortcuts: { up: string; down: string } = { up: "super+up", down: "super+down" },
): number {
	if (isKeyRelease(data)) return 0;
	if (
		matchesConfiguredShortcut(data, shortcuts.up) ||
		matchesKey(data, "pageUp") ||
		matchesKey(data, "ctrl+shift+up") ||
		/^\x1b\[(?:5;9(?::[12])?~|1;6(?::[12])?A|57421;9(?::[12])?u|57419;6(?::[12])?u)$/.test(data)
	)
		return 10;
	if (
		matchesConfiguredShortcut(data, shortcuts.down) ||
		matchesKey(data, "pageDown") ||
		matchesKey(data, "ctrl+shift+down") ||
		/^\x1b\[(?:6;9(?::[12])?~|1;6(?::[12])?B|57422;9(?::[12])?u|57420;6(?::[12])?u)$/.test(data)
	)
		return -10;
	return 0;
}

function parseSgrMousePackets(data: string): SgrMousePacket[] | null {
	const pattern = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
	const packets: SgrMousePacket[] = [];
	let offset = 0;

	for (const match of data.matchAll(pattern)) {
		if (match.index !== offset) return null;
		offset = match.index + match[0].length;
		packets.push({
			code: Number(match[1]),
			col: Number(match[2]),
			row: Number(match[3]),
			final: match[4] as "M" | "m",
		});
	}

	return packets.length > 0 && offset === data.length ? packets : null;
}

function mouseBaseButton(code: number): number {
	return code & ~(4 | 8 | 16 | 32);
}

function mouseScrollDelta(packet: SgrMousePacket): number {
	if (packet.final !== "M") return 0;
	const baseButton = mouseBaseButton(packet.code);
	if (baseButton === 64) return 3;
	if (baseButton === 65) return -3;
	return 0;
}

function isLeftPress(packet: SgrMousePacket): boolean {
	return packet.final === "M" && mouseBaseButton(packet.code) === 0 && (packet.code & 32) === 0;
}

function isLeftDrag(packet: SgrMousePacket): boolean {
	return packet.final === "M" && mouseBaseButton(packet.code) === 0 && (packet.code & 32) !== 0;
}

function isRightPress(packet: SgrMousePacket): boolean {
	return packet.final === "M" && mouseBaseButton(packet.code) === 2 && (packet.code & 32) === 0;
}

function isMouseRelease(packet: SgrMousePacket): boolean {
	return packet.final === "m";
}

function compareSelectionPoints(a: SelectionPoint, b: SelectionPoint): number {
	return a.line === b.line ? a.col - b.col : a.line - b.line;
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function sliceColumns(text: string, startCol: number, endCol: number): string {
	let col = 0;
	let result = "";
	for (const { segment } of graphemeSegmenter.segment(text)) {
		const width = Math.max(0, visibleWidth(segment));
		if (col >= startCol && col < endCol) result += segment;
		col += width;
	}
	return result;
}

function findRowsDescriptor(terminal: FixedEditorTerminal): PropertyDescriptor | undefined {
	return findDescriptor(terminal, "rows");
}

function findDescriptor(target: unknown, property: PropertyKey): PropertyDescriptor | undefined {
	if (!isObjectLike(target)) return undefined;
	let owner: object | null = target;
	while (owner) {
		const descriptor = Object.getOwnPropertyDescriptor(owner, property);
		if (descriptor) return descriptor;
		owner = Object.getPrototypeOf(owner);
	}
	return undefined;
}

function findPrototypeDescriptor(target: unknown, property: PropertyKey): PropertyDescriptor | undefined {
	if (!isObjectLike(target)) return undefined;
	let owner: object | null = Object.getPrototypeOf(target);
	while (owner) {
		const descriptor = Object.getOwnPropertyDescriptor(owner, property);
		if (descriptor) return descriptor;
		owner = Object.getPrototypeOf(owner);
	}
	return undefined;
}

function hasPrototypeMethodOverride(target: unknown, method: PropertyKey): boolean {
	if (!isObjectLike(target) || !Object.hasOwn(target, method)) return false;
	const prototypeMethod = findPrototypeDescriptor(target, method)?.value;
	return typeof prototypeMethod === "function" && Reflect.get(target, method) !== prototypeMethod;
}

function getOwner(target: unknown): symbol | undefined {
	if (!isObjectLike(target)) return undefined;
	return Reflect.get(target, COMPOSITOR_OWNER) as symbol | undefined;
}

function setOwner(target: unknown, owner: symbol): void {
	if (!isObjectLike(target)) return;
	Object.defineProperty(target, COMPOSITOR_OWNER, {
		configurable: true,
		value: owner,
	});
}

function clearOwner(target: unknown, owner: symbol): void {
	if (isOwner(target, owner)) {
		Reflect.deleteProperty(target as object, COMPOSITOR_OWNER);
	}
}

function isOwner(target: unknown, owner: symbol): boolean {
	return getOwner(target) === owner;
}

function isObjectLike(value: unknown): value is object {
	return (typeof value === "object" && value !== null) || typeof value === "function";
}

function isOverlayEntryVisible(entry: any, terminal: FixedEditorTerminal): boolean {
	if (!entry || entry.hidden === true) return false;
	const visible = entry.options?.visible;
	if (typeof visible === "function") {
		return Boolean(visible(Reflect.get(terminal, "columns"), Reflect.get(terminal, "rows")));
	}
	return true;
}

function coercePositiveInteger(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback;
}

function sanitizeLine(line: string, width: number): string {
	return visibleWidth(line) > width ? truncateToWidth(line, width, "", false) : line;
}

function normalizeCluster(cluster: FixedEditorCluster, width: number, terminalRows: number): FixedEditorCluster {
	const maxClusterRows = Math.max(0, Math.floor(terminalRows) - 1);
	const sourceLines = Array.isArray(cluster.lines) ? cluster.lines : [];
	const start = Math.max(0, sourceLines.length - maxClusterRows);
	const lines = sourceLines.slice(start).map((line: string) => sanitizeLine(line, Math.max(1, Math.floor(width))));
	const cursor =
		cluster.cursor && cluster.cursor.row >= start && cluster.cursor.row < sourceLines.length
			? {
					row: cluster.cursor.row - start,
					col: Math.max(0, cluster.cursor.col),
				}
			: undefined;

	return cursor ? { lines, cursor } : { lines };
}

function isCopyCommandInput(data: string): boolean {
	if (isKeyRelease(data)) return false;
	if (
		matchesKey(data, "super+c") ||
		matchesKey(data, "ctrl+c") ||
		matchesKey(data, "ctrl+shift+c") ||
		matchesKey(data, "super+shift+c") ||
		matchesKey(data, "ctrl+alt+c") ||
		matchesKey(data, "alt+c")
	) {
		return true;
	}
	if (data === "\x03" || data === "\x1b\x03" || data === "\x1bc" || data === "\x1bC") {
		return true;
	}
	return /^\x1b\[(?:99|67);(?:3|5|6|9|10)(?::[12])?u$/.test(data) || /^\x1b\[27;(?:3|5|6|9|10);(?:99|67)~$/.test(data);
}

function stripAnsi(input: string): string {
	return sanitizeTerminalText(input, { allowNewline: false, allowTab: false, preserveSgr: false });
}
