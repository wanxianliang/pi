import type { BottomInputIconSet } from "./types.ts";

export const NERD_BOTTOM_INPUT_ICONS: BottomInputIconSet = {
	model: "󰚩",
	time: "󱐋",
};

export const ASCII_BOTTOM_INPUT_ICONS: BottomInputIconSet = {
	model: "",
	time: "◷",
};

export function hasBottomInputNerdFont(env: NodeJS.ProcessEnv = process.env): boolean {
	const piUiCustomOverride = parseBooleanEnv(env.PI_UI_CUSTOM_NERD_FONT);
	if (piUiCustomOverride !== undefined) return piUiCustomOverride;
	const powerlineOverride = parseBooleanEnv(env.POWERLINE_NERD_FONTS);
	if (powerlineOverride !== undefined) return powerlineOverride;
	if (env.GHOSTTY_RESOURCES_DIR) return true;

	const terminalName = `${env.TERM_PROGRAM ?? ""} ${env.TERM ?? ""}`.toLowerCase();
	return ["iterm", "wezterm", "kitty", "ghostty", "alacritty"].some((name) => terminalName.includes(name));
}

export function getBottomInputIcons(env: NodeJS.ProcessEnv = process.env): BottomInputIconSet {
	return hasBottomInputNerdFont(env) ? NERD_BOTTOM_INPUT_ICONS : ASCII_BOTTOM_INPUT_ICONS;
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
	if (value === "1") return true;
	if (value === "0") return false;
	return undefined;
}
