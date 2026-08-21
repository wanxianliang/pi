/**
 * Lightweight, high-performance syntax highlighter for terminal outputs.
 */

export interface HighlightStyles {
	keyword?: (s: string) => string;
	string?: (s: string) => string;
	number?: (s: string) => string;
	comment?: (s: string) => string;
	operator?: (s: string) => string;
	function?: (s: string) => string;
	diffAdd?: (s: string) => string;
	diffRemove?: (s: string) => string;
	diffMeta?: (s: string) => string;
}

const DEFAULT_STYLES: HighlightStyles = {
	keyword: (s) => `\x1b[35m${s}\x1b[0m`,
	string: (s) => `\x1b[32m${s}\x1b[0m`,
	number: (s) => `\x1b[33m${s}\x1b[0m`,
	comment: (s) => `\x1b[90m${s}\x1b[0m`,
	operator: (s) => `\x1b[36m${s}\x1b[0m`,
	function: (s) => `\x1b[34m${s}\x1b[0m`,
	diffAdd: (s) => `\x1b[32m${s}\x1b[0m`,
	diffRemove: (s) => `\x1b[31m${s}\x1b[0m`,
	diffMeta: (s) => `\x1b[36m${s}\x1b[0m`,
};

const TS_JS_KEYWORDS =
	/\b(const|let|var|function|class|interface|type|enum|extends|implements|import|export|from|default|return|if|else|switch|case|break|continue|for|while|do|try|catch|finally|throw|new|typeof|instanceof|async|await|yield|this|super|null|undefined|true|false|void|as|readonly|static|public|private|protected)\b/g;

const PY_KEYWORDS =
	/\b(def|class|import|from|return|if|elif|else|for|while|try|except|finally|raise|with|as|pass|break|continue|lambda|yield|async|await|None|True|False|and|or|not|is|in|global|nonlocal)\b/g;

const RUST_GO_KEYWORDS =
	/\b(fn|pub|struct|enum|impl|trait|use|mod|let|mut|match|if|else|for|while|loop|return|break|continue|async|await|package|func|type|var|const|select|chan|defer|go)\b/g;

const STRING_PATTERN = /(["'`])(?:\\.|(?!\1)[^\\\r\n])*\1/g;

function highlightDiff(lines: string[], styles: HighlightStyles): string[] {
	return lines.map((line) => {
		if (line.startsWith("+") && !line.startsWith("+++")) {
			return (styles.diffAdd ?? DEFAULT_STYLES.diffAdd!)(line);
		}
		if (line.startsWith("-") && !line.startsWith("---")) {
			return (styles.diffRemove ?? DEFAULT_STYLES.diffRemove!)(line);
		}
		if (line.startsWith("@@") || line.startsWith("diff ") || line.startsWith("index ")) {
			return (styles.diffMeta ?? DEFAULT_STYLES.diffMeta!)(line);
		}
		return line;
	});
}

function highlightJson(lines: string[], styles: HighlightStyles): string[] {
	const strFmt = styles.string ?? DEFAULT_STYLES.string!;
	const numFmt = styles.number ?? DEFAULT_STYLES.number!;
	const kwFmt = styles.keyword ?? DEFAULT_STYLES.keyword!;

	return lines.map((line) => {
		let processed = line.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"\s*:/g, (_, key) => `"${kwFmt(key)}":`);
		processed = processed.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (match) => {
			if (match.includes("\x1b[")) return match;
			return strFmt(match);
		});
		processed = processed.replace(/\b(-?\d+(\.\d+)?([eE][+-]?\d+)?)\b/g, (match) => numFmt(match));
		processed = processed.replace(/\b(true|false|null)\b/g, (match) => kwFmt(match));
		return processed;
	});
}

export function highlightCode(code: string, lang?: string, customStyles?: HighlightStyles): string[] {
	const styles = { ...DEFAULT_STYLES, ...customStyles };
	const lines = code.split("\n");
	const normalizedLang = lang?.toLowerCase().trim();

	if (!normalizedLang) return lines;

	if (normalizedLang === "diff" || normalizedLang === "patch") {
		return highlightDiff(lines, styles);
	}

	if (normalizedLang === "json" || normalizedLang === "jsonc") {
		return highlightJson(lines, styles);
	}

	let keywordRegex = TS_JS_KEYWORDS;
	let isPython = false;

	if (normalizedLang === "python" || normalizedLang === "py") {
		keywordRegex = PY_KEYWORDS;
		isPython = true;
	} else if (
		normalizedLang === "rust" ||
		normalizedLang === "rs" ||
		normalizedLang === "go" ||
		normalizedLang === "c" ||
		normalizedLang === "cpp"
	) {
		keywordRegex = RUST_GO_KEYWORDS;
	}

	const kwFmt = styles.keyword ?? DEFAULT_STYLES.keyword!;
	const strFmt = styles.string ?? DEFAULT_STYLES.string!;
	const numFmt = styles.number ?? DEFAULT_STYLES.number!;
	const commentFmt = styles.comment ?? DEFAULT_STYLES.comment!;
	const fnFmt = styles.function ?? DEFAULT_STYLES.function!;

	return lines.map((line) => {
		const commentPrefix = isPython ? "#" : "//";
		const commentIdx = line.indexOf(commentPrefix);

		let codePart = line;
		let commentPart = "";

		if (commentIdx !== -1) {
			codePart = line.slice(0, commentIdx);
			commentPart = commentFmt(line.slice(commentIdx));
		}

		// 1. Strings masking
		const stringTokens: string[] = [];
		let processed = codePart.replace(STRING_PATTERN, (match) => {
			const idx = stringTokens.length;
			stringTokens.push(strFmt(match));
			return `___STR_${idx}___`;
		});

		// 2. Keywords
		processed = processed.replace(keywordRegex, (match) => kwFmt(match));

		// 3. Functions (ident followed by '(')
		processed = processed.replace(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?=\()/g, (match, fnName) => {
			return match.replace(fnName, fnFmt(fnName));
		});

		// 4. Numbers
		processed = processed.replace(/\b(0x[0-9a-fA-F]+|\d+(\.\d+)?)\b/g, (match) => numFmt(match));

		// 5. Restore strings
		processed = processed.replace(/___STR_(\d+)___/g, (_, idx) => stringTokens[Number(idx)] ?? "");

		return processed + commentPart;
	});
}
