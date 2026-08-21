# @earendil-works/pi-enhance-tui

High-performance enhancements and Bun runtime optimizations for `@earendil-works/pi-tui`.

## Features

- **Bun.stdout.writer() Integration**: Zero-overhead batched stream writes for Bun runtime.
- **FastTextMeasureEngine**: Fast-path ASCII and direct CJK width calculation with LRU caching, avoiding heavy `Intl.Segmenter` allocations on critical rendering paths.
- **Component Memoization**: Subtree dirty-checking via `createMemoComponent`.
- **Zero-Friction Hooking**: Clean, minimal adapter interface into `@earendil-works/pi-tui`.

## Usage

```ts
const { initPiEnhanceTui } = require('@earendil-works/pi-enhance-tui');

// Initialize and hook into pi-tui
const enhance = initPiEnhanceTui({
  enableBunWriter: true,
  enableFastMeasure: true,
});
```
