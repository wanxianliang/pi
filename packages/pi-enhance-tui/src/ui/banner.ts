/**
 * Minimalist startup hero — centered gradient π logo with model info.
 * No tables, no resource lists; extreme visual simplicity.
 */

import { visibleWidth } from "@earendil-works/pi-tui";
import { PALETTE } from "./theme.ts";

export interface StartupDashboardOptions {
	version: string;
	modelName?: string;
	provider?: string;
	/** unused — kept for call-site compat */
	skills?: string[];
	prompts?: string[];
	extensions?: string[];
	themes?: string[];
	width: number;
	compactInstructions?: string;
}

export function renderStartupDashboard(options: StartupDashboardOptions): string[] {
	const { version, modelName = "Pi Agent", provider, width } = options;

	const targetWidth = Math.max(20, width);

	const centerLine = (raw: string): string => {
		const w = visibleWidth(raw);
		if (w >= targetWidth) return raw;
		const pad = Math.floor((targetWidth - w) / 2);
		return " ".repeat(pad) + raw;
	};

	// Five-row gradient π — purple → indigo → sky → teal
	const piRows = [
		"\x1b[38;2;199;146;234m   ▀██████████▀   \x1b[0m",
		"\x1b[38;2;165;165;250m   ╘██      ██    \x1b[0m",
		"\x1b[38;2;140;185;255m    ██      ██    \x1b[0m",
		"\x1b[38;2;125;207;255m    ██      ██    \x1b[0m",
		"\x1b[38;2;115;218;202m   ▄██▄    ▄██▄   \x1b[0m",
	];

	const modelLine = modelName ? centerLine(PALETTE.accentBold(modelName)) : null;
	const providerLine = provider ? centerLine(PALETTE.muted(provider)) : null;
	const versionLine = centerLine(PALETTE.muted(`v${version}`));

	return [
		"",
		...piRows.map(centerLine),
		"",
		...(modelLine ? [modelLine] : []),
		...(providerLine ? [providerLine] : []),
		"",
		versionLine,
		"",
	];
}

export interface StartupHeroExpandable {
	render(width: number): string[];
	setExpanded(expanded: boolean): void;
	invalidate(): void;
}

export function createStartupHero(
	getModel: () => { name?: string; id: string; provider: string } | undefined,
	version: string,
): StartupHeroExpandable {
	return {
		render: (width: number): string[] => {
			const m = getModel();
			return renderStartupDashboard({ version, modelName: m?.name || m?.id, provider: m?.provider, width });
		},
		setExpanded: (_expanded: boolean): void => {},
		invalidate: (): void => {},
	};
}
