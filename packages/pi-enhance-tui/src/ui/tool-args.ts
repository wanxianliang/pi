/**
 * Formats tool execution arguments cleanly without repeating the tool name.
 */

import { highlightCode } from "../highlighter.ts";
import { PALETTE } from "./theme.ts";

export function formatToolArgs(_toolName: string, args: unknown): string[] {
	if (!args || typeof args !== "object") {
		return args ? [String(args)] : [];
	}

	const record = args as Record<string, unknown>;

	// 1. Code snippet (e.g. pi_executor)
	if (typeof record.code === "string") {
		const codeSnippet = record.code.trim();
		const lines = highlightCode(codeSnippet, "typescript");
		const maxLineNumWidth = String(lines.length).length;
		return lines.map((line, i) => {
			const lineNum = String(i + 1).padStart(maxLineNumWidth, " ");
			return `${PALETTE.lineNumber(lineNum)} ${PALETTE.border("│")} ${line}`;
		});
	}

	// 2. Shell Command (e.g. bash)
	if (typeof record.command === "string") {
		return [`${PALETTE.accent("$")} ${record.command}`];
	}

	// 3. File read/write/edit paths
	if (record.path || record.file_path) {
		const targetPath = String(record.path ?? record.file_path);
		let details = `${PALETTE.cyan(targetPath)}`;
		if (record.offset !== undefined || record.limit !== undefined) {
			details += ` ${PALETTE.muted(`(offset: ${record.offset ?? 1}, limit: ${record.limit ?? "all"})`)}`;
		} else if (record.start !== undefined || record.end !== undefined) {
			details += ` ${PALETTE.muted(`(lines ${record.start ?? 1}-${record.end ?? ""})`)}`;
		}
		const otherKeys = Object.keys(record).filter(
			(k) => !["path", "file_path", "offset", "limit", "start", "end", "content", "oldText", "newText"].includes(k),
		);
		if (otherKeys.length === 0) {
			return [details];
		}
	}

	// 4. Pattern / Search query
	if (record.pattern || record.query) {
		const query = String(record.pattern ?? record.query);
		let details = `${PALETTE.warning(`"${query}"`)}`;
		if (record.path) {
			details += ` ${PALETTE.muted("in")} ${PALETTE.cyan(String(record.path))}`;
		}
		return [details];
	}

	// 5. Generic object: format as clean key-value pairs
	const entries = Object.entries(record);
	if (entries.length === 0) return [];
	if (entries.length === 1) {
		const [k, v] = entries[0];
		const vStr = typeof v === "object" ? JSON.stringify(v) : String(v);
		return [`${PALETTE.muted(`${k}:`)} ${vStr}`];
	}

	return entries.map(([k, v]) => {
		const vStr = typeof v === "object" ? JSON.stringify(v) : String(v);
		return `${PALETTE.muted(`${k}:`)} ${vStr}`;
	});
}

export function stripLeadingToolName(line: string, toolName: string): string {
	if (!line || !toolName) return line;
	const stripped = line.replace(/\x1b\[[0-9;]*m/g, "").trim();
	const regex = new RegExp(`^${toolName}(\\s+|:\\s*)`, "i");
	if (regex.test(stripped)) {
		const cleaned = line.replace(
			new RegExp(`(\\x1b\\[[0-9;]*m)*${toolName}(\\x1b\\[[0-9;]*m)*(\\s+|:\\s*)`, "i"),
			"",
		);
		return cleaned.trim();
	}
	if (stripped.toLowerCase() === toolName.toLowerCase()) {
		return "";
	}
	return line;
}
