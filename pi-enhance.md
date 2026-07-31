# Pi Agent 增强扩展与源码修改说明 (vs 官方 upstream/main)

本文档整理了当前版本与官方最新版本 (`upstream/main`) 相比的源码修改点与新增功能文件说明。

---

## 一、修改的文件及具体修改点

### 1. `packages/coding-agent/src/core/extensions/types.ts`
- **`ExtensionContext` 接口**：新增 `getAllToolDefinitions?(): Record<string, ToolDefinition>` 与 `emitAgentEvent?(event: AgentEvent): void`，允许 Extension 获取 Session 内所有可执行工具并触发 Tool 生命周期事件。
- **`ExtensionContextActions` 接口**：同步补充 `getAllToolDefinitions` 与 `emitAgentEvent` 的 Action 签名。
- **`ContextEvent` / `ContextEventResult` 接口**：扩展 `tools?: any[]` 与 `systemPrompt?: string` 属性，支持 Extension 在 `context` 事件中动态注入/过滤 Tools 和修改系统提示词。

### 2. `packages/coding-agent/src/core/extensions/runner.ts`
- **扩展点绑定**：在 `ExtensionRunner.bindCore` 中绑定 `getAllToolDefinitionsFn` 和 `emitAgentEventFn`，并在 `createContext()` 中向 Extension 暴露。
- **上下文增强逻辑**：实现 `emitContextEnhancements` 与 `emitTools` 方法，用于在 LLM 请求发送前触发 `context` 事件拦截器，动态重构系统提示词与可调用的 Tool 列表。

### 3. `packages/coding-agent/src/core/extensions/index.ts`
- 导出 `pi-extension-enhance.ts` 模块中的 `EnhancedContextResult` 类型与 `filterContextWithExtensions` 函数。

### 4. `packages/coding-agent/src/core/agent-session.ts`
- **扩展点注册**：在 `runner.bindCore` 的 `contextActions` 中增加 `getAllToolDefinitions`（汇总基础工具与 Extension 动态工具）和 `emitAgentEvent`（转发至 `_handleAgentEvent`）。
- **事件派发**：在创建基础 Tool 定义时传入 `emitEvent` 闭包，确保底层工具执行事件能够正常派发。

### 5. `packages/coding-agent/src/core/sdk.ts`
- **LLM Context 动态拦截**：在 `createAgentSession` 的 `modelRuntime.streamSimple` 调用前，增加 `headerRunner.emitContextEnhancements` 处理，在最终向模型发起请求前完成 `systemPrompt` 与 `tools` 的动态增强与过滤。

### 6. `packages/coding-agent/src/core/tools/index.ts`
- 在 `ToolsOptions` 中新增可选的 `emitEvent` 闭包参数，支持将基础工具的执行事件向上派发。

### 7. `packages/coding-agent/test/extensions-runner.test.ts`
- 补充扩展拦截器测试用例，验证 Extension 能否通过 `context` 事件过滤工具列表（如 `toolsFilter`）及追加/重写 `systemPrompt`。

### 8. `package-lock.json`
- 锁定并更新多包 Monorepo 依赖树元数据。

### 9. `.gitignore`
- 忽略本地排错/计划归档目录 `plan/archive/`。

---

## 二、新增的文件及功能说明

### 1. `packages/coding-agent/src/core/extensions/pi-extension-enhance.ts`
- **功能说明**：实现 Extension 上下文增强器，遍历所有已加载 Extension 的 `context` 事件监听器，按链式管道动态过滤/重构传递给 LLM 的 `tools` 列表及 `systemPrompt`。

### 2. `replace.sh`
- **功能说明**：用于辅助源码批量替换与修改处理的 Shell 自动化脚本。

### 3. `update_code_from_pi.sh`
- **功能说明**：用于自动拉取与同步官方上游 upstream/main 最新代码的脚本。

### 4. `pi-agent-suite/call-tools.ts`
- **功能说明**：用户侧独立的 `call_tools` Extension 实现，利用 `ctx.getAllToolDefinitions()` 动态暴露 Session 中的所有工具接口，提供 JS 代码执行、`rtk` 前缀支持、输出自动截断及 TUI 运行视图渲染。
