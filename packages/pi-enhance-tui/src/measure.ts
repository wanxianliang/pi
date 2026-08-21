/**
 * Optimized text measurement and ANSI sequence handling.
 */

export interface TextMeasureEngine {
	visibleWidth?: (str: string) => number;
	sliceByColumn?: (line: string, startCol: number, length: number, strict?: boolean) => string;
	stripTerminalSequences?: (str: string) => string;
}

const ANSI_REGEX =
	/\x1b(?:\[[0-?]*[ -/]*[@-~]|\](?:1337;[^\x07\x1b]*|133;[^\x07\x1b]*|8;[^;]*;[^\x07\x1b]*)(?:\x07|\x1b\\)|_[A-Za-z0-9:;=_-]*(?:\x07|\x1b\\))/g;

function isPurePrintableAscii(str: string): boolean {
	for (let i = 0; i < str.length; i++) {
		const code = str.charCodeAt(i);
		if (code < 32 || code > 126) return false;
	}
	return true;
}

function isFastWideChar(code: number): boolean {
	return (
		(code >= 0x4e00 && code <= 0x9fff) ||
		(code >= 0x3400 && code <= 0x4dbf) ||
		(code >= 0x3000 && code <= 0x303f) ||
		(code >= 0x3040 && code <= 0x309f) ||
		(code >= 0x30a0 && code <= 0x30ff) ||
		(code >= 0xac00 && code <= 0xd7af) ||
		(code >= 0xff01 && code <= 0xff60) ||
		(code >= 0xffe0 && code <= 0xffe6)
	);
}

export class FastTextMeasureEngine implements TextMeasureEngine {
	private readonly cache = new Map<string, number>();
	private readonly maxCacheSize: number;

	constructor(maxCacheSize = 2048) {
		this.maxCacheSize = maxCacheSize;
	}

	stripTerminalSequences = (str: string): string => {
		if (!str.includes("\x1b")) return str;
		return str.replace(ANSI_REGEX, "");
	};

	visibleWidth = (str: string): number => {
		if (str.length === 0) return 0;
		if (isPurePrintableAscii(str)) return str.length;

		const cached = this.cache.get(str);
		if (cached !== undefined) return cached;

		const clean = this.stripTerminalSequences(str).replace(/\t/g, "   ");
		if (isPurePrintableAscii(clean)) {
			this.putCache(str, clean.length);
			return clean.length;
		}

		let width = 0;
		let hasComplexUnicode = false;

		for (let i = 0; i < clean.length; i++) {
			const code = clean.charCodeAt(i);
			if (code >= 32 && code <= 126) {
				width += 1;
			} else if (isFastWideChar(code)) {
				width += 2;
			} else {
				hasComplexUnicode = true;
				break;
			}
		}

		if (!hasComplexUnicode) {
			this.putCache(str, width);
			return width;
		}

		let segWidth = 0;
		const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
		for (const { segment } of segmenter.segment(clean)) {
			const cp = segment.codePointAt(0) ?? 0;
			if (cp >= 32 && cp <= 126) {
				segWidth += 1;
			} else if (isFastWideChar(cp) || segment.length > 1 || cp > 0x1f000) {
				segWidth += 2;
			} else {
				segWidth += 1;
			}
		}

		this.putCache(str, segWidth);
		return segWidth;
	};

	private putCache(key: string, width: number): void {
		if (this.cache.size >= this.maxCacheSize) {
			const oldestKey = this.cache.keys().next().value;
			if (oldestKey !== undefined) this.cache.delete(oldestKey);
		}
		this.cache.set(key, width);
	}

	clearCache(): void {
		this.cache.clear();
	}
}
