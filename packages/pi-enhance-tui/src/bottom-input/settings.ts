import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	type Component,
	Container,
	Key,
	matchesKey,
	type SettingItem,
	SettingsList,
	type SettingsListTheme,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import type { FixedBottomEditorStatus, PiUiCustomSettings, ThemeLike } from "./types.ts";

export const DEFAULT_SETTINGS: PiUiCustomSettings = {
	fixedBottomEditor: { enabled: true },
	beautifiedInput: { enabled: true },
};

export function cloneDefaultSettings(): PiUiCustomSettings {
	return {
		fixedBottomEditor: { ...DEFAULT_SETTINGS.fixedBottomEditor },
		beautifiedInput: { ...DEFAULT_SETTINGS.beautifiedInput },
	};
}

const SETTINGS_ENV = "PI_UI_CUSTOM_SETTINGS_PATH";
export const PI_SETTINGS_NAMESPACE = "pi-ui-custom";

export function cloneStartupSettings(): PiUiCustomSettings {
	const settings = cloneDefaultSettings();
	settings.fixedBottomEditor.enabled = true;
	settings.beautifiedInput.enabled = true;
	return settings;
}

export function getAgentDir(): string {
	if (process.env.PI_AGENT_DIR) {
		return process.env.PI_AGENT_DIR;
	}
	return path.join(os.homedir(), ".pi", "agent");
}

export function getPiSettingsPath(): string {
	return path.join(getAgentDir(), "settings.json");
}

export function getLegacySettingsPath(): string {
	return path.join(getAgentDir(), "pi-ui-custom", "settings.json");
}

export function readPersistedSettings(filePath?: string): PiUiCustomSettings {
	const isolatedPath = filePath ?? process.env[SETTINGS_ENV]?.trim();
	if (isolatedPath) {
		return readStandaloneSettings(isolatedPath, cloneStartupSettings());
	}
	return readNamespacedPiSettings(getPiSettingsPath(), getLegacySettingsPath());
}

export function writePersistedSettings(settings: PiUiCustomSettings, filePath?: string): void {
	const isolatedPath = filePath ?? process.env[SETTINGS_ENV]?.trim();
	if (isolatedPath) {
		writeStandaloneSettings(settings, isolatedPath);
		return;
	}
	writeNamespacedPiSettings(settings, getPiSettingsPath());
}

export function readNamespacedPiSettings(
	piSettingsPath: string,
	legacySettingsPath = getLegacySettingsPath(),
): PiUiCustomSettings {
	const defaults = cloneStartupSettings();
	const namespaceSettings = readNamespaceFromPiFile(piSettingsPath, defaults);
	if (namespaceSettings) return namespaceSettings;

	const legacySettings = readStandaloneSettingsIfExists(legacySettingsPath, defaults);
	if (legacySettings) {
		writeNamespacedPiSettings(legacySettings, piSettingsPath);
		return legacySettings;
	}
	return defaults;
}

export function writeNamespacedPiSettings(settings: PiUiCustomSettings, piSettingsPath: string): void {
	try {
		const root = readPiSettingsRoot(piSettingsPath);
		if (!root) return;
		root[PI_SETTINGS_NAMESPACE] = cloneSettings(settings);
		fs.mkdirSync(path.dirname(piSettingsPath), { recursive: true });
		fs.writeFileSync(piSettingsPath, `${JSON.stringify(root, null, 2)}\n`, "utf-8");
	} catch (error) {
		console.debug?.(`[pi-enhance-tui] Failed to write settings namespace to ${piSettingsPath}:`, error);
	}
}

export function cloneSettings(settings: PiUiCustomSettings): PiUiCustomSettings {
	return {
		fixedBottomEditor: { ...settings.fixedBottomEditor },
		beautifiedInput: { ...settings.beautifiedInput },
	};
}

function readStandaloneSettings(filePath: string, defaults: PiUiCustomSettings): PiUiCustomSettings {
	return readStandaloneSettingsIfExists(filePath, defaults) ?? defaults;
}

function readStandaloneSettingsIfExists(
	filePath: string,
	defaults: PiUiCustomSettings,
): PiUiCustomSettings | undefined {
	if (!fs.existsSync(filePath)) return undefined;
	try {
		return normalizeSettings(JSON.parse(fs.readFileSync(filePath, "utf-8")), defaults);
	} catch {
		return undefined;
	}
}

function readNamespaceFromPiFile(filePath: string, defaults: PiUiCustomSettings): PiUiCustomSettings | undefined {
	if (!fs.existsSync(filePath)) return undefined;
	try {
		const root = JSON.parse(fs.readFileSync(filePath, "utf-8"));
		if (!isRecord(root) || root[PI_SETTINGS_NAMESPACE] === undefined) return undefined;
		return normalizeSettings(root[PI_SETTINGS_NAMESPACE], defaults);
	} catch {
		return undefined;
	}
}

function readPiSettingsRoot(filePath: string): Record<string, any> | undefined {
	if (!fs.existsSync(filePath)) return {};
	try {
		const root = JSON.parse(fs.readFileSync(filePath, "utf-8"));
		return isRecord(root) ? root : undefined;
	} catch {
		return undefined;
	}
}

function normalizeSettings(value: unknown, defaults: PiUiCustomSettings): PiUiCustomSettings {
	const raw = isRecord(value) ? value : {};
	return {
		fixedBottomEditor: {
			enabled:
				typeof raw.fixedBottomEditor?.enabled === "boolean"
					? raw.fixedBottomEditor.enabled
					: defaults.fixedBottomEditor.enabled,
		},
		beautifiedInput: {
			enabled:
				typeof raw.beautifiedInput?.enabled === "boolean"
					? raw.beautifiedInput.enabled
					: defaults.beautifiedInput.enabled,
		},
	};
}

function writeStandaloneSettings(settings: PiUiCustomSettings, filePath: string): void {
	try {
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, `${JSON.stringify(cloneSettings(settings), null, 2)}\n`, "utf-8");
	} catch (error) {
		console.debug?.(`[pi-enhance-tui] Failed to write settings to ${filePath}:`, error);
	}
}

function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const MAIN_MAX_VISIBLE = 10;
const ON = "ON";
const OFF = "OFF";

type MainSettingId = "fixedBottomEditor.enabled" | "beautifiedInput.enabled";

function booleanLabel(value: boolean): string {
	return value ? ON : OFF;
}

function booleanValue(value: string): boolean {
	return value === ON;
}

function createSettingsListTheme(theme: ThemeLike, hint: string): SettingsListTheme {
	const base: SettingsListTheme = {
		label: (text, selected) => (selected ? theme.fg("accent", text) : text),
		value: (text, selected) => (selected ? theme.fg("accent", text) : theme.fg("muted", text)),
		description: (text) => theme.fg("dim", text),
		cursor: theme.fg("accent", "→ "),
		hint: (text) => theme.fg("dim", text),
	};
	return {
		...base,
		hint: (text) => base.hint(text.includes("Enter") || text.includes("Type to search") ? ` ${hint}` : text),
	};
}

function safeFg(theme: ThemeLike, token: string, text: string, fallback = "text"): string {
	try {
		return theme.fg(token, text);
	} catch {
		try {
			return theme.fg(fallback, text);
		} catch {
			return text;
		}
	}
}

class FramedSettingsPanel implements Component {
	private readonly content: Component;
	private readonly theme: ThemeLike;

	constructor(content: Component, theme: ThemeLike) {
		this.content = content;
		this.theme = theme;
	}

	render(width: number): string[] {
		const safeWidth = Math.max(1, Math.floor(width));
		if (safeWidth < 8) return this.content.render(safeWidth);
		const innerWidth = Math.max(1, safeWidth - 4);
		const contentLines = this.content.render(innerWidth);
		return [
			this.border(`╭${"─".repeat(Math.max(0, safeWidth - 2))}╮`),
			...contentLines.map((line) => this.contentLine(line, safeWidth)),
			this.border(`╰${"─".repeat(Math.max(0, safeWidth - 2))}╯`),
		];
	}

	invalidate(): void {
		this.content.invalidate?.();
	}

	handleInput(data: string): void {
		this.content.handleInput?.(data);
	}

	private contentLine(line: string, width: number): string {
		const innerWidth = Math.max(0, width - 4);
		const clipped = truncateToWidth(line, innerWidth, "", false);
		const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(clipped)));
		return `${this.border("│")} ${clipped}${padding} ${this.border("│")}`;
	}

	private border(text: string): string {
		return safeFg(this.theme, "borderAccent", text, "border");
	}
}

export class PiUiCustomSettingsComponent extends Container {
	private readonly settingsList: SettingsList;
	private closed = false;
	private readonly done?: () => void;
	private readonly ops: {
		getSettings?: () => PiUiCustomSettings;
		setFixedBottomEditorEnabled?: (enabled: boolean) => FixedBottomEditorStatus | undefined;
		setBeautifiedInputEnabled?: (enabled: boolean) => FixedBottomEditorStatus | undefined;
		onSettingsChanged?: (settings: PiUiCustomSettings) => void;
	};

	constructor(
		theme: ThemeLike,
		done?: () => void,
		ops: {
			getSettings?: () => PiUiCustomSettings;
			setFixedBottomEditorEnabled?: (enabled: boolean) => FixedBottomEditorStatus | undefined;
			setBeautifiedInputEnabled?: (enabled: boolean) => FixedBottomEditorStatus | undefined;
			onSettingsChanged?: (settings: PiUiCustomSettings) => void;
		} = {},
	) {
		super();
		this.done = done;
		this.ops = ops;
		const listTheme = createSettingsListTheme(theme, "↑/↓ select · Enter/Space toggle · Esc/q close");

		this.settingsList = new SettingsList(
			this.createMainItems(),
			MAIN_MAX_VISIBLE,
			listTheme,
			(id, newValue) => this.handleMainChange(id as MainSettingId, newValue),
			() => this.close(),
			{ enableSearch: true },
		);
		this.syncAllMainValues();
		(this.settingsList as any).selectedIndex = 0;
		this.addChild(new FramedSettingsPanel(this.settingsList, theme));
	}

	handleInput(data: string): void {
		if (data === "q" || data === "Q" || matchesKey(data, Key.ctrl("c"))) {
			this.close();
			return;
		}
		this.settingsList.handleInput(data);
	}

	private createMainItems(): SettingItem[] {
		const settings = (this.ops.getSettings ?? readPersistedSettings)();
		return [
			{
				id: "fixedBottomEditor.enabled",
				label: "Fixed Input",
				description: "控制底部固定编辑器 runtime",
				currentValue: booleanLabel(settings.fixedBottomEditor.enabled),
				values: [ON, OFF],
			},
			{
				id: "beautifiedInput.enabled",
				label: "Beautified Input",
				description: "控制输入框线框与嵌入边框状态",
				currentValue: booleanLabel(settings.beautifiedInput.enabled),
				values: [ON, OFF],
			},
		];
	}

	private handleMainChange(id: MainSettingId, newValue: string): void {
		const settings = (this.ops.getSettings ?? readPersistedSettings)();
		if (id === "fixedBottomEditor.enabled") {
			const nextEnabled = booleanValue(newValue);
			settings.fixedBottomEditor.enabled = nextEnabled;
			this.ops.setFixedBottomEditorEnabled?.(nextEnabled);
			this.syncMainValue(id, settings.fixedBottomEditor.enabled);
		} else if (id === "beautifiedInput.enabled") {
			settings.beautifiedInput.enabled = booleanValue(newValue);
			this.ops.setBeautifiedInputEnabled?.(settings.beautifiedInput.enabled);
			this.syncMainValue(id, settings.beautifiedInput.enabled);
			this.syncMainValue("fixedBottomEditor.enabled", settings.fixedBottomEditor.enabled);
		}
	}

	private syncAllMainValues(): void {
		const settings = (this.ops.getSettings ?? readPersistedSettings)();
		this.syncMainValue("fixedBottomEditor.enabled", settings.fixedBottomEditor.enabled);
		this.syncMainValue("beautifiedInput.enabled", settings.beautifiedInput.enabled);
	}

	private syncMainValue(id: MainSettingId, value: boolean | string | number): void {
		const displayValue = typeof value === "boolean" ? booleanLabel(value) : String(value);
		this.settingsList.updateValue(id, displayValue);
	}

	private close(): void {
		if (this.closed) return;
		this.closed = true;
		this.done?.();
	}
}
