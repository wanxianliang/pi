/**
 * Complete 4-sided modern rounded card box for tools, user messages, thinking, and assistant responses.
 * All border segments use unified, consistent ANSI color styling with zero color leaks and pixel-perfect right border alignment.
 */

import { sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";
import { BORDER_CHARS, PALETTE, STATUS_ICONS } from "./theme.ts";
import { stripLeadingToolName } from "./tool-args.ts";

export type CardBoxVariant = "tool" | "user" | "thinking" | "assistant";
export type CardBoxStatus = "pending" | "running" | "success" | "error" | "default";

export interface CardBoxOptions {
	toolName?: string;
	title?: string;
	variant?: CardBoxVariant;
	status?: CardBoxStatus;
	spinnerFrame?: string;
	contentLines: string[];
	width: number;
	maxHeightRunning?: number;
	maxHeightFinished?: number;
	isExpanded?: boolean;
	paddingX?: number;
	paddingY?: number;
	limitHeight?: boolean;
}

export function renderCardBox(options: CardBoxOptions): string[] {
	const {
		toolName,
		title = toolName ?? "Card",
		variant = "tool",
		status = "default",
		spinnerFrame = "⠋",
		contentLines,
		width,
		maxHeightRunning = 12,
		maxHeightFinished = 12,
		isExpanded = false,
		paddingX = 2,
		paddingY = 1,
		limitHeight = true,
	} = options;

	const boxWidth = Math.max(30, Math.min(width, 120));
	const innerWidth = boxWidth - 2;
	const contentWidth = Math.max(10, innerWidth - paddingX * 2);

	// 1. Determine title and badge styling
	const statusBadge = "";
	let cardTitleStyled: string;

	if (variant === "user") {
		cardTitleStyled = PALETTE.cyanBold(title === "Card" ? "User Prompt" : title);
	} else if (variant === "thinking") {
		if (status === "running" || status === "pending") {
			cardTitleStyled = `${PALETTE.purpleBold("Thinking")} ${PALETTE.badgeRunning(spinnerFrame)}`;
		} else {
			cardTitleStyled = PALETTE.purpleBold("Thinking");
		}
	} else if (variant === "assistant") {
		if (status === "running" || status === "pending") {
			cardTitleStyled = `${PALETTE.accentBold("Pi")} ${PALETTE.badgeRunning(spinnerFrame)}`;
		} else {
			cardTitleStyled = PALETTE.accentBold("Pi");
		}
	} else {
		// Tool variant
		if (status === "running") {
			cardTitleStyled = `${PALETTE.accentBold(title)} ${PALETTE.badgeRunning(spinnerFrame)}`;
		} else if (status === "pending") {
			cardTitleStyled = `${PALETTE.accentBold(title)} ${PALETTE.muted("…")}`;
		} else if (status === "error") {
			cardTitleStyled = `${PALETTE.accentBold(title)} ${PALETTE.errorBold(STATUS_ICONS.error)}`;
		} else {
			cardTitleStyled = `${PALETTE.accentBold(title)} ${PALETTE.successBold(STATUS_ICONS.success)}`;
		}
	}

	// 2. Build Top Header with exact measured prefix width
	const tlPart = PALETTE.border(`${BORDER_CHARS.tl}${BORDER_CHARS.h} `);
	let headerPrefix: string;
	if (statusBadge) {
		const midPart = PALETTE.border(` ${BORDER_CHARS.h}${BORDER_CHARS.h} `);
		headerPrefix = `${tlPart}${cardTitleStyled}${midPart}${statusBadge} `;
	} else {
		headerPrefix = `${tlPart}${cardTitleStyled} `;
	}
	const prefixW = visibleWidth(headerPrefix);
	const topFillLen = Math.max(0, boxWidth - prefixW - 1);
	const trFillPart = PALETTE.border(BORDER_CHARS.h.repeat(topFillLen) + BORDER_CHARS.tr);
	const topLine = `${headerPrefix}${trFillPart}`;

	// 3. Clean up content lines (strip redundant leading tool name from first line)
	const rawFlatLines: string[] = [];
	for (const raw of contentLines) {
		if (typeof raw === "string") {
			if (raw.includes("\n") || raw.includes("\r")) {
				rawFlatLines.push(...raw.split(/\r\n|\r|\n/));
			} else {
				rawFlatLines.push(raw);
			}
		}
	}

	const normalizedLines: string[] = [];
	if (rawFlatLines.length > 0) {
		const firstLine = toolName ? stripLeadingToolName(rawFlatLines[0], toolName) : rawFlatLines[0];
		if (firstLine.trim().length > 0) {
			normalizedLines.push(firstLine);
		}
		for (let i = 1; i < rawFlatLines.length; i++) {
			normalizedLines.push(rawFlatLines[i]);
		}
	}

	// 4. Window / filter content lines for execution
	let displayLines: string[];
	let hiddenCount = 0;

	if (limitHeight && (status === "running" || status === "pending")) {
		if (normalizedLines.length > maxHeightRunning) {
			displayLines = normalizedLines.slice(normalizedLines.length - maxHeightRunning);
		} else {
			displayLines = normalizedLines;
		}
	} else if (limitHeight && !isExpanded && normalizedLines.length > maxHeightFinished) {
		displayLines = normalizedLines.slice(0, maxHeightFinished);
		hiddenCount = normalizedLines.length - maxHeightFinished;
	} else {
		displayLines = normalizedLines;
	}

	const resultLines: string[] = [topLine];
	const padLeft = " ".repeat(paddingX);
	const padRight = " ".repeat(paddingX);
	const leftV = PALETTE.border(BORDER_CHARS.v);
	const rightV = PALETTE.border(BORDER_CHARS.v);
	const emptyRow = `${leftV}${" ".repeat(innerWidth)}${rightV}`;

	if (displayLines.length > 0) {
		for (let i = 0; i < paddingY; i++) {
			resultLines.push(emptyRow);
		}
	}

	// 5. Render content lines inside unified 4-sided border
	for (const rawLine of displayLines) {
		const vWidth = visibleWidth(rawLine);
		let fitted: string;

		if (vWidth > contentWidth) {
			fitted = sliceByColumn(rawLine, 0, contentWidth, true);
			const actualW = visibleWidth(fitted);
			if (actualW < contentWidth) {
				fitted += " ".repeat(contentWidth - actualW);
			}
		} else {
			fitted = rawLine + " ".repeat(contentWidth - vWidth);
		}

		const row = `${leftV}${padLeft}${fitted}${padRight}${rightV}`;
		resultLines.push(row);
	}

	if (hiddenCount > 0) {
		const hintText = PALETTE.muted(`... (${hiddenCount} more lines, Ctrl+O to expand)`);
		const vW = visibleWidth(hintText);
		const fitted =
			vW > contentWidth ? sliceByColumn(hintText, 0, contentWidth, true) : hintText + " ".repeat(contentWidth - vW);
		const row = `${leftV}${padLeft}${fitted}${padRight}${rightV}`;
		resultLines.push(row);
	}

	if (displayLines.length > 0) {
		for (let i = 0; i < paddingY; i++) {
			resultLines.push(emptyRow);
		}
	}

	// 6. Bottom Line: ╰────────────────────────────╯
	const bottomLine = PALETTE.border(`${BORDER_CHARS.bl}${BORDER_CHARS.h.repeat(innerWidth)}${BORDER_CHARS.br}`);
	resultLines.push(bottomLine);

	return resultLines;
}
