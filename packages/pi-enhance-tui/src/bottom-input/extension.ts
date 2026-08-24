import { createBottomInputRuntime } from "./runtime.ts";
import { PiUiCustomSettingsComponent, readPersistedSettings, writePersistedSettings } from "./settings.ts";
import { registerBottomInputShortcuts } from "./shortcuts.ts";
import type { BottomInputRuntime, FixedBottomEditorStatus, PiUiCustomSettings, ThemeLike } from "./types.ts";

export function getRuntimeTheme(): ThemeLike {
	const key = Symbol.for("@earendil-works/pi-coding-agent:theme");
	const fallbackKey = Symbol.for("@mariozechner/pi-coding-agent:theme");
	const candidate = (globalThis as any)[key] ?? (globalThis as any)[fallbackKey];
	if (candidate?.fg && candidate?.bg) return candidate as ThemeLike;
	return {
		fg: (_token: string, text: string) => text,
		bg: (_token: string, text: string) => text,
		bold: (text: string) => text,
	};
}

export function registerPiUiCustomCommand(
	pi: any,
	ops: {
		setFixedBottomEditorEnabled?: (enabled: boolean, ctx: any) => FixedBottomEditorStatus | undefined;
		setBeautifiedInputEnabled?: (enabled: boolean, ctx: any) => FixedBottomEditorStatus | undefined;
		onSettingsChanged?: (settings: PiUiCustomSettings, ctx: any) => void;
	} = {},
): void {
	pi.registerCommand("pi-ui-custom", {
		description: "打开 Pi UI Custom 底部输入框设置",
		handler: async (_args: string, ctx: any) => {
			const ui = ctx?.ui;
			if (!ui?.custom) {
				ui?.notify?.("Settings require interactive UI.", "warning");
				return;
			}
			const fallbackTheme = ui.theme ?? getRuntimeTheme();
			await ui.custom(
				(tui: any, theme: any, _keybindings: any, done: () => void) => {
					return new PiUiCustomSettingsComponent(theme ?? fallbackTheme, done, {
						getSettings: readPersistedSettings,
						setFixedBottomEditorEnabled: (enabled) => {
							const res = ops.setFixedBottomEditorEnabled?.(enabled, ctx);
							tui?.requestRender?.();
							return res;
						},
						setBeautifiedInputEnabled: (enabled) => {
							const res = ops.setBeautifiedInputEnabled?.(enabled, ctx);
							tui?.requestRender?.();
							return res;
						},
						onSettingsChanged: (settings) => {
							ops.onSettingsChanged?.(settings, ctx);
							tui?.requestRender?.();
						},
					});
				},
				{
					overlay: true,
					overlayOptions: { anchor: "center", width: "90%", minWidth: 56, maxHeight: "80%", margin: 1 },
				},
			);
		},
	});
}

const defaultBottomInputRuntime = createBottomInputRuntime();

export function registerPiUiCustomExtension(pi: any, deps: { bottomInputRuntime?: BottomInputRuntime } = {}): void {
	const bottomInputRuntime = deps.bottomInputRuntime ?? defaultBottomInputRuntime;

	const persistedSettings = readPersistedSettings();
	bottomInputRuntime.setBeautifiedInputEnabled?.(persistedSettings.beautifiedInput.enabled);

	registerPiUiCustomCommand(pi, {
		setFixedBottomEditorEnabled: (enabled, ctx) => {
			const settings = readPersistedSettings();
			settings.fixedBottomEditor.enabled = enabled;
			bottomInputRuntime.bindSession(ctx);
			const status = bottomInputRuntime.configure
				? bottomInputRuntime.configure({
						fixedEnabled: enabled,
						beautifiedInputEnabled: settings.beautifiedInput.enabled,
					})
				: bottomInputRuntime.setEnabled(enabled);
			if (!bottomInputRuntime.configure) {
				bottomInputRuntime.setBeautifiedInputEnabled?.(settings.beautifiedInput.enabled);
			}
			writePersistedSettings(settings);
			return status;
		},
		setBeautifiedInputEnabled: (enabled, ctx) => {
			const settings = readPersistedSettings();
			settings.beautifiedInput.enabled = enabled;
			bottomInputRuntime.bindSession(ctx);
			const status = bottomInputRuntime.configure?.({
				fixedEnabled: settings.fixedBottomEditor.enabled,
				beautifiedInputEnabled: enabled,
			});
			if (!bottomInputRuntime.configure) {
				bottomInputRuntime.setBeautifiedInputEnabled?.(enabled);
			}
			writePersistedSettings(settings);
			return status;
		},
		onSettingsChanged: (settings) => {
			writePersistedSettings(settings);
		},
	});
	registerBottomInputShortcuts(pi, bottomInputRuntime);

	pi.on("session_start", (_event: any, ctx: any) => {
		bottomInputRuntime.bindSession(ctx);
		bottomInputRuntime.resetSessionStartTime();
		bottomInputRuntime.setLastPrompt("");
		const settings = readPersistedSettings();
		const _status = bottomInputRuntime.configure
			? bottomInputRuntime.configure({
					fixedEnabled: settings.fixedBottomEditor.enabled,
					beautifiedInputEnabled: settings.beautifiedInput.enabled,
				})
			: bottomInputRuntime.setEnabled(settings.fixedBottomEditor.enabled);
		if (!bottomInputRuntime.configure) {
			bottomInputRuntime.setBeautifiedInputEnabled?.(settings.beautifiedInput.enabled);
		}
	});

	pi.on("model_select", (_event: any, ctx: any) => {
		bottomInputRuntime.bindSession(ctx);
		bottomInputRuntime.requestRender();
	});

	pi.on("thinking_level_select", (event: any, ctx: any) => {
		bottomInputRuntime.bindSession(ctx);
		bottomInputRuntime.setThinkingLevel(event?.level);
	});

	pi.on("before_agent_start", (event: any, ctx: any) => {
		bottomInputRuntime.bindSession(ctx);
		bottomInputRuntime.setLastPrompt(event?.prompt);
	});

	pi.on("agent_start", (_event: any, ctx: any) => {
		bottomInputRuntime.bindSession(ctx);
		bottomInputRuntime.setStreaming?.(true);
	});

	pi.on("message_update", (event: any, ctx: any) => {
		bottomInputRuntime.bindSession(ctx);
		const usage = event?.message?.usage ?? event?.usage ?? event?.assistantMessageEvent?.partial?.usage;
		if (usage) {
			bottomInputRuntime.setLiveUsage(usage);
		}
	});

	pi.on("message_end", (event: any, ctx: any) => {
		bottomInputRuntime.bindSession(ctx);
		const usage = event?.message?.usage ?? event?.usage;
		if (usage) {
			bottomInputRuntime.setLiveUsage(usage);
		}
		bottomInputRuntime.clearLiveUsage();
	});

	pi.on("turn_end", (event: any, ctx: any) => {
		bottomInputRuntime.bindSession(ctx);
		const usage = event?.message?.usage ?? event?.usage ?? event?.turn?.message?.usage;
		if (usage) {
			bottomInputRuntime.setLiveUsage(usage);
		}
		bottomInputRuntime.clearLiveUsage();
	});

	pi.on("session_shutdown", (_event: any, _ctx: any) => {
		bottomInputRuntime.dispose();
	});
}

export default function piUiCustom(pi: any) {
	registerPiUiCustomExtension(pi);
}
