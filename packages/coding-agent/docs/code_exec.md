# `code_exec` Tool Usage Guide

`code_exec` is a powerful coordination tool that executes a JavaScript block inside the Pi agent runtime. It is designed to orchestrate other basic tools (`pi.read`, `pi.write`, `pi.bash`, etc.) in a single turn to maximize execution efficiency, bypass sequential turn overhead, and handle complex conditional logic.

---

## Key Features

1. **Direct Value Returns**: All wrapped agent tools (like `await pi.read()` or `await pi.bash()`) automatically resolve directly to their **plain text string contents** instead of structured result wrappers.
2. **Top-Level `await`**: Fully supported inside the execution block.
3. **Implicit Require & Process**: Standard Node.js modules can be imported via `require('...')`, and the global `process` object is available.
4. **Console Log Interception**: `console.log`, `console.info`, `console.warn`, and `console.error` outputs are captured and returned in an isolated section.

---

## Best Practices

* **Parallel Execution**: Use `Promise.all` to batch read/write operations to run them concurrently.
* **Stability**: Check variables for null/undefined values before executing string operations (like `.includes()`).
* **Clean Returns**: Avoid boilerplate output wrapping. If your script yields a value, simply `return` it at the end of the block.

---

## Code Example

```javascript
// 1. Read two files in parallel
const [f1, f2] = await Promise.all([
  pi.read({ path: 'a.md' }),
  pi.read({ path: 'b.md' })
]);

// 2. Check for nullish values and whether they contain 'hello'
const hasHello1 = f1 && f1.includes('hello');
const hasHello2 = f2 && f2.includes('hello');

if (hasHello1 || hasHello2) {
  // 3. Run a bash command and write the outcome
  const status = await pi.bash({ command: 'git status -s' });
  await pi.write({ path: 'out.txt', content: status });
  return 'wrote status';
} else {
  await pi.write({ path: 'out.txt', content: 'hello not found' });
  return 'wrote fallback';
}
```

---

## Response Format Sent to LLM

The output returned to the LLM is optimized to be as compact as possible:

* **Only Console Logs (Return is undefined)**:

  ```text
  log line 1
  log line 2
  ```

* **Only Return Value (No logs)**:

  ```text
  "Return value string or JSON object"
  ```

* **Both Logs and Return Value**:

  ```text
  [stdout]
  log line 1
  log line 2

  [return]
  "Return value"
  ```
