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

describe("code_exec with dynamic extension/MCP tools", () => {
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

	it("should allow code_exec to seamlessly call extension/MCP tools", async () => {
		const settingsManager = SettingsManager.create(tempDir, agentDir);
		const sessionManager = SessionManager.inMemory();
		const resourceLoader = new DefaultResourceLoader({
			cwd: tempDir,
			agentDir,
			settingsManager,
			extensionFactories: [
				(pi) => {
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

		const codeExecTool = session.agent.state.tools.find((t) => t.name === "code_exec")!;
		expect(codeExecTool).toBeDefined();

		// Run code_exec executing our custom extension tool
		const result = await codeExecTool.execute("exec-1", {
			code: `
				const res = await pi.custom_ext_tool({ val: "hello-world" });
				return res;
			`,
		});

		expect((result.content[0] as any).text).toContain("extension response for hello-world");

		session.dispose();
	});
});
