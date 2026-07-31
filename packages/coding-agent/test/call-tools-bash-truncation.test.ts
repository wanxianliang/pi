import { existsSync, readFileSync, rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createCallToolsToolDefinition, formatBashTruncatedOutput } from "../src/core/tools/call-tools.ts";

describe("call_tools bash truncation", () => {
	it("should return output intact if <= maxLines", () => {
		const text = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n");
		const result = formatBashTruncatedOutput(text);
		expect(result).toBe(text);
	});

	it("should truncate output > 100 lines and save full output to /tmp/", () => {
		const originalMaxLines = process.env.CALL_TOOLS_BASH_MAX_LINES;
		delete process.env.CALL_TOOLS_BASH_MAX_LINES;
		try {
			const lines = Array.from({ length: 150 }, (_, i) => `line ${i + 1}`);
			const text = lines.join("\n");
			const result = formatBashTruncatedOutput(text);

			expect(result).toContain("[Output truncated: total 150 lines exceeds threshold of 100 lines.");
			expect(result).toContain("First 5 lines:\nline 1\nline 2\nline 3\nline 4\nline 5");
			expect(result).toContain("Last 30 lines:");
			expect(result).toContain("line 150");

			const match = result.match(/Full output saved to (\/tmp\/call_tools_bash_\w+\.log)/);
			expect(match).not.toBeNull();
			const filePath = match![1];
			expect(existsSync(filePath)).toBe(true);

			const savedContent = readFileSync(filePath, "utf8");
			expect(savedContent).toBe(text);

			// Clean up temp file
			rmSync(filePath, { force: true });
		} finally {
			if (originalMaxLines !== undefined) {
				process.env.CALL_TOOLS_BASH_MAX_LINES = originalMaxLines;
			}
		}
	});

	it("should honor CALL_TOOLS_BASH_MAX_LINES environment variable", () => {
		const originalEnv = process.env.CALL_TOOLS_BASH_MAX_LINES;
		try {
			process.env.CALL_TOOLS_BASH_MAX_LINES = "20";
			const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
			const text = lines.join("\n");
			const result = formatBashTruncatedOutput(text);

			expect(result).toContain("[Output truncated: total 30 lines exceeds threshold of 20 lines.");
			const match = result.match(/Full output saved to (\/tmp\/call_tools_bash_\w+\.log)/);
			expect(match).not.toBeNull();
			const filePath = match![1];
			rmSync(filePath, { force: true });
		} finally {
			if (originalEnv === undefined) {
				delete process.env.CALL_TOOLS_BASH_MAX_LINES;
			} else {
				process.env.CALL_TOOLS_BASH_MAX_LINES = originalEnv;
			}
		}
	});

	it("should truncate when pi.bash output is directly returned from call_tools", async () => {
		const originalMaxLines = process.env.CALL_TOOLS_BASH_MAX_LINES;
		delete process.env.CALL_TOOLS_BASH_MAX_LINES;
		try {
			const mockBash = {
				name: "bash",
				label: "bash",
				description: "mock bash",
				parameters: {} as any,
				execute: async () => {
					const lines = Array.from({ length: 120 }, (_, i) => `log output line ${i + 1}`);
					return { content: [{ type: "text", text: lines.join("\n") }] };
				},
			};

			const callTools = createCallToolsToolDefinition({ bash: mockBash as any });
			const execResult = await callTools.execute(
				"call-1",
				{
					code: `
					const res = await pi.bash({ command: "echo test" });
					return res;
				`,
				},
				undefined,
				undefined,
				{} as any,
			);

			const textOutput = (execResult.content[0] as any).text;
			expect(textOutput).toContain("[Output truncated: total 120 lines exceeds threshold of 100 lines.");
			expect(textOutput).toContain("First 5 lines:");
			expect(textOutput).toContain("log output line 1");
			expect(textOutput).toContain("Last 30 lines:");
			expect(textOutput).toContain("log output line 120");

			const match = textOutput.match(/Full output saved to (\/tmp\/call_tools_bash_\w+\.log)/);
			expect(match).not.toBeNull();
			const filePath = match![1];
			rmSync(filePath, { force: true });
		} finally {
			if (originalMaxLines !== undefined) {
				process.env.CALL_TOOLS_BASH_MAX_LINES = originalMaxLines;
			}
		}
	});

	it("should NOT truncate pi.bash output when processed inside JS code and not directly returned", async () => {
		const mockBash = {
			name: "bash",
			label: "bash",
			description: "mock bash",
			parameters: {} as any,
			execute: async () => {
				const lines = Array.from({ length: 120 }, (_, i) => `log output line ${i + 1}`);
				return { content: [{ type: "text", text: lines.join("\n") }] };
			},
		};

		const callTools = createCallToolsToolDefinition({ bash: mockBash as any });
		const execResult = await callTools.execute(
			"call-2",
			{
				code: `
				const res = await pi.bash({ command: "echo test" });
				const lineCount = res.split("\\n").length;
				return "Total lines: " + lineCount;
			`,
			},
			undefined,
			undefined,
			{} as any,
		);

		const textOutput = (execResult.content[0] as any).text;
		expect(textOutput).toBe("Total lines: 120");
	});

	it("should provide pre-injected fs and path global variables to call_tools", async () => {
		const callTools = createCallToolsToolDefinition({});
		const execResult = await callTools.execute(
			"call-3",
			{
				code: `
				const p = path.join("/tmp", "test.txt");
				return typeof fs.existsSync === "function" && typeof path.join === "function" ? "injected" : "missing";
			`,
			},
			undefined,
			undefined,
			{} as any,
		);

		const textOutput = (execResult.content[0] as any).text;
		expect(textOutput).toBe("injected");
	});

	it("should allow call_tools to re-declare fs and path with const/let without syntax errors", async () => {
		const callTools = createCallToolsToolDefinition({});
		const execResult = await callTools.execute(
			"call-4",
			{
				code: `
				const fs = require('fs');
				const path = require('path');
				const p = path.join("/tmp", "test.txt");
				return typeof fs.existsSync === "function" && typeof path.join === "function" ? "declared" : "missing";
			`,
			},
			undefined,
			undefined,
			{} as any,
		);

		const textOutput = (execResult.content[0] as any).text;
		expect(textOutput).toBe("declared");
	});

	it("should automatically prepend rtk to bash command when CALL_TOOLS_USE_RTK is true", async () => {
		const executedCommands: string[] = [];
		const mockBash = {
			name: "bash",
			label: "bash",
			description: "mock bash",
			parameters: {} as any,
			execute: async (_callId: string, params: any) => {
				executedCommands.push(params.command);
				return { content: [{ type: "text", text: "ok" }] };
			},
		};

		const callTools = createCallToolsToolDefinition({ bash: mockBash as any });
		const originalEnv = process.env.CALL_TOOLS_USE_RTK;
		try {
			process.env.CALL_TOOLS_USE_RTK = "true";
			await callTools.execute(
				"call-rtk-1",
				{
					code: `
					await pi.bash({ command: "git status" });
					await pi.bash({ command: "rtk ls -l" });
				`,
				},
				undefined,
				undefined,
				{} as any,
			);
			expect(executedCommands).toEqual(["rtk git status", "rtk ls -l"]);
		} finally {
			if (originalEnv === undefined) {
				delete process.env.CALL_TOOLS_USE_RTK;
			} else {
				process.env.CALL_TOOLS_USE_RTK = originalEnv;
			}
		}
	});

	it("should NOT prepend rtk to bash command when CALL_TOOLS_USE_RTK is not true", async () => {
		const executedCommands: string[] = [];
		const mockBash = {
			name: "bash",
			label: "bash",
			description: "mock bash",
			parameters: {} as any,
			execute: async (_callId: string, params: any) => {
				executedCommands.push(params.command);
				return { content: [{ type: "text", text: "ok" }] };
			},
		};

		const callTools = createCallToolsToolDefinition({ bash: mockBash as any });
		const originalEnv = process.env.CALL_TOOLS_USE_RTK;
		try {
			delete process.env.CALL_TOOLS_USE_RTK;
			await callTools.execute(
				"call-rtk-2",
				{
					code: `await pi.bash({ command: "git status" });`,
				},
				undefined,
				undefined,
				{} as any,
			);
			expect(executedCommands).toEqual(["git status"]);
		} finally {
			if (originalEnv === undefined) {
				delete process.env.CALL_TOOLS_USE_RTK;
			} else {
				process.env.CALL_TOOLS_USE_RTK = originalEnv;
			}
		}
	});
});
