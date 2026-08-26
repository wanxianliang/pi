import { isKeyRelease, type KeyId, matchesKey } from "@earendil-works/pi-tui";
import type { BottomInputShortcutKey, BottomInputShortcuts, ShortcutValidationResult } from "./types.ts";

export const DEFAULT_BOTTOM_INPUT_SHORTCUTS: BottomInputShortcuts = {
	stashEditor: "alt+s",
	copyEditor: "ctrl+alt+c",
	cutEditor: "ctrl+alt+x",
	scrollChatUp: "super+up",
	scrollChatDown: "super+down",
	editorStart: "super+shift+up",
	editorEnd: "super+shift+down",
	jumpPreviousUserMessage: "ctrl+shift+u",
	jumpNextUserMessage: "ctrl+shift+i",
	jumpPreviousAssistantMessage: "ctrl+alt+,",
	jumpNextAssistantMessage: "ctrl+alt+.",
	jumpChatBottom: "ctrl+shift+g",
};

export const SHORTCUT_LABELS: Record<BottomInputShortcutKey, string> = {
	stashEditor: "Stash Editor",
	copyEditor: "Copy Editor",
	cutEditor: "Cut Editor",
	scrollChatUp: "Scroll Chat Up",
	scrollChatDown: "Scroll Chat Down",
	editorStart: "Move Cursor Start",
	editorEnd: "Move Cursor End",
	jumpPreviousUserMessage: "Previous User Message",
	jumpNextUserMessage: "Next User Message",
	jumpPreviousAssistantMessage: "Previous Assistant Msg",
	jumpNextAssistantMessage: "Next Assistant Msg",
	jumpChatBottom: "Chat Bottom",
};

export const SHORTCUT_KEYS = Object.keys(DEFAULT_BOTTOM_INPUT_SHORTCUTS) as BottomInputShortcutKey[];

const SUPER_SHORTCUT_PATTERNS = new Map<string, RegExp>([
	["super+up", /^\x1b\[(?:1;9(?::[12])?[AH]|574(?:19|23);9(?::[12])?u|7;9(?::[12])?~|27;9;65~)$/],
	["super+down", /^\x1b\[(?:1;9(?::[12])?[BF]|574(?:20|24);9(?::[12])?u|8;9(?::[12])?~|27;9;66~)$/],
	["super+home", /^\x1b\[(?:1;9(?::[12])?H|57423;9(?::[12])?u|7;9(?::[12])?~)$/],
	["super+end", /^\x1b\[(?:1;9(?::[12])?F|57424;9(?::[12])?u|8;9(?::[12])?~)$/],
	["super+pageup", /^\x1b\[(?:5;9(?::[12])?~|57421;9(?::[12])?u)$/],
	["super+pagedown", /^\x1b\[(?:6;9(?::[12])?~|57422;9(?::[12])?u)$/],
	["super+shift+up", /^\x1b\[(?:1;10(?::[12])?[AH]|574(?:19|23);10(?::[12])?u|7;10(?::[12])?~|27;10;65~)$/],
	["super+shift+down", /^\x1b\[(?:1;10(?::[12])?[BF]|574(?:20|24);10(?::[12])?u|8;10(?::[12])?~|27;10;66~)$/],
	["super+shift+home", /^\x1b\[(?:1;10(?::[12])?H|57423;10(?::[12])?u|7;10(?::[12])?~)$/],
	["super+shift+end", /^\x1b\[(?:1;10(?::[12])?F|57424;10(?::[12])?u|8;10(?::[12])?~)$/],
]);

const MODIFIER_ORDER = ["ctrl", "alt", "super", "shift"] as const;
const MODIFIERS = new Set<string>(MODIFIER_ORDER);
const NAMED_KEYS = new Set([
	"escape",
	"esc",
	"enter",
	"return",
	"tab",
	"space",
	"backspace",
	"delete",
	"insert",
	"clear",
	"home",
	"end",
	"pageup",
	"pagedown",
	"up",
	"down",
	"left",
	"right",
]);
const SYMBOL_KEYS = new Set([
	"`",
	"-",
	"=",
	"[",
	"]",
	"\\",
	";",
	"'",
	",",
	".",
	"/",
	"!",
	"@",
	"#",
	"$",
	"%",
	"^",
	"&",
	"*",
	"(",
	")",
	"_",
	"|",
	"~",
	"{",
	"}",
	":",
	"<",
	">",
	"?",
]);
const RAW_RESERVED_SHORTCUTS = [
	"escape",
	"ctrl+c",
	"ctrl+d",
	"ctrl+z",
	"shift+tab",
	"ctrl+p",
	"shift+ctrl+p",
	"ctrl+l",
	"ctrl+o",
	"shift+ctrl+o",
	"ctrl+t",
	"ctrl+n",
	"ctrl+g",
	"alt+enter",
	"alt+up",
	"alt+down",
	"ctrl+v",
	"alt+v",
	"shift+l",
	"shift+t",
	"ctrl+s",
	"ctrl+r",
	"ctrl+backspace",
	"ctrl+a",
	"ctrl+x",
	"ctrl+u",
];

export const RESERVED_BOTTOM_INPUT_SHORTCUTS = new Set(
	RAW_RESERVED_SHORTCUTS.map((shortcut) => shortcutConflictKey(normalizeShortcut(shortcut))).filter(Boolean),
);

export function resolveBottomInputShortcuts(value: Partial<BottomInputShortcuts> | undefined): BottomInputShortcuts {
	const resolved = { ...DEFAULT_BOTTOM_INPUT_SHORTCUTS };
	if (!value) return resolved;
	for (const key of SHORTCUT_KEYS) {
		const shortcut = typeof value[key] === "string" ? normalizeShortcut(value[key]) : "";
		if (shortcut) resolved[key] = shortcut;
	}
	return resolved;
}

export function shortcutUsesSuper(shortcut: string): boolean {
	const parts = normalizeShortcut(shortcut).split("+");
	return parts.slice(0, -1).includes("super");
}

export function isSupportedSuperShortcut(shortcut: string): boolean {
	return SUPER_SHORTCUT_PATTERNS.has(normalizeShortcut(shortcut));
}

export function shortcutConflictKey(shortcut: string): string {
	switch (normalizeShortcut(shortcut)) {
		case "super+home":
			return "super+up";
		case "super+end":
			return "super+down";
		case "super+shift+home":
			return "super+shift+up";
		case "super+shift+end":
			return "super+shift+down";
		default:
			return normalizeShortcut(shortcut);
	}
}

export function matchesConfiguredShortcut(data: string, shortcut: string): boolean {
	if (isKeyRelease(data)) return false;
	const normalizedShortcut = normalizeShortcut(shortcut);
	if (!normalizedShortcut) return false;
	if (shortcutUsesSuper(normalizedShortcut)) {
		return SUPER_SHORTCUT_PATTERNS.get(normalizedShortcut)?.test(data) ?? false;
	}
	return matchesKey(data, normalizedShortcut as KeyId);
}

export function isStashShortcutInput(data: string, shortcut = DEFAULT_BOTTOM_INPUT_SHORTCUTS.stashEditor): boolean {
	if (isKeyRelease(data)) return false;
	if (normalizeShortcut(shortcut) !== "alt+s") {
		return matchesConfiguredShortcut(data, shortcut);
	}
	return (
		data === "ß" ||
		data === "\x1bs" ||
		data === "\x1bS" ||
		/^\x1b\[(?:83|115)(?::\d*)?(?::\d*)?;3(?::\d+)?u$/.test(data) ||
		data === "\x1b[27;3;115~" ||
		data === "\x1b[27;3;83~" ||
		matchesKey(data, "alt+s")
	);
}

export function isSelectAllShortcutInput(data: string): boolean {
	if (isKeyRelease(data)) return false;
	if (
		matchesKey(data, "ctrl+a") ||
		matchesKey(data, "super+a") ||
		matchesKey(data, "super+shift+a") ||
		matchesKey(data, "ctrl+shift+a")
	) {
		return true;
	}
	if (data === "\x01" || data === "\x1b\x01") {
		return true;
	}
	return /^\x1b\[(?:97|65);(?:3|5|6|9|10)(?::[12])?u$/.test(data) || /^\x1b\[27;(?:3|5|6|9|10);(?:97|65)~$/.test(data);
}

export function isCopyShortcutInput(data: string): boolean {
	if (isKeyRelease(data)) return false;
	if (
		matchesKey(data, "super+c") ||
		matchesKey(data, "ctrl+c") ||
		matchesKey(data, "ctrl+shift+c") ||
		matchesKey(data, "super+shift+c") ||
		matchesKey(data, "ctrl+alt+c") ||
		matchesKey(data, "alt+c")
	) {
		return true;
	}
	if (data === "\x03" || data === "\x1b\x03" || data === "\x1bc" || data === "\x1bC") {
		return true;
	}
	return /^\x1b\[(?:99|67);(?:3|5|6|9|10)(?::[12])?u$/.test(data) || /^\x1b\[27;(?:3|5|6|9|10);(?:99|67)~$/.test(data);
}

export function isCutShortcutInput(data: string): boolean {
	if (isKeyRelease(data)) return false;
	if (
		matchesKey(data, "super+x") ||
		matchesKey(data, "ctrl+x") ||
		matchesKey(data, "ctrl+shift+x") ||
		matchesKey(data, "super+shift+x") ||
		matchesKey(data, "ctrl+alt+x") ||
		matchesKey(data, "alt+x")
	) {
		return true;
	}
	if (data === "\x18" || data === "\x1b\x18" || data === "\x1bx" || data === "\x1bX") {
		return true;
	}
	return (
		/^\x1b\[(?:120|88);(?:3|5|6|9|10)(?::[12])?u$/.test(data) || /^\x1b\[27;(?:3|5|6|9|10);(?:120|88)~$/.test(data)
	);
}

export function normalizeShortcut(shortcut: string): string {
	const parts = shortcut
		.trim()
		.toLowerCase()
		.replace(/\s+/g, "")
		.split("+")
		.filter(Boolean)
		.map((part) => (part === "cmd" || part === "command" ? "super" : part));
	if (parts.length === 0) return "";

	const key = normalizeKey(parts.at(-1)!);
	if (!key) return "";
	const modifiers = [...new Set(parts.slice(0, -1))].filter((part) => MODIFIERS.has(part));
	if (modifiers.length !== parts.slice(0, -1).length) return "";
	modifiers.sort((a, b) => MODIFIER_ORDER.indexOf(a as any) - MODIFIER_ORDER.indexOf(b as any));
	return [...modifiers, key].join("+");
}

export function validateShortcutChange(
	shortcuts: BottomInputShortcuts,
	key: BottomInputShortcutKey,
	candidate: string,
): ShortcutValidationResult {
	const normalized = normalizeShortcut(candidate);
	if (!normalized) return { ok: false, reason: "Unrecognized shortcut" };
	if (RESERVED_BOTTOM_INPUT_SHORTCUTS.has(shortcutConflictKey(normalized))) {
		return { ok: false, reason: "Reserved by Pi" };
	}
	if (shortcutUsesSuper(normalized) && !isSupportedSuperShortcut(normalized)) {
		return { ok: false, reason: "Only Super/Command arrow shortcuts are supported" };
	}
	const conflictKey = shortcutConflictKey(normalized);
	for (const otherKey of SHORTCUT_KEYS) {
		if (otherKey === key) continue;
		if (shortcutConflictKey(shortcuts[otherKey]) === conflictKey) {
			return { ok: false, reason: `Conflicts with ${SHORTCUT_LABELS[otherKey]}` };
		}
	}
	return { ok: true, shortcut: normalized };
}

function normalizeKey(key: string): string {
	if (key === "esc") return "escape";
	if (key === "return") return "enter";
	if (key === "pgup") return "pageup";
	if (key === "pgdn") return "pagedown";
	if (/^[a-z0-9]$/.test(key) || NAMED_KEYS.has(key) || SYMBOL_KEYS.has(key)) return key;
	return "";
}

export function registerBottomInputShortcuts(pi: any, runtime: any): void {
	pi.registerShortcut?.("alt+s", {
		description: "暂存/恢复当前输入框文本",
		handler: (ctx: any) => {
			runtime.stashOrRestoreEditorText(ctx);
		},
	});
}
