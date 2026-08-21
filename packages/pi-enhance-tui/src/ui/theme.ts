/**
 * Visual styling tokens, borders, and ANSI palettes for pi-enhance-tui.
 */

export const PALETTE = {
	accent: (s: string) => `\x1b[38;2;122;162;247m${s}\x1b[0m`, // Tokyo Blue
	accentBold: (s: string) => `\x1b[1;38;2;122;162;247m${s}\x1b[0m`,
	success: (s: string) => `\x1b[38;2;158;206;106m${s}\x1b[0m`, // Emerald
	successBold: (s: string) => `\x1b[1;38;2;158;206;106m${s}\x1b[0m`,
	error: (s: string) => `\x1b[38;2;247;118;142m${s}\x1b[0m`, // Coral Red
	errorBold: (s: string) => `\x1b[1;38;2;247;118;142m${s}\x1b[0m`,
	warning: (s: string) => `\x1b[38;2;224;175;104m${s}\x1b[0m`, // Amber
	warningBold: (s: string) => `\x1b[1;38;2;224;175;104m${s}\x1b[0m`,
	purple: (s: string) => `\x1b[38;2;187;154;247m${s}\x1b[0m`, // Lavender Purple
	purpleBold: (s: string) => `\x1b[1;38;2;187;154;247m${s}\x1b[0m`,
	cyan: (s: string) => `\x1b[38;2;125;207;255m${s}\x1b[0m`,
	cyanBold: (s: string) => `\x1b[1;38;2;125;207;255m${s}\x1b[0m`,
	muted: (s: string) => `\x1b[38;2;86;95;137m${s}\x1b[0m`, // Slate
	border: (s: string) => `\x1b[38;2;65;72;104m${s}\x1b[0m`, // Unified subtle border
	borderHighlight: (s: string) => `\x1b[38;2;122;162;247m${s}\x1b[0m`,
	lineNumber: (s: string) => `\x1b[38;2;75;85;120m${s}\x1b[0m`,
	badgeRunning: (s: string) => `\x1b[38;2;224;175;104m${s}\x1b[0m`,
	badgeSuccess: (s: string) => `\x1b[38;2;158;206;106m${s}\x1b[0m`,
	badgeError: (s: string) => `\x1b[38;2;247;118;142m${s}\x1b[0m`,
	badgeUser: (s: string) => `\x1b[38;2;125;207;255m${s}\x1b[0m`,
	badgeThinking: (s: string) => `\x1b[38;2;187;154;247m${s}\x1b[0m`,
	badgeAssistant: (s: string) => `\x1b[38;2;122;162;247m${s}\x1b[0m`,
};

export const BORDER_CHARS = {
	tl: "╭",
	tr: "╮",
	bl: "╰",
	br: "╯",
	h: "─",
	v: "│",
	vl: "├",
	vr: "┤",
};

export const STATUS_ICONS = {
	running: "✦",
	success: "✔",
	error: "✖",
	info: "ℹ",
	code: "✦",
	console: "❯",
	user: "◆",
	thinking: "◇",
	assistant: "✦",
};
