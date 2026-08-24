# Pi Agent 增强扩展与源码修改说明 (vs 官方 upstream/main)

本文档整理了当前版本与官方最新版本 (`upstream/main`) 相比的源码修改点与新增功能文件说明。
所有修改遵循**极简侵入原则**（能不改源码就不改，必须改的以极简 1~2 行单点委托方式完成，逻辑内聚在独立模块中），以最大程度保证后续合并上游代码时零冲突。

---

## 一、官方公共文件修改清单（极简单行侵入）

| 文件 | 修改行数 | 具体修改说明 |
|------|----------|--------------|
| `packages/coding-agent/src/core/sdk.ts` | **+1 行** | 在 `modelRuntime.streamSimple` 调用前单行调用 `applyContextEnhancements(headerRunner, context)` |
| `packages/coding-agent/src/modes/interactive/interactive-mode.ts` | **+2 行** | 仅在 `createInteractiveTui` 入口调用 `initPiEnhanceTui({ ... })` 动态挂载原型，并在复制时单行包裹 `stripCardBorders` |
| `packages/coding-agent/src/core/agent-session.ts` | **+3 行** | 仅在 `runner.bindCore` 的 `contextActions` 中注册 `getAllToolDefinitions` 与 `emitAgentEvent`，并在 `isToolAllowed` 中追加 `isToolEnabledInConfig` |
| `packages/coding-agent/src/core/resource-loader.ts` | **+2 行** | `getExtensions()` 与 `getSkills()` 返回前分别经过 `filterEnabledExtensions` 与 `filterEnabledSkills` 过滤 |
| `packages/coding-agent/src/core/extensions/index.ts` | **+1 行** | 导出 `EnhancedContextResult` 与 `filterContextWithExtensions` |
| `packages/coding-agent/src/core/extensions/runner.ts` | **+8 行** | `createContext` 暴露 `getAllToolDefinitions`、`emitAgentEvent`、`executeTool`，以及 `emitContextEnhancements` 拦截触发器 |
| `packages/coding-agent/src/core/extensions/types.ts` | **+12 行** | 声明 `getAllToolDefinitions`、`emitAgentEvent`、`executeTool` 接口与 `ContextEvent.tools/systemPrompt` 属性 |
| `packages/coding-agent/package.json` | **+2 行** | 添加 `@earendil-works/pi-enhance-tui` 依赖及 `build:binary` 构建前置步骤 |
| `package.json` | **+2 行** | 在全局 `build` / `build:offline` 脚本中插入 `pi-enhance-tui` 构建步骤 |
| `tsconfig.json` | **+2 行** | 映射 `@earendil-works/pi-enhance-tui` 路径 |
| `vitest.base.ts` | **+2 行** | 映射 `@earendil-works/pi-enhance-tui` 路径别名 |
| `.gitignore` | **+2 行** | 忽略本地 `plan/archive/` 和 `.codegraph/` |

### 官方 0 修改的纯净模块
- **`packages/tui/*`**：**100% 官方纯净源码**（0 修改）
- **`packages/agent/*`**：**100% 官方纯净源码**（0 修改）
- **`packages/ai/*`**：**100% 官方纯净源码**（0 修改）
- **`packages/client/*`**：**100% 官方纯净源码**（0 修改）
- **`packages/server/*`**：**100% 官方纯净源码**（0 修改）
- **`packages/protocol/*`**：**100% 官方纯净源码**（0 修改）
- **`packages/telemetry/*`**：**100% 官方纯净源码**（0 修改）
- **`packages/session-backends/*`**：**100% 官方纯净源码**（0 修改）
- **`packages/coding-agent/src/core/tools/*`**：**100% 官方纯净源码**（0 修改）
- **`packages/coding-agent/src/core/system-prompt.ts`**：**100% 官方纯净源码**（0 修改）
- **`packages/coding-agent/src/core/keybindings.ts`**：**100% 官方纯净源码**（0 修改）
- **`packages/coding-agent/src/modes/interactive/components/*`**：**100% 官方纯净源码**（0 修改）

---

## 二、独立新增文件及模块说明

### 1. `packages/coding-agent/src/core/extensions/pi-extension-enhance.ts`
- **功能说明**：实现 Extension 上下文增强器、SDK `applyContextEnhancements` 辅助函数、动态 Tool 执行钩子包装器（`executeToolWithExtensions`）与本地配置过滤逻辑（`isToolEnabledInConfig`、`filterEnabledExtensions`、`filterEnabledSkills`）。

### 2. `packages/pi-enhance-tui/` 视觉与运行时增强独立包
- **功能说明**：独立 workspace 包，包含圆角卡片渲染、底部常驻输入框（Bottom Input Frame & Compositor）、Bun 原生高性能输出管道（`BunTerminalWriter`）、快速字符串宽度测量缓存引擎、ANSI 语法高亮与状态栏指标渲染。全部在运行时通过原型链动态增强，不污染官方组件源码。

### 3. 工具脚本
- **`update_code_from_pi.sh`**：自动从官方 upstream/main 拉取并同步最新源码。
- **`replace.sh`**：自动化辅助脚本。
