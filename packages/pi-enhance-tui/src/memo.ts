/**
 * Component memoization wrapper to avoid recalculating unchanged subtrees.
 */

import type { Component } from "@earendil-works/pi-tui";

export interface MemoOptions {
	getCacheKey?: () => string | number;
}

export class MemoComponent<T extends Component = Component> implements Component {
	readonly inner: T;
	private lastWidth = -1;
	private lastKey: string | number | undefined;
	private cachedLines: string[] = [];
	private isDirty = true;
	private getCacheKey?: () => string | number;

	constructor(inner: T, options?: MemoOptions) {
		this.inner = inner;
		this.getCacheKey = options?.getCacheKey;
	}

	markDirty(): void {
		this.isDirty = true;
	}

	render(width: number): string[] {
		const currentKey = this.getCacheKey ? this.getCacheKey() : undefined;
		if (!this.isDirty && this.lastWidth === width && (currentKey === undefined || currentKey === this.lastKey)) {
			return this.cachedLines;
		}

		this.cachedLines = this.inner.render(width);
		this.lastWidth = width;
		this.lastKey = currentKey;
		this.isDirty = false;
		return this.cachedLines;
	}

	handleInput(data: string): void {
		if (this.inner.handleInput) {
			this.inner.handleInput(data);
			this.isDirty = true;
		}
	}

	get wantsKeyRelease(): boolean | undefined {
		return this.inner.wantsKeyRelease;
	}

	invalidate(): void {
		this.isDirty = true;
		this.inner.invalidate();
	}
}

export function createMemoComponent<T extends Component>(component: T, options?: MemoOptions): MemoComponent<T> {
	return new MemoComponent(component, options);
}
