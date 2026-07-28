import { existsSync, readFileSync, rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createCodeExecToolDefinition, formatBashTruncatedOutput } from "../src/core/tools/code-exec.ts";

describe("code_exec bash truncation", () => {
	it("should return output intact if <= maxLines", () => {
		const text = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n");
		const result = formatBashTruncatedOutput(text);
		expect(result).toBe(text);
	});

	it("should truncate output > 100 lines and save full output to /tmp/", () => {
		const lines = Array.from({ length: 150 }, (_, i) => `line ${i + 1}`);
		const text = lines.join("\n");
		const result = formatBashTruncatedOutput(text);

		expect(result).toContain("[Output truncated: total 150 lines exceeds threshold of 100 lines.");
		expect(result).toContain("First 5 lines:\nline 1\nline 2\nline 3\nline 4\nline 5");
		expect(result).toContain("Last 30 lines:");
		expect(result).toContain("line 150");

		const match = result.match(/Full output saved to (\/tmp\/code_exec_bash_\w+\.log)/);
		expect(match).not.toBeNull();
		const filePath = match![1];
		expect(existsSync(filePath)).toBe(true);

		const savedContent = readFileSync(filePath, "utf8");
		expect(savedContent).toBe(text);

		// Clean up temp file
		rmSync(filePath, { force: true });
	});

	it("should honor CODE_EXEC_BASH_MAX_LINES environment variable", () => {
		const originalEnv = process.env.CODE_EXEC_BASH_MAX_LINES;
		try {
			process.env.CODE_EXEC_BASH_MAX_LINES = "20";
			const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
			const text = lines.join("\n");
			const result = formatBashTruncatedOutput(text);

			expect(result).toContain("[Output truncated: total 30 lines exceeds threshold of 20 lines.");
			const match = result.match(/Full output saved to (\/tmp\/code_exec_bash_\w+\.log)/);
			expect(match).not.toBeNull();
			const filePath = match![1];
			rmSync(filePath, { force: true });
		} finally {
			if (originalEnv === undefined) {
				delete process.env.CODE_EXEC_BASH_MAX_LINES;
			} else {
				process.env.CODE_EXEC_BASH_MAX_LINES = originalEnv;
			}
		}
	});

	it("should truncate when pi.bash output is directly returned from code_exec", async () => {
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

		const codeExec = createCodeExecToolDefinition({ bash: mockBash as any });
		const execResult = await codeExec.execute(
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

		const match = textOutput.match(/Full output saved to (\/tmp\/code_exec_bash_\w+\.log)/);
		expect(match).not.toBeNull();
		const filePath = match![1];
		rmSync(filePath, { force: true });
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

		const codeExec = createCodeExecToolDefinition({ bash: mockBash as any });
		const execResult = await codeExec.execute(
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

	it("should provide pre-injected fs and path global variables to code_exec", async () => {
		const codeExec = createCodeExecToolDefinition({});
		const execResult = await codeExec.execute(
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
});
