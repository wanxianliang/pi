import assert from "node:assert";
import { describe, it } from "node:test";
import {
	FastTextMeasureEngine,
	getMaxVisibleMessages,
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

	it("windowed chat container limits rendered items and shows fold notice", async () => {
		const fakeChatContainer = {
			children: [] as any[],
			render(width: number): string[] {
				return this.children.flatMap((c: any) => c.render(width));
			},
			invalidate(): void {},
		};

		class MockInteractiveMode {
			chatContainer = fakeChatContainer;
			headerContainer = {
				children: [] as any[],
				addChild(c: any) {
					this.children.push(c);
				},
			};
			loadedResourcesContainer = { clear() {} };
			session = { model: { id: "test-model" } };
			version = "0.84.2";
			ui = { requestRender() {} };
			async init() {}
		}

		process.env.PI_MAX_VISIBLE_MESSAGES = "3";
		assert.strictEqual(getMaxVisibleMessages(), 3);

		const instance = initPiEnhanceTui({
			InteractiveMode: MockInteractiveMode,
		});

		const mode = new MockInteractiveMode();
		await mode.init();

		for (let i = 1; i <= 5; i++) {
			fakeChatContainer.children.push({
				render: () => [`Message ${i}`],
			});
		}

		const rendered = fakeChatContainer.render(80);
		assert.ok(rendered.some((l) => l.includes("已折叠 2 条早期历史消息")));
		assert.ok(!rendered.some((l) => l.includes("Message 1")));
		assert.ok(!rendered.some((l) => l.includes("Message 2")));
		assert.ok(rendered.some((l) => l.includes("Message 3")));
		assert.ok(rendered.some((l) => l.includes("Message 4")));
		assert.ok(rendered.some((l) => l.includes("Message 5")));

		instance.restore();
		delete process.env.PI_MAX_VISIBLE_MESSAGES;
		assert.strictEqual(getMaxVisibleMessages(), 25);
	});
});
