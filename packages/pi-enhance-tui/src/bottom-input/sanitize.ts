import type { TerminalSanitizeOptions } from "./types.ts";

const ESC = "\x1b";
const C1_STRING_START = /[\x90\x9d\x9e\x9f]/;
const C0_CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const C1_CONTROL = /[\x80-\x8f\x91-\x9a\x9c]/g;

export function sanitizeTerminalText(value: unknown, options: TerminalSanitizeOptions = {}): string {
	const input = value === undefined || value === null ? "" : String(value);
	if (!input) return "";
	const preserveSgr = options.preserveSgr !== false;
	let result = "";
	for (let index = 0; index < input.length; ) {
		const sequence = readAnsiSequence(input, index);
		if (sequence) {
			if (preserveSgr && isSgrSequence(sequence.code)) result += sequence.code;
			index += sequence.length;
			continue;
		}
		const char = input[index]!;
		if (char === "\n") {
			if (options.allowNewline !== false) result += char;
			index += 1;
			continue;
		}
		if (char === "\t") {
			if (options.allowTab !== false) result += char;
			index += 1;
			continue;
		}
		if (C0_CONTROL.test(char) || C1_CONTROL.test(char) || C1_STRING_START.test(char)) {
			C0_CONTROL.lastIndex = 0;
			C1_CONTROL.lastIndex = 0;
			C1_STRING_START.lastIndex = 0;
			index += 1;
			continue;
		}
		C0_CONTROL.lastIndex = 0;
		C1_CONTROL.lastIndex = 0;
		C1_STRING_START.lastIndex = 0;
		result += char;
		index += 1;
	}
	return result;
}

export function sanitizeTerminalSingleLineText(
	value: unknown,
	options: Omit<TerminalSanitizeOptions, "allowNewline" | "allowTab"> = {},
): string {
	return sanitizeTerminalText(value, { ...options, allowNewline: false, allowTab: false })
		.replace(/\s+/g, " ")
		.trim();
}

function isSgrSequence(sequence: string): boolean {
	return /^\x1b\[[0-9;:]*m$/.test(sequence) || /^\x9b[0-9;:]*m$/.test(sequence);
}

function readAnsiSequence(input: string, index: number): { code: string; length: number } | null {
	const char = input[index];
	if (char === ESC) return readEscSequence(input, index);
	if (char === "\x9b") return readCsiSequence(input, index, 1);
	if (char === "\x90" || char === "\x9d" || char === "\x9e" || char === "\x9f")
		return readStringControlSequence(input, index, 1);
	return null;
}

function readEscSequence(input: string, index: number): { code: string; length: number } {
	const next = input[index + 1];
	if (next === "[") return readCsiSequence(input, index, 2);
	if (next === "]" || next === "P" || next === "_" || next === "^") return readStringControlSequence(input, index, 2);
	return { code: input.slice(index, Math.min(input.length, index + 2)), length: Math.min(2, input.length - index) };
}

function readCsiSequence(input: string, index: number, prefixLength: number): { code: string; length: number } {
	for (let end = index + prefixLength; end < input.length; end += 1) {
		const code = input.charCodeAt(end);
		if (code >= 0x40 && code <= 0x7e) return { code: input.slice(index, end + 1), length: end + 1 - index };
	}
	return { code: input.slice(index, input.length - index), length: input.length - index };
}

function readStringControlSequence(
	input: string,
	index: number,
	prefixLength: number,
): { code: string; length: number } {
	for (let end = index + prefixLength; end < input.length; end += 1) {
		if (input[end] === "\x07") return { code: input.slice(index, end + 1), length: end + 1 - index };
		if (input[end] === ESC && input[end + 1] === "\\")
			return { code: input.slice(index, end + 2), length: end + 2 - index };
	}
	return { code: input.slice(index, input.length - index), length: input.length - index };
}
