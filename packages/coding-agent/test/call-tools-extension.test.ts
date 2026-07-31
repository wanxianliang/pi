import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

describe("call_tools with dynamic extension/MCP tools", () => {
	let tempDir: string;
	let agentDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-code-exec-ext-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		mkdirSync(agentDir, { recursive: true });
	});

	afterEach(() => {
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("should allow call_tools to seamlessly call extension/MCP tools and emit tool_execution events", async () => {
		const events: string[] = [];
		const settingsManager = SettingsManager.create(tempDir, agentDir);
		const sessionManager = SessionManager.inMemory();
		const resourceLoader = new DefaultResourceLoader({
			cwd: tempDir,
			agentDir,
			settingsManager,
			extensionFactories: [
				(pi) => {
					pi.on("tool_execution_start", async (event) => {
						events.push(`start:${event.toolName}`);
					});
					pi.on("tool_execution_end", async (event) => {
						events.push(`end:${event.toolName}`);
					});
					pi.registerTool({
						name: "custom_ext_tool",
						label: "Custom Extension Tool",
						description: "A custom tool from an extension",
						parameters: Type.Object({
							val: Type.String(),
						}),
						execute: async (_toolCallId, params) => ({
							content: [{ type: "text", text: `extension response for ${params.val}` }],
							details: {},
						}),
					});
				},
			],
		});
		await resourceLoader.reload();

		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir,
			model: getModel("anthropic", "claude-sonnet-4-5")!,
			settingsManager,
			sessionManager,
			resourceLoader,
		});

		await session.bindExtensions({});

		const callToolsTool = session.agent.state.tools.find((t) => t.name === "call_tools")!;
		expect(callToolsTool).toBeDefined();

		// Run call_tools executing our custom extension tool
		// Run call_tools executing our custom extension tool via pi.custom_ext_tool and direct function call custom_ext_tool
		const result = await callToolsTool.execute("exec-1", {
			code: `
				const res1 = await pi.custom_ext_tool({ val: "hello-world" });
				const res2 = await custom_ext_tool({ val: "hello-direct" });
				return [res1, res2];
			`,
		});

		expect((result.content[0] as any).text).toContain("hello-world");
		expect((result.content[0] as any).text).toContain("hello-direct");
		expect(events).toEqual([
			"start:custom_ext_tool",
			"end:custom_ext_tool",
			"start:custom_ext_tool",
			"end:custom_ext_tool",
		]);

		session.dispose();
	});
});
