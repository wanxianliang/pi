/**
 * Smooth animation spinner helper.
 */

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface SpinnerContext {
	state: Record<string, unknown>;
	isPartial?: boolean;
	executionStarted?: boolean;
	invalidate?: () => void;
}

export function updateSpinner(context: SpinnerContext, intervalMs = 80): { frameChar: string; isRunning: boolean } {
	const state = context.state;
	const isRunning = Boolean(context.isPartial);

	if (isRunning) {
		if (context.executionStarted) {
			if (!state.spinnerInterval && typeof context.invalidate === "function") {
				state.spinnerFrame = 0;
				state.spinnerInterval = setInterval(() => {
					const frame = typeof state.spinnerFrame === "number" ? state.spinnerFrame : 0;
					state.spinnerFrame = (frame + 1) % SPINNER_FRAMES.length;
					context.invalidate!();
				}, intervalMs);
			}
			const frameIdx = typeof state.spinnerFrame === "number" ? state.spinnerFrame : 0;
			return { frameChar: SPINNER_FRAMES[frameIdx] ?? "⠋", isRunning: true };
		}
		return { frameChar: "·", isRunning: true };
	}

	if (state.spinnerInterval) {
		clearInterval(state.spinnerInterval as ReturnType<typeof setInterval>);
		state.spinnerInterval = undefined;
	}

	return { frameChar: "", isRunning: false };
}
