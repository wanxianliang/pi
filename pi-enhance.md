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


---

## 三、packages/pi-enhance-tui/ 视觉增强包

独立 workspace 包 `@earendil-works/pi-enhance-tui`，所有对官方 `packages/tui` 和 `packages/coding-agent` 的视觉/性能增强均集中在此包，遵循**最小源码侵入原则**（能不改源码就不改，必须改的以极简单行注入方式完成）。

### 源码修改（最小源码修改原则）

| 文件 | 改动 | 说明 |
|------|------|------|
| `packages/coding-agent/.../interactive-mode.ts` | +10 / -1 行 | 仅在 `createInteractiveTui()` 处单行调用 `initPiEnhanceTui({ ... })` 动态挂载增强原型，并在 `copySelection` 中调用 `stripCardBorders()` |
| `packages/tui/*` | **0 行** | **100% 官方纯净源码**，无需修改任何文件 |
| `packages/coding-agent/.../components/*` | **0 行** | **100% 官方纯净源码**，`AssistantMessageComponent`、`UserMessageComponent`、`ToolExecutionComponent`、`FooterComponent` 全部由 `initPiEnhanceTui` 在运行时通过原型链动态增强，完全不侵入源码 |
| `tsconfig.json` | +2 行 | 新增 `@earendil-works/pi-enhance-tui` 路径映射 |
| `vitest.base.ts` | +2 行 | 注册 Vite resolve alias |
| `package.json` | +2 行 | build/build:offline 脚本插入 pi-enhance-tui 构建步骤 |
| `packages/coding-agent/package.json` | +2 行 | 新增依赖与 build:binary 构建步骤 |

### packages/pi-enhance-tui/src/ 文件说明

**初始化与动态增强**

- **init.ts** — `initPiEnhanceTui(options?)`：核心激活函数。通过传入组件类动态对 `UserMessageComponent`、`AssistantMessageComponent`、`ToolExecutionComponent`、`FooterComponent`、`ProcessTerminal` 与 `InteractiveMode` 应用现代化圆角卡片渲染、Braille 动态加载图标、Bun 原生高性能输出管道及极简启动 Hero，支持 `restore()` 完整还原。
- **writer.ts** — `BunTerminalWriter`：使用 `Bun.stdout.writer()` 替代 `process.stdout.write`，每次写入后立即 flush，消除官方实现在 Bun 下的输出延迟。
- **measure.ts** — `FastTextMeasureEngine`：带 LRU 缓存（默认 2048 条）的高性能宽度测量引擎，纯 ASCII O(n)、CJK 快速码点范围检测，仅复杂 Unicode 回退 Intl.Segmenter。
- **highlighter.ts** — `highlightCode(code, lang?)`：基于 ANSI 转义的轻量语法高亮器，支持 TypeScript/JavaScript、JSON、Python、Shell、diff，零外部依赖。
- **memo.ts** — `memoComponent(inner, getKey)`：组件记忆化包装器，key 不变时返回上次渲染结果。
- **strip-borders.ts** — `stripCardBorders(text)`：清理复制文本中的圆角卡片边框字符，保留纯文本内容。

**UI 组件**

- **ui/theme.ts** — `PALETTE` 统一色板、`BORDER_CHARS` 圆角边框字符集、`STATUS_ICONS` 工具状态图标（pending/running/success/error）。
- **ui/card-box.ts** — `renderCardBox(options)`：通用圆角卡片渲染，支持 tool/user/thinking/assistant 四种变体与五种状态，可限制高度并在溢出时追加展开提示。
- **ui/spinner.ts** — `SPINNER_FRAMES`：Braille spinner 帧序列。
- **ui/tool-args.ts** — `formatToolArgs(toolName, args)`：将工具入参格式化为单行可读摘要（如 bash > npm run check）。
- **ui/tool-card.ts** — 工具调用内容渲染辅助，按 JSON/diff/plain 自动分类并应用高亮后传入卡片。
- **ui/banner.ts** — `renderStartupDashboard(options)` / `createStartupHero(getModel, version)`：启动画面，渲染五行渐变 pi Logo（紫->靛->天蓝->青）+ 居中模型名/提供商/版本号。

**底部输入框（bottom-input/）**

- **compositor.ts** — `BottomInputCompositor`：核心合成器，叠加渲染美化编辑器帧与状态栏至终端底部，管理光标位置与行高变化时的滚动补偿。
- **frame.ts** — `renderBeautifiedEditorFrame(input)`：渲染圆角边框编辑器，上边框嵌入模型名/thinking 级别，下边框嵌入已用时长。
- **runtime.ts** — `BottomInputRuntime`：完整运行时，订阅渲染事件、驱动 compositor、定时刷新 elapsed 计时。
- **status.ts** — `buildBottomInputStatus(session)`：从 Session 提取模型、thinking、上下文使用率、elapsed，格式化为 frame 所需状态结构。
- **extension.ts** — `createBottomInputExtension()`：将底部输入框封装为标准 Extension，通过 session_start 挂载运行时，session_end 时销毁。
- **icons.ts / sanitize.ts / settings.ts / shortcuts.ts / types.ts** — 图标集、文本清洗、配置读取、快捷键绑定与类型定义。
