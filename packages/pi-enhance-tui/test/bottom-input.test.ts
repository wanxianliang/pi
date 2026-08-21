import assert from "node:assert/strict";
import { test } from "node:test";
import {
	copyToSystemClipboard,
	createBottomInputRuntime,
	renderBeautifiedEditorFrame,
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
