# Fork Modifications

This document records the modifications made to this fork of `pi` (<https://github.com/earendil-works/pi.git>) to enable `call_tools` (JavaScript code execution tool) to dynamically call all other extension-injected and MCP tools registered in the active agent session, resolving them seamlessly during execution.

## Modified Files

### 1. `packages/coding-agent/src/core/tools/call-tools.ts` (New File)

Implements `createCodeExecToolDefinition` which:

- Accepts a `getExtraTools` function to dynamically resolve active tools from the agent session.
- Merges these dynamic tools into `allTools` inside the `execute` call.
- Passes the runtime execution context (`ctx`) to the underlying tools' execution calls.

### 2. `packages/coding-agent/src/core/tools/index.ts`

- Added `getExtraTools` to `ToolsOptions` type definition.
- Updated `createAllToolDefinitions` to pass `options?.getExtraTools` to `createCodeExecToolDefinition`.
- Added `"call_tools"` to `ToolName` and `allToolNames`.

### 3. `packages/coding-agent/src/core/agent-session.ts`

- In `_buildRuntime`, injected the `getExtraTools` function into `createAllToolDefinitions`, returning all active tool definitions from `this._toolDefinitions` except `call_tools` itself.

### 4. `packages/coding-agent/src/core/sdk.ts`

- Appended `"call_tools"` to `defaultActiveToolNames` to make sure it is activated by default.

### 5. `packages/coding-agent/test/call-tools-extension.test.ts` (New Test)

- Added integration tests verifying that dynamically registered extension tools are correctly callable and executable via `call_tools`.

### 6. `/Users/sean/Documents/node-base/ai/pi-agent/rules/call_tools.md`

- Optimized the system prompt rules to direct the AI to always use `call_tools` for orchestration, trust its outputs, and keep invocations simple.
