import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { discoverAndLoadExtensions } from "../src/core/extensions/loader.ts";
import { ExtensionRunner } from "../src/core/extensions/runner.ts";
import type { ModelRegistry } from "../src/core/model-registry.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { createInMemoryModelRegistry } from "./model-runtime-test-utils.ts";

describe("pi-extension-enhance test suite", () => {
	let tempDir: string;
	let extensionsDir: string;
	let sessionManager: SessionManager;
	let modelRegistry: ModelRegistry;

	beforeEach(async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-enhance-test-"));
		extensionsDir = path.join(tempDir, ".pi", "extensions");
		fs.mkdirSync(extensionsDir, { recursive: true });
		sessionManager = SessionManager.inMemory();
		modelRegistry = await createInMemoryModelRegistry(AuthStorage.inMemory());
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("can filter tools in context event handler", async () => {
		const extCode = `
			export default function(pi) {
				pi.on("context", (event, ctx) => {
					return {
						tools: (event.tools || []).filter((t) => t.name !== "forbidden_tool")
					};
				});
			}
		`;
		fs.writeFileSync(path.join(extensionsDir, "tool-filter.ts"), extCode);

		const result = await discoverAndLoadExtensions([], tempDir, tempDir);
		const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

		const inputTools = [
			{ name: "allowed_tool", description: "ok", execute: async () => ({}) },
			{ name: "forbidden_tool", description: "bad", execute: async () => ({}) },
		] as any;

		const transformed = await runner.emitTools(inputTools);

		expect(transformed.map((t: any) => t.name)).toEqual(["allowed_tool"]);
	});

	it("can modify systemPrompt in context event handler", async () => {
		const extCode = `
			export default function(pi) {
				pi.on("context", (event, ctx) => {
					return {
						systemPrompt: (event.systemPrompt || "") + "\\n[Appended by Extension]"
					};
				});
			}
		`;
		fs.writeFileSync(path.join(extensionsDir, "prompt-filter.ts"), extCode);

		const result = await discoverAndLoadExtensions([], tempDir, tempDir);
		const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

		const transformed = await runner.emitContextEnhancements({ systemPrompt: "Original Prompt" });

		expect(transformed.systemPrompt).toBe("Original Prompt\n[Appended by Extension]");
	});

	it("triggers tool_call hooks when executed via ctx.executeTool", async () => {
		const extCode = `
			export default function(pi) {
				pi.on("tool_call", async (event) => {
					(globalThis as any).__intercepted = event;
				});
				pi.registerTool({
					name: "sub_tool",
					label: "sub_tool",
					description: "sub tool",
					parameters: {},
					execute: async () => ({ content: [{ type: "text", text: "ok" }] })
				});
			}
		`;
		fs.writeFileSync(path.join(extensionsDir, "exec_tool.ts"), extCode);

		const result = await discoverAndLoadExtensions([], tempDir, tempDir);
		const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
		const ctx = runner.createContext();

		await ctx.executeTool!("sub_tool", { arg: 1 }, { parentToolCallId: "call_1", callerTool: "call_tools" });

		const event = (globalThis as any).__intercepted;
		expect(event).toBeDefined();
		expect(event.toolName).toBe("sub_tool");
		expect(event.parentToolCallId).toBe("call_1");
		expect(event.callerTool).toBe("call_tools");
	});
});
