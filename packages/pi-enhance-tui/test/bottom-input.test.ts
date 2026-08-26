import assert from "node:assert/strict";
import { test } from "node:test";
import { CURSOR_MARKER } from "@earendil-works/pi-tui";
import {
	cacheHitRatioFromUsage,
	copyToSystemClipboard,
	createBottomInputEditor,
	createBottomInputRuntime,
	getUsageTokenTotal,
	isAssistantUsage,
	isSelectAllShortcutInput,
	registerPiUiCustomExtension,
	renderBeautifiedEditorFrame,
	renderDetailedTokenStatus,
	renderFixedEditorCluster,
	renderFrameStatus,
	resolveBottomInputShortcuts,
	sanitizeTerminalSingleLineText,
	sanitizeTerminalText,
	stripCardBorders,
	validateShortcutChange,
} from "../src/index.ts";

test("sanitizes terminal control sequences", () => {
	const raw = "\x1b[31mRed\x1b[0m\x1b[2K\x1b[?25hNormal";
	const safe = sanitizeTerminalText(raw, { preserveSgr: true });
	assert.equal(safe.includes("\x1b[2K"), false);
	assert.equal(safe.includes("Red"), true);
	assert.equal(safe.includes("Normal"), true);
});

test("compresses single-line text safely", () => {
	const multiline = "Hello \n World \t From \n Pi";
	const single = sanitizeTerminalSingleLineText(multiline);
	assert.equal(single, "Hello World From Pi");
});

test("resolves and validates shortcuts", () => {
	const resolved = resolveBottomInputShortcuts({ stashEditor: "ctrl+s" });
	assert.equal(resolved.stashEditor, "ctrl+s");
	assert.equal(resolved.copyEditor, "ctrl+alt+c");

	const valid = validateShortcutChange(resolved, "cutEditor", "ctrl+alt+z");
	assert.equal(valid.ok, true);
});

test("manages runtime lifecycle safely", () => {
	const runtime = createBottomInputRuntime({ startClock: false });
	const status = runtime.getStatus();
	assert.equal(status.enabled, false);
	assert.equal(status.installed, false);

	runtime.setBeautifiedInputEnabled?.(true);
	runtime.setLastPrompt("Hello prompt");
	runtime.dispose();
});

test("renders beautified editor frame", () => {
	const theme = {
		fg: (_t: string, s: string) => s,
		bg: (_t: string, s: string) => s,
		bold: (s: string) => s,
	};
	const lines = renderBeautifiedEditorFrame({
		editorLines: ["const x = 1;"],
		width: 60,
		theme,
		status: {
			model: "Claude 3.7 Sonnet",
			thinking: "high",
			context: "12.5k/200k",
			elapsed: "45s",
		},
	});
	assert.equal(lines.length, 3);
	assert.equal(lines[0].includes("╭"), true);
	assert.equal(lines[0].includes("Claude 3.7 Sonnet"), true);
	assert.equal(lines[1].includes("const x = 1;"), true);
	assert.equal(lines[2].includes("╰"), true);
});

test("stripCardBorders removes card box borders and padding", () => {
	const sampleCard = `╭── Thinking ── ⠋ Reasoning ───────────────╮
│  I am analyzing the repository code.      │
│  Line 2 of thinking.                      │
╰───────────────────────────────────────────╯`;
	const stripped = stripCardBorders(sampleCard);
	assert.equal(stripped, "I am analyzing the repository code.\nLine 2 of thinking.");
});

test("copyToSystemClipboard handles copy safely", async () => {
	const ok = await copyToSystemClipboard("pi-enhance-test-copy");
	assert.equal(typeof ok, "boolean");
});

test("cacheHitRatioFromUsage calculates cache hit ratios correctly", () => {
	const anthropicUsage = { input: 200, cacheRead: 800, cacheWrite: 0, output: 50 };
	const ratio = cacheHitRatioFromUsage(anthropicUsage);
	assert.equal(ratio, 80);

	const openAiUsage = { prompt_tokens: 1000, prompt_tokens_details: { cached_tokens: 500 } };
	const openAiRatio = cacheHitRatioFromUsage(openAiUsage);
	assert.equal(openAiRatio, 50);

	const noCacheUsage = { input: 100, cacheRead: 0, cacheWrite: 0, output: 50 };
	const noCacheRatio = cacheHitRatioFromUsage(noCacheUsage);
	assert.equal(noCacheRatio, 0);
});

test("renderDetailedTokenStatus renders cache hit ratio when present", () => {
	const theme = {
		fg: (_t: string, s: string) => s,
		bg: (_t: string, s: string) => s,
		bold: (s: string) => s,
	};
	const usage = { tokens: 10000, contextWindow: 200000, percent: 5.0 };
	const rawUsage = { input: 200, cacheRead: 800, cacheWrite: 0, output: 50 };

	const status = renderDetailedTokenStatus(usage, rawUsage, "anthropic", theme);
	assert.ok(status !== null);
	assert.ok(status.includes("5.0%/200k"));
	assert.ok(status.includes("⚡80%"));
	assert.ok(status.includes("(anthropic)"));
});

test("renderFrameStatus includes cache hit ratio in context segment", () => {
	const theme = {
		fg: (_t: string, s: string) => s,
		bg: (_t: string, s: string) => s,
		bold: (s: string) => s,
	};
	const frameStatus = renderFrameStatus({
		ctx: {
			model: { id: "claude-3-7-sonnet", provider: "anthropic", contextWindow: 200000 },
			getContextUsage: () => ({ tokens: 20000, contextWindow: 200000, percent: 10 }),
		},
		theme,
		width: 80,
		beautifiedInputEnabled: true,
		isStreaming: false,
		liveUsage: null,
		latestAssistantUsage: { input: 100, cacheRead: 900, cacheWrite: 0, output: 50 },
		currentThinkingLevel: null,
		sessionStartTime: Date.now(),
		now: Date.now(),
		lastPrompt: "",
	});

	assert.ok(frameStatus.context !== null);
	assert.ok(frameStatus.context.includes("⚡90%"));
});

test("cacheHitRatioFromUsage supports diverse provider usage shapes", () => {
	const deepSeekUsage = { prompt_tokens: 1000, prompt_cache_hit_tokens: 750 };
	assert.equal(cacheHitRatioFromUsage(deepSeekUsage), 75);

	const geminiUsage = { promptTokenCount: 500, cachedContentTokenCount: 250 };
	assert.equal(cacheHitRatioFromUsage(geminiUsage), 50);

	const snakeCaseUsage = { input: 100, cache_read: 400, cache_write: 0 };
	assert.equal(cacheHitRatioFromUsage(snakeCaseUsage), 80);
});

test("isAssistantUsage and getUsageTokenTotal handle diverse usage formats", () => {
	assert.equal(isAssistantUsage({ prompt_tokens: 100, completion_tokens: 50 }), true);
	assert.equal(isAssistantUsage({ promptTokenCount: 100 }), true);
	assert.equal(isAssistantUsage({ cacheRead: 50 }), true);
	assert.equal(isAssistantUsage(null), false);

	const total = getUsageTokenTotal({ input: 100, output: 50, cacheRead: 200, cacheWrite: 50 });
	assert.equal(total, 400);
});

test("registerPiUiCustomExtension captures usage on message_end and turn_end", () => {
	const handlers = new Map<string, (...args: any[]) => any>();
	const mockPi = {
		registerCommand: () => {},
		on: (event: string, handler: (...args: any[]) => any) => {
			handlers.set(event, handler);
		},
	};
	const runtime = createBottomInputRuntime({ startClock: false });
	registerPiUiCustomExtension(mockPi, { bottomInputRuntime: runtime });

	const ctx = {
		model: { id: "claude-3-7-sonnet", provider: "anthropic", contextWindow: 200000 },
		getContextUsage: () => ({ tokens: 5000, contextWindow: 200000, percent: 2.5 }),
	};

	handlers.get("message_end")?.(
		{ message: { usage: { input: 200, cacheRead: 800, cacheWrite: 0, output: 10 } } },
		ctx,
	);

	const theme = { fg: (_t: string, s: string) => s, bg: (_t: string, s: string) => s };
	const status = renderDetailedTokenStatus(
		ctx.getContextUsage(),
		(runtime as any).latestAssistantUsage,
		"anthropic",
		theme,
	);
	assert.ok(status !== null);
	assert.ok(status.includes("⚡80%"));
});

test("bottom editor mouse click positions cursor accurately", () => {
	const mockTui = { requestRender: () => {}, terminal: { rows: 24 } };
	const theme = { fg: (_t: string, s: string) => s, bg: (_t: string, s: string) => s };
	const state = {
		beautifiedInputEnabled: true,
		getTheme: () => theme,
		getFrameStatus: () => ({ model: null, thinking: null, context: null, elapsed: null }),
	};
	const editor = createBottomInputEditor(mockTui, theme, {}, state);
	editor.setText("const hello = 'world';\nconst second = 123;");

	editor.setCursorFromClick(0, 6);
	assert.equal(editor.getCursor().line, 0);
	assert.equal(editor.getCursor().col, 6);

	editor.setCursorFromClick(1, 6);
	assert.equal(editor.getCursor().line, 1);
	assert.equal(editor.getCursor().col, 6);
});

test("bottom editor mouse drag selection and operations", () => {
	const mockTui = { requestRender: () => {}, terminal: { rows: 24 } };
	const theme = { fg: (_t: string, s: string) => s, bg: (_t: string, s: string) => s };
	const state = {
		beautifiedInputEnabled: true,
		getTheme: () => theme,
		getFrameStatus: () => ({ model: null, thinking: null, context: null, elapsed: null }),
	};
	const editor = createBottomInputEditor(mockTui, theme, {}, state);
	editor.setText("hello world from bottom editor");

	editor.startSelection(0, 6);
	editor.updateSelection(0, 11);
	editor.finishSelection();
	assert.equal(editor.hasSelectionRange(), true);
	assert.equal(editor.getSelectedText(), "world");

	// Type replacement over selection
	editor.handleInput("everyone");
	assert.equal(editor.getText(), "hello everyone from bottom editor");
	assert.equal(editor.hasSelectionRange(), false);

	// Double click word selection
	editor.selectWordAt(0, 8);
	assert.equal(editor.getSelectedText(), "everyone");

	// Backspace over selection
	editor.deleteSelection();
	assert.equal(editor.getText(), "hello  from bottom editor");

	// Select all
	editor.selectAll();
	assert.equal(editor.getSelectedText(), "hello  from bottom editor");
});

test("bottom editor multi-line selection and triple-click", () => {
	const mockTui = { requestRender: () => {}, terminal: { rows: 24 } };
	const theme = { fg: (_t: string, s: string) => s, bg: (_t: string, s: string) => s };
	const state = {
		beautifiedInputEnabled: true,
		getTheme: () => theme,
		getFrameStatus: () => ({ model: null, thinking: null, context: null, elapsed: null }),
	};
	const editor = createBottomInputEditor(mockTui, theme, {}, state);
	editor.setText("line 1 foo\nline 2 bar\nline 3 baz");

	// Triple click selects entire line
	editor.selectLineAt(1);
	assert.equal(editor.getSelectedText(), "line 2 bar");

	// Multi-line selection and deletion
	editor.startSelection(0, 7);
	editor.updateSelection(2, 6);
	editor.finishSelection();
	assert.equal(editor.getSelectedText(), "foo\nline 2 bar\nline 3");

	editor.deleteSelection();
	assert.equal(editor.getText(), "line 1  baz");
	assert.equal(editor.getCursor().line, 0);
	assert.equal(editor.getCursor().col, 7);

	// Renders frame with selection highlight when selected
	editor.startSelection(0, 0);
	editor.updateSelection(0, 6);
	const rendered = editor.render(60);
	assert.ok(rendered.some((l: string) => l.includes("\x1b[7m")));
});

test("bottom editor backward drag selection (from back to front)", () => {
	const mockTui = { requestRender: () => {}, terminal: { rows: 24 } };
	const theme = { fg: (_t: string, s: string) => s, bg: (_t: string, s: string) => s };
	const state = {
		beautifiedInputEnabled: true,
		getTheme: () => theme,
		getFrameStatus: () => ({ model: null, thinking: null, context: null, elapsed: null }),
	};
	const editor = createBottomInputEditor(mockTui, theme, {}, state);
	editor.setText("const message = 'hello world';");

	// Start dragging from index 28 backward to index 17 ('hello world')
	editor.startSelection(0, 28);
	editor.updateSelection(0, 17);
	editor.finishSelection();

	assert.equal(editor.hasSelectionRange(), true);
	assert.equal(editor.getSelectedText(), "hello world");
	assert.equal(editor.getCursor().col, 17);

	// Render backward selection: should cleanly highlight without corrupted ANSI
	const rendered = editor.render(60);
	assert.ok(rendered.some((l: string) => l.includes("\x1b[7mhello world\x1b[27m")));

	// Type over backward selection
	editor.handleInput("hi");
	assert.equal(editor.getText(), "const message = 'hi';");
	assert.equal(editor.hasSelectionRange(), false);
});

test("bottom editor positions cursor and selects accurately on word-wrapped lines", () => {
	const mockTui = { requestRender: () => {}, terminal: { rows: 24 } };
	const theme = { fg: (_t: string, s: string) => s, bg: (_t: string, s: string) => s };
	const state = {
		beautifiedInputEnabled: true,
		getTheme: () => theme,
		getFrameStatus: () => ({ model: null, thinking: null, context: null, elapsed: null }),
	};
	const editor = createBottomInputEditor(mockTui, theme, {}, state);
	const longLine = "This is a long sentence of text that wraps across multiple lines in the editor.";
	editor.setText(longLine);
	editor.render(40);

	// Click on visual line 1 (the wrapped chunk of line 0)
	editor.setCursorFromClick(1, 0);
	assert.equal(editor.getCursor().line, 0);
	assert.ok(editor.getCursor().col > 0);

	// Select on wrapped line
	editor.startSelection(1, 0);
	editor.updateSelection(1, 10);
	editor.finishSelection();
	assert.equal(editor.hasSelectionRange(), true);
	assert.ok(editor.getSelectedText().length > 0);
});

test("isSelectAllShortcutInput recognizes various Cmd+A and Ctrl+A sequences", () => {
	assert.equal(isSelectAllShortcutInput("\x01"), true);
	assert.equal(isSelectAllShortcutInput("\x1b[97;9u"), true);
	assert.equal(isSelectAllShortcutInput("\x1b[97;9:1u"), true);
	assert.equal(isSelectAllShortcutInput("\x1b[65;9u"), true);
	assert.equal(isSelectAllShortcutInput("\x1b[27;9;97~"), true);
	assert.equal(isSelectAllShortcutInput("\x1b[27;9;65~"), true);
	assert.equal(isSelectAllShortcutInput("\x1b[97;5u"), true);
	assert.equal(isSelectAllShortcutInput("a"), false);
});

test("bottom editor handleInput with Cmd+A selects all content", () => {
	const mockTui = { requestRender: () => {}, terminal: { rows: 24 } };
	const theme = { fg: (_t: string, s: string) => s, bg: (_t: string, s: string) => s };
	const state = {
		beautifiedInputEnabled: true,
		getTheme: () => theme,
		getFrameStatus: () => ({ model: null, thinking: null, context: null, elapsed: null }),
	};
	const editor = createBottomInputEditor(mockTui, theme, {}, state);
	editor.setText("first line\nsecond line");

	// Trigger Cmd+A via Kitty sequence
	editor.handleInput("\x1b[97;9u");
	assert.equal(editor.hasSelectionRange(), true);
	assert.equal(editor.getSelectedText(), "first line\nsecond line");

	// Clear and trigger via raw Ctrl+A byte
	editor.clearSelection();
	assert.equal(editor.hasSelectionRange(), false);
	editor.handleInput("\x01");
	assert.equal(editor.hasSelectionRange(), true);
	assert.equal(editor.getSelectedText(), "first line\nsecond line");
});

test("bottom editor cursor blinking toggles and resets on interaction", () => {
	const mockTui = { requestRender: () => {}, terminal: { rows: 24 } };
	const theme = { fg: (_t: string, s: string) => s, bg: (_t: string, s: string) => s };
	const state = {
		beautifiedInputEnabled: true,
		getTheme: () => theme,
		getFrameStatus: () => ({ model: null, thinking: null, context: null, elapsed: null }),
	};
	const editor = createBottomInputEditor(mockTui, theme, {}, state);
	editor.setText("hello");

	assert.equal(editor.isCursorBlinkVisible(), true);

	// Simulate elapsed time past blink threshold
	editor.lastInteractionTime = Date.now() - 600;
	assert.equal(editor.isCursorBlinkVisible(), false);

	// Reset blink on interaction
	editor.resetCursorBlink();
	assert.equal(editor.isCursorBlinkVisible(), true);

	editor.dispose?.();
});

test("renderFixedEditorCluster extracts cursor marker and calculates hardware cursor accurately", () => {
	const mockTui = { requestRender: () => {}, terminal: { rows: 24 } };
	const theme = { fg: (_t: string, s: string) => s, bg: (_t: string, s: string) => s };
	const state = {
		beautifiedInputEnabled: true,
		getTheme: () => theme,
		getFrameStatus: () => ({ model: null, thinking: null, context: null, elapsed: null }),
	};
	const editor = createBottomInputEditor(mockTui, theme, {}, state);
	editor.setText("abcdef");
	editor.setCursorFromClick(0, 2);

	const rendered = editor.render(80);
	assert.ok(rendered.some((line: string) => line.includes(CURSOR_MARKER)));

	const cluster = renderFixedEditorCluster({
		editorLines: rendered,
		width: 80,
		maxHeight: 10,
	});

	assert.ok(cluster.cursor !== undefined);
	assert.equal(cluster.cursor?.row, 1);
	// Row 1 is: │ + space + ab + cursor (col = 1 + 1 + 2 = 4)
	assert.equal(cluster.cursor?.col, 4);

	editor.dispose?.();
});

test("bottom editor renders beam cursor in front of clicked character", () => {
	const mockTui = { requestRender: () => {}, terminal: { rows: 24 } };
	const theme = { fg: (_t: string, s: string) => s, bg: (_t: string, s: string) => s };
	const state = {
		beautifiedInputEnabled: true,
		getTheme: () => theme,
		getFrameStatus: () => ({ model: null, thinking: null, context: null, elapsed: null }),
	};
	const editor = createBottomInputEditor(mockTui, theme, {}, state);
	editor.setText("abcdef");

	// Click at character 'a' (index 0)
	editor.setCursorFromClick(0, 0);
	let rendered = editor.render(80);
	// Rendered line should have beam ▎ followed by 'abcdef'
	assert.ok(rendered[1].includes("▎\x1b[0mabcdef"));

	// Click at character 'c' (index 2)
	editor.setCursorFromClick(0, 2);
	rendered = editor.render(80);
	// Rendered line should have 'ab' followed by beam ▎ and 'cdef'
	assert.ok(rendered[1].includes("ab"));
	assert.ok(rendered[1].includes("▎\x1b[0mcdef"));

	editor.dispose?.();
});
