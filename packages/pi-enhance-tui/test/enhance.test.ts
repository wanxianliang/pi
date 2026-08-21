import assert from "node:assert";
import { describe, it } from "node:test";
import {
	FastTextMeasureEngine,
	highlightCode,
	initPiEnhanceTui,
	isFooterSuppressed,
	renderCardBox,
	stripCardBorders,
} from "../src/index.ts";

describe("pi-enhance-tui core suite", () => {
	it("FastTextMeasureEngine calculates visibleWidth accurately", () => {
		const engine = new FastTextMeasureEngine();
		assert.strictEqual(engine.visibleWidth("hello"), 5);
		assert.strictEqual(engine.visibleWidth("你好"), 4);
		assert.strictEqual(engine.visibleWidth("\x1b[31mred\x1b[0m"), 3);
	});

	it("FastTextMeasureEngine strips terminal sequences", () => {
		const engine = new FastTextMeasureEngine();
		assert.strictEqual(engine.stripTerminalSequences("\x1b[32mhello\x1b[0m"), "hello");
	});

	it("initPiEnhanceTui activates and restores cleanly", () => {
		assert.strictEqual(isFooterSuppressed(), false);
		const instance = initPiEnhanceTui();
		assert.strictEqual(isFooterSuppressed(), true);
		instance.restore();
		assert.strictEqual(isFooterSuppressed(), false);
	});

	it("highlightCode highlights TypeScript and diffs", () => {
		const lines = highlightCode("const x = 123;", "ts");
		assert.ok(lines[0].includes("123"));
		const diffLines = highlightCode("+ added line", "diff");
		assert.ok(diffLines[0].includes("added line"));
	});

	it("renderCardBox produces unified rounded borders", () => {
		const lines = renderCardBox({
			title: "Test",
			variant: "tool",
			status: "success",
			contentLines: ["content 1", "content 2"],
			width: 60,
		});
		assert.ok(lines.length >= 3);
		assert.ok(lines[0].includes("Test"));
		assert.ok(lines[lines.length - 1].includes("╰"));
	});

	it("stripCardBorders cleans border artifacts", () => {
		const card = renderCardBox({
			title: "Test",
			variant: "tool",
			contentLines: ["clean text"],
			width: 60,
		});
		const stripped = stripCardBorders(card.join("\n"));
		assert.ok(stripped.includes("clean text"));
		assert.ok(!stripped.includes("╭"));
		assert.ok(!stripped.includes("╰"));
	});
});
