/**
 * stripCardBorders — strip pi-enhance-tui rounded card borders from copied text.
 *
 * Removes:
 * - Top/bottom border lines (╭…╮, ╰…╯, all-box-drawing horizontal rules)
 * - Leading │ and trailing │ from content lines (plus up to 2 adjacent spaces)
 *
 * Safe on plain text: lines without border chars are passed through unchanged.
 */

const ANSI_REGEX =
	/\x1b(?:\[[0-?]*[ -/]*[@-~]|\](?:1337;[^\x07\x1b]*|133;[^\x07\x1b]*|8;[^;]*;[^\x07\x1b]*)(?:\x07|\x1b\\)|_[A-Za-z0-9:;=_-]*(?:\x07|\x1b\\))/g;

function stripAnsi(str: string): string {
	if (!str.includes("\x1b")) return str;
	return str.replace(ANSI_REGEX, "");
}

const BOX_DRAWING_CHARS = new Set<string>([
	"╭",
	"╮",
	"╰",
	"╯",
	"─",
	"│",
	"├",
	"┤",
	"┴",
	"┬",
	"▲",
	" ",
	"⠋",
	"⠙",
	"⠹",
	"⠸",
	"⠼",
	"⠴",
	"⠦",
	"⠧",
	"⠇",
	"⠏",
]);

export function stripCardBorders(text: string): string {
	const lines = text.split("\n");
	const out: string[] = [];

	for (const rawLine of lines) {
		const line = rawLine.trimEnd();

		if (line.length === 0) {
			out.push("");
			continue;
		}

		const cleanLine = stripAnsi(line).trimEnd();
		if (cleanLine.length === 0) {
			out.push("");
			continue;
		}

		const first = cleanLine[0];
		const last = cleanLine[cleanLine.length - 1];

		// Top / bottom border lines — skip entirely
		if (first === "╭" || first === "╰") {
			continue;
		}

		// Pure box-drawing horizontal rules (e.g. dividers inside cards)
		if ([...cleanLine].every((ch) => BOX_DRAWING_CHARS.has(ch))) {
			continue;
		}

		// Content line with │ on both ends
		if (first === "│" && last === "│") {
			let inner = cleanLine.slice(1, cleanLine.length - 1);
			if (inner.startsWith("  ")) inner = inner.slice(2);
			else if (inner.startsWith(" ")) inner = inner.slice(1);
			if (inner.endsWith("  ")) inner = inner.slice(0, -2);
			else if (inner.endsWith(" ")) inner = inner.slice(0, -1);
			out.push(inner.trimEnd());
			continue;
		}

		// Content line with only leading │ (partial selection)
		if (first === "│") {
			let inner = cleanLine.slice(1);
			if (inner.startsWith("  ")) inner = inner.slice(2);
			else if (inner.startsWith(" ")) inner = inner.slice(1);
			out.push(inner.trimEnd());
			continue;
		}

		// Content line with only trailing │ (partial selection)
		if (last === "│") {
			let inner = cleanLine.slice(0, -1);
			if (inner.endsWith("  ")) inner = inner.slice(0, -2);
			else if (inner.endsWith(" ")) inner = inner.slice(0, -1);
			out.push(inner.trimEnd());
			continue;
		}

		// Plain line — no border chars, pass through
		out.push(cleanLine);
	}

	// Trim leading and trailing blank lines produced by border removal
	while (out.length > 0 && out[0].trim() === "") out.shift();
	while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();

	return out.join("\n");
}
