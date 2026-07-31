# call_tools guide

[MUST] Call tools directly by function name (e.g. `readFile(...)`, `bash(...)`, `ffgrep(...)`) or via `pi.<toolName>(...)` from inside a single `call_tools` block. Do not execute tool commands outside `call_tools` — route all tool invocations inside a single `call_tools` block instead.

## Prime Directive: solve it in ONE call

Plan the whole task, then run it in a single `call_tools` block: gather inputs, do the work, verify the result, and return only the proof. Avoid multi-turn back-and-forth when the task is knowable upfront.

## call_tools Environment

- **Direct Tool Functions & `pi` Object**: All tools (builtin, extension, MCP) are injected as top-level functions (e.g. `readFile(...)`, `bash(...)`, `ffgrep(...)`) and also exposed on `pi` (e.g. `bash(...)`). You can call them directly without prefix (e.g. `await bash(...)`). Each call returns a Promise resolving directly to its raw text/result — no wrapper.
- **Pre-injected globals**: `pi`, `console`, `process`, `require`, `fs` (`node:fs`), `path` (`node:path`). Use `fs`/`path` directly, or `require()` any Node.js built-in (`os`, `crypto`, `child_process`, `zlib`, ...).
- **Trust the output**: verify inside the block and trust what `call_tools` returns. Build proof into the returned object (e.g. `{ ok, path, bytes, matched }`) instead of opening a second turn to re-check with `read`/`ls`/`git status`.

## Rules

1. [MUST] **Batch & parallelize**: run independent tool calls together with `Promise.all`; sequence only true data dependencies.
2. [MUST] **Verify before returning**: confirm the outcome (e.g. `fs.existsSync`, re-read, exit code，lsp_diagnostics) in the same block.
3. [MUST] **Minimal output**: `return`/`console.log` only essential evidence (paths, counts, pass/fail). Never dump whole files or long logs.
4. [MUST] **Handle failure**: wrap fallible calls in try/catch and return a short reason instead of letting the block throw.
5. [MUST] **file read** : use readFile read without hashline,use read to get file content with hashline
6. Write self-explanatory code without comments; if intent isn't obvious from naming, rename instead of commenting.
7. **Simple > clever**: use the smallest solution that solves the task; skip speculative abstractions.
8. Prefer **pi-registered tools** over raw shell equivalents (e.g. `ffgrep` over `grep`, `readFile` over `cat`).

## [MUST] Trust the result — do NOT re-verify

The `call_tools` return value is the single source of truth. Fold ALL verification into the block itself (existence checks, re-reads, exit codes, counts, diffs), then believe the result.

- Once a block returns success, treat the work as done. Skip a follow-up turn that re-checks with `read`, `ls`, `git status`, or a repeat `call_tools`.
- Confirm each outcome once. A verified block ends the task.
- Only run a follow-up call when the returned result itself shows failure or surfaces a genuinely new, unresolved question.

## Good vs Bad

Bad — calling tools directly across turns:
```javascript
// turn 1
await read({ path: "package.json" })
// turn 2
await pi.bash({ command: "git status -s" })
```

Good — one `call_tools` block, parallel calls, verification built in:
```javascript
const [pkg, status] = await Promise.all([
  readFile({ path: "package.json" }).catch(() => null),
  bash({ command: "git status -s" })
]);
return { ok: !!pkg, changed: status?.trim() ? status.trim().split("\n").length : 0 };
```

## Single tool call

Even one call goes inside `call_tools` and is returned directly:
```javascript
return await ffgrep({ pattern: "function_name" });
```

## Full example

```javascript
const os = require("os");
const out = path.join(os.tmpdir(), "task-status.txt");
const [pkg, status] = await Promise.all([
  read({ path: "package.json" }).catch((e) => null),
  bash({ command: "git status -s" })
]);

fs.writeFileSync(out, status || "");
const lines = status?.trim() ? status.trim().split("\n").length : 0;

return { ok: fs.existsSync(out) && !!pkg, out, changed: lines };
```
