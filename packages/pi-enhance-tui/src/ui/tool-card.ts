/**
 * Clean content renderer helpers for tool calls and tool execution results.
 */

import { Container, Text } from "@earendil-works/pi-tui";
import { highlightCode } from "../highlighter.ts";
import { PALETTE } from "./theme.ts";
import { formatToolArgs } from "./tool-args.ts";

export interface ToolCardCallProps {
	toolName: string;
	code?: string;
	codeLang?: string;
	args?: Record<string, unknown>;
	theme?: unknown;
	context: {
		state: Record<string, unknown>;
		isPartial?: boolean;
		executionStarted?: boolean;
		lastComponent?: unknown;
		invalidate?: () => void;
	};
}

export interface ToolCardResultProps {
	toolName?: string;
	result?: {
		content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
		isError?: boolean;
		details?: { logs?: unknown[] };
	};
	theme?: unknown;
	context: {
		state: Record<string, unknown>;
		lastComponent?: unknown;
	};
}

export function renderToolCardCall(props: ToolCardCallProps): Container {
	const { code, codeLang = "typescript", context } = props;

	const container = (context.lastComponent as Container | undefined) ?? new Container();
	container.clear();

	if (code) {
		const rawCode = typeof code === "string" ? code : String(code);
		const lines = highlightCode(rawCode, codeLang);
		const maxLineNumWidth = String(lines.length).length;

		for (let i = 0; i < lines.length; i++) {
			const lineNum = String(i + 1).padStart(maxLineNumWidth, " ");
			container.addChild(new Text(`${PALETTE.lineNumber(lineNum)} ${PALETTE.border("│")} ${lines[i]}`, 0, 0));
		}
	}

	return container;
}

export function renderToolCardResult(props: ToolCardResultProps): Container {
	const { result, context } = props;

	const container = (context.lastComponent as Container | undefined) ?? new Container();
	container.clear();

	// 1. Console Output Logs Section
	const logs = result?.details?.logs;
	if (logs && Array.isArray(logs) && logs.length > 0) {
		for (const log of logs) {
			const logText = typeof log === "string" ? log : JSON.stringify(log, null, 2);
			const lines = highlightCode(logText, "json");
			for (const line of lines) {
				container.addChild(new Text(line, 0, 0));
			}
		}
	}

	// 2. Return Result Section
	const outputBlock = result?.content?.find((c) => c.type === "text");
	if (outputBlock?.text) {
		const rawText = String(outputBlock.text).trim();
		let detectedLang = "typescript";
		let formattedText = rawText;

		if ((rawText.startsWith("{") && rawText.endsWith("}")) || (rawText.startsWith("[") && rawText.endsWith("]"))) {
			detectedLang = "json";
			try {
				const parsed = JSON.parse(rawText);
				formattedText = JSON.stringify(parsed, null, 2);
			} catch {
				formattedText = rawText;
			}
		} else if (
			rawText.startsWith("diff --git") ||
			rawText.startsWith("@@") ||
			(rawText.includes("\n+") && rawText.includes("\n-"))
		) {
			detectedLang = "diff";
		}

		const lines = highlightCode(formattedText, detectedLang);
		for (const line of lines) {
			container.addChild(new Text(line, 0, 0));
		}
	}

	return container;
}

export function formatToolExecutionLines(
	toolName: string,
	args: unknown,
	result:
		| {
				content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
				isError?: boolean;
				details?: any;
		  }
		| undefined,
): string[] {
	const lines: string[] = [];

	// 1. Parameters (args)
	const argLines = formatToolArgs(toolName, args);
	if (argLines.length > 0) {
		lines.push(...argLines);
	}

	// 2. Results
	if (result) {
		if (lines.length > 0) {
			lines.push("");
		}

		if (result.isError) {
			const errorText = result.content?.find((c) => c.type === "text")?.text || "Error occurred";
			lines.push(PALETTE.error(errorText));
		} else {
			const textOutput = result.content?.find((c) => c.type === "text")?.text;
			if (textOutput) {
				const rawText = String(textOutput).trim();
				let detectedLang = "typescript";
				let formattedText = rawText;

				if (
					(rawText.startsWith("{") && rawText.endsWith("}")) ||
					(rawText.startsWith("[") && rawText.endsWith("]"))
				) {
					detectedLang = "json";
					try {
						const parsed = JSON.parse(rawText);
						formattedText = JSON.stringify(parsed, null, 2);
					} catch {
						formattedText = rawText;
					}
				} else if (
					rawText.startsWith("diff --git") ||
					rawText.startsWith("@@") ||
					(rawText.includes("\n+") && rawText.includes("\n-"))
				) {
					detectedLang = "diff";
				}

				const highlighted = highlightCode(formattedText, detectedLang);
				lines.push(...highlighted);
			}
		}
	}

	return lines;
}
