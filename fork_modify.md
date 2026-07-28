# Fork Modifications

This document records the modifications made to this fork of `pi` (<https://github.com/earendil-works/pi.git>) to enable `code_exec` (JavaScript code execution tool) to dynamically call all other extension-injected and MCP tools registered in the active agent session, resolving them seamlessly during execution.

## Modified Files

### 1. `packages/coding-agent/src/core/tools/code-exec.ts` (New File)

Implements `createCodeExecToolDefinition` which:

- Accepts a `getExtraTools` function to dynamically resolve active tools from the agent session.
- Merges these dynamic tools into `allTools` inside the `execute` call.
- Passes the runtime execution context (`ctx`) to the underlying tools' execution calls.

### 2. `packages/coding-agent/src/core/tools/index.ts`

- Added `getExtraTools` to `ToolsOptions` type definition.
- Updated `createAllToolDefinitions` to pass `options?.getExtraTools` to `createCodeExecToolDefinition`.
- Added `"code_exec"` to `ToolName` and `allToolNames`.

### 3. `packages/coding-agent/src/core/agent-session.ts`

- In `_buildRuntime`, injected the `getExtraTools` function into `createAllToolDefinitions`, returning all active tool definitions from `this._toolDefinitions` except `code_exec` itself.

### 4. `packages/coding-agent/src/core/sdk.ts`

- Appended `"code_exec"` to `defaultActiveToolNames` to make sure it is activated by default.

### 5. `packages/coding-agent/test/code-exec-extension.test.ts` (New Test)

- Added integration tests verifying that dynamically registered extension tools are correctly callable and executable via `code_exec`.

### 6. `/Users/sean/Documents/node-base/ai/pi-agent/rules/code_exec.md`

- Optimized the system prompt rules to direct the AI to always use `code_exec` for orchestration, trust its outputs, and keep invocations simple.
