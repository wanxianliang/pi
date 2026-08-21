export type ThemeLike = {
	fg(token: string, text: string): string;
	bg(token: string, text: string): string;
	bold?(text: string): string;
};

export type FixedBottomEditorStatus = {
	enabled: boolean;
	installed: boolean;
	failure?: string;
};

export type TerminalSanitizeOptions = {
	allowNewline?: boolean;
	allowTab?: boolean;
	preserveSgr?: boolean;
};

export type BottomInputIconSet = {
	model: string;
	time: string;
};

export type AssistantUsage = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens?: number;
};

export type ContextUsage = {
	tokens: number;
	contextWindow?: number;
	percent?: number;
};

export type BottomInputShortcutKey =
	| "stashEditor"
	| "copyEditor"
	| "cutEditor"
	| "scrollChatUp"
	| "scrollChatDown"
	| "editorStart"
	| "editorEnd"
	| "jumpPreviousUserMessage"
	| "jumpNextUserMessage"
	| "jumpPreviousAssistantMessage"
	| "jumpNextAssistantMessage"
	| "jumpChatBottom";

export type BottomInputShortcuts = Record<BottomInputShortcutKey, string>;

export type ShortcutValidationResult = { ok: true; shortcut: string } | { ok: false; reason: string };

export type FixedEditorClusterInput = {
	statusLines?: readonly string[];
	topLines?: readonly string[];
	editorLines?: readonly string[];
	secondaryLines?: readonly string[];
	lastPromptLines?: readonly string[];
	width: number;
	maxHeight: number;
};

export type FixedEditorCursor = {
	row: number;
	col: number;
};

export type FixedEditorCluster = {
	lines: string[];
	cursor?: FixedEditorCursor;
};

export type BottomInputFrameStatus = {
	model: string | null;
	thinking: string | null;
	context: string | null;
	elapsed: string | null;
};

export type BeautifiedEditorFrameInput = {
	editorLines: readonly string[];
	width: number;
	theme: ThemeLike;
	status: BottomInputFrameStatus;
};

export type BottomInputEditorState = {
	beautifiedInputEnabled: boolean;
	getTheme(): ThemeLike;
	getFrameStatus(width: number): BottomInputFrameStatus;
};

export type BottomInputStatusState = {
	ctx: any;
	footerData?: any;
	theme: ThemeLike;
	width: number;
	beautifiedInputEnabled: boolean;
	isStreaming: boolean;
	liveUsage: AssistantUsage | null;
	latestAssistantUsage: AssistantUsage | null;
	currentThinkingLevel: string | null;
	sessionStartTime: number;
	now: number;
	lastPrompt: string;
	icons?: BottomInputIconSet;
};

export type BottomInputStatusRender = {
	topLines: string[];
	secondaryLines: string[];
	lastPromptLines: string[];
	frameStatus: BottomInputFrameStatus;
	cacheKey: string;
};

export type FixedBottomEditorSettings = {
	enabled: boolean;
};

export type BeautifiedInputSettings = {
	enabled: boolean;
};

export type PiUiCustomSettings = {
	fixedBottomEditor: FixedBottomEditorSettings;
	beautifiedInput: BeautifiedInputSettings;
};

export type BottomInputRuntime = {
	bindSession(ctx: any): void;
	setEnabled(enabled: boolean): FixedBottomEditorStatus;
	configure?(settings: { fixedEnabled?: boolean; beautifiedInputEnabled?: boolean }): FixedBottomEditorStatus;
	dispose(): void;
	getStatus(): FixedBottomEditorStatus;
	setBeautifiedInputEnabled?(enabled: boolean): void;
	resetSessionStartTime(): void;
	setLastPrompt(prompt: unknown): void;
	setThinkingLevel(level: unknown): void;
	setStreaming?(streaming: boolean): void;
	setLiveUsage(usage: unknown): void;
	clearLiveUsage(): void;
	requestRender(options?: { full?: boolean }): void;
	stashOrRestoreEditorText(ctx?: any): void;
	copyEditorText?(ctx?: any): void;
	cutEditorText?(ctx?: any): void;
	setShortcuts?(shortcuts: Partial<BottomInputShortcuts> | undefined): void;
};
