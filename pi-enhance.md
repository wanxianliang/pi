# Pi Agent 增强扩展与源码修改说明 (vs 官方 upstream/main)

> **当前基准版本**：`upstream/main @ 890f92088` (v0.86.1)  
> **真实净增量比对命令**：`git diff upstream/main...HEAD` (三点比较，消除历史合并噪声)  
> **同步脚本**：`bash update_code_from_pi.sh` (自动 fetch 校验、生成物冲突处理、锁文件生成与不变量校验)

本文档整理了当前版本与官方最新版本 (`upstream/main`) 相比的源码修改点与新增功能文件说明。
所有修改遵循**极简侵入原则**（能不改源码就不改，必须改的以极简 1~2 行单点委托方式完成，逻辑内聚在独立模块中），以最大程度保证后续合并上游代码时零冲突。

---

## 一、官方公共文件修改清单（极简单行侵入）

| 文件 | 修改说明 |
|------|----------|
| `packages/ai/scripts/generate-models.ts` | 增加离线/受限网络下的模型元数据本地缓存与回退容错机制，确保 hydrate-model-data 在无外网环境平滑运行 |
| `packages/coding-agent/src/core/sdk.ts` | 在 `streamFn` 中单行调用 `applyContextEnhancements(headerRunner, context)` 获取增强后的上下文，并将其同步传递给 `cacheWarmer.start` 与 `modelRuntime.streamSimple`（深度适配官方 0.86.0 重构提取的 `buildRequestOptions` 与 `CacheWarmer` 缓存预热机制） |
| `packages/coding-agent/src/modes/interactive/tui-renderer.ts` | 仅在 `createInteractiveTui` 入口单点调用 `initPiEnhanceTui({ ... })` 挂载原型链增强，并在复制选区时单行调用 `stripCardBorders(text)` 去除卡片边框 |
| `packages/coding-agent/src/core/agent-session.ts` | 仅在 `runner.bindCore` 的 `contextActions` 中注册 `getAllToolDefinitions` 与 `emitAgentEvent`，并在 `isAllowedTool` 中追加 `isToolEnabledInConfig` 配置过滤 |
| `packages/coding-agent/src/core/resource-loader.ts` | `getExtensions()` 与 `getSkills()` 返回前分别单行经过 `filterEnabledExtensions` 与 `filterEnabledSkills` 本地过滤 |
| `packages/coding-agent/src/core/extensions/index.ts` | 导出 `EnhancedContextResult` 与 `filterContextWithExtensions` |
| `packages/coding-agent/src/core/extensions/runner.ts` | `createContext` 暴露 `getAllToolDefinitions`、`emitAgentEvent`、`executeTool`，提供 `emitContextEnhancements` 与 `emitTools`，兼容上游 `normalizeBuildSystemPromptOptions` |
| `packages/coding-agent/src/core/extensions/types.ts` | 声明 `getAllToolDefinitions`、`emitAgentEvent`、`executeTool` 接口扩展，并在 `ContextEvent` / `ContextEventResult` / `ToolCallEventBase` / `ExtensionContextActions` 中声明扩展字段 |
| `packages/coding-agent/package.json` | 添加 `@earendil-works/pi-enhance-tui: ^0.86.1` 依赖（内部包版本对齐上游 0.86.1）及 `build:binary` 构建前置步骤 |
| `packages/coding-agent/install-lock/package-lock.json` | 记录 `@earendil-works/pi-enhance-tui` (0.86.1) 依赖锁信息 |
| `packages/coding-agent/npm-shrinkwrap.json` | 记录 `@earendil-works/pi-enhance-tui` shrinkwrap 信息 |
| `package.json` | 在全局 `build` / `build:offline` 脚本中插入 `pi-enhance-tui` 构建步骤（兼容官方最新 `durable` 构建） |
| `package-lock.json` | 注册 `@earendil-works/pi-enhance-tui` (0.86.1) workspace 软链接及依赖项 |
| `tsconfig.json` | 映射 `@earendil-works/pi-enhance-tui` 路径别名 |
| `vitest.base.ts` | 映射 `@earendil-works/pi-enhance-tui` 测试路径别名 |
| `.npmrc` | 配置 `link-workspace-packages=deep` 与 `prefer-workspace-packages=true` |
| `.gitignore` | 忽略本地 `plan/archive/`、`.codegraph/` 与 `pi-bundle.tar.gz` |

### 官方 0 修改的纯净模块
- **`packages/tui/*`**：**100% 官方纯净源码**（0 修改）
- **`packages/agent/*`**：**100% 官方纯净源码**（0 修改）
- **`packages/ai/*`**：**100% 官方纯净源码**（0 修改，除自动生成的模型元数据数据外）
- **`packages/client/*`**：**100% 官方纯净源码**（0 修改）
- **`packages/server/*`**：**100% 官方纯净源码**（0 修改）
- **`packages/protocol/*`**：**100% 官方纯净源码**（0 修改）
- **`packages/telemetry/*`**：**100% 官方纯净源码**（0 修改）
- **`packages/session-backends/*`**：**100% 官方纯净源码**（0 修改）
- **`packages/coding-agent/src/core/tools/*`**：**100% 官方纯净源码**（0 修改）
- **`packages/coding-agent/src/core/system-prompt.ts`**：**100% 官方纯净源码**（0 修改）
- **`packages/coding-agent/src/core/keybindings.ts`**：**100% 官方纯净源码**（0 修改）
- **`packages/coding-agent/src/modes/interactive/components/*`**：**100% 官方纯净源码**（0 修改）
- **`packages/coding-agent/src/modes/interactive/interactive-mode.ts`**：**100% 官方纯净源码**（0 修改，随上游重构解耦后完全恢复纯净）
- **`packages/durable/*`**：**100% 官方纯净源码**（0 修改，上游最新新增持久化支持）
- **`packages/chord/*`**：**100% 官方纯净源码**（0 修改）
- **`packages/evals/*`**：**100% 官方纯净源码**（0 修改）

---

## 二、官方源码修改关键点深度解析（着重说明）

本项目对官方上游源码共有 **7 处核心源文件** 和 **若干工程配置** 进行了修改，全部恪守单点极简侵入：

### 1. `packages/coding-agent/src/core/sdk.ts`（LLM 上下文管道拦截）
- **修改位置**：`createAgentSession` 内部的 `streamFn` 回调函数。
- **改动详情**：
  - 在获取模型请求选项后，通过 `const headerRunner = extensionRunnerRef.current; const llmContext = headerRunner ? await applyContextEnhancements(headerRunner, context) : context;` 对上下文进行拦截与增强。
  - 将增强后的 `llmContext` 同步传递给上游 0.86.0 新增的 `cacheWarmer.start({ model, context: llmContext, options: requestOptions }, ...)` 与 `modelRuntime.streamSimple(model, llmContext, requestOptions)`。
  - 完美兼容官方最新抽取的 `buildRequestOptions`、`transformProviderPayload` 与 `handleProviderResponse`，保证缓存预热与流式调用完全协同。

### 2. `packages/coding-agent/src/modes/interactive/tui-renderer.ts`（TUI 原型链与剪贴板挂载）
- **修改位置**：`createInteractiveTui` 函数入口与选区复制回调。
- **改动详情**：
  - 入口首行调用 `initPiEnhanceTui({ AssistantMessageComponent, UserMessageComponent, ToolExecutionComponent, FooterComponent, InteractiveMode, ProcessTerminal })`，向独立包注入基础组件原型引用以挂载底部常驻输入框及 UI 样式增强。
  - 在终端选区复制时，单行使用 `stripCardBorders(text)` 清洗圆角边框及装饰符号，确保复制到剪贴板的内容纯净。

### 3. `packages/coding-agent/src/core/agent-session.ts`（工具全量暴露与配置过滤）
- **修改位置**：`runner.bindCore` 的 `contextActions` 与 `_isAllowedTool` 方法。
- **改动详情**：
  - 在 `contextActions` 中增加 `getAllToolDefinitions: () => filterAllToolDefinitions(this._baseToolDefinitions, this._toolDefinitions)` 以及 `emitAgentEvent: (event) => { this._handleAgentEvent(event); }`，打通向扩展插件暴露当前所有可用工具元数据的通道。
  - 在 `_isAllowedTool(name)` 中追加 `&& isToolEnabledInConfig(name)`，支持用户通过本地配置文件动态开启或禁用特定内置/插件工具。

### 4. `packages/coding-agent/src/core/resource-loader.ts`（扩展与技能配置化过滤）
- **修改位置**：`getExtensions()` 与 `getSkills()` 方法返回值。
- **改动详情**：
  - `getExtensions()` 返回前单行包装 `filterEnabledExtensions(this.extensionsResult)`，根据本地配置排除被禁用的扩展，并确保 `pi-manager` 始终置顶。
  - `getSkills()` 返回前单行包装 `filterEnabledSkills(this.skills)`，根据配置动态过滤不可用的技能。

### 5. `packages/coding-agent/src/core/extensions/index.ts`（增强导出）
- **修改位置**：模块统一导出。
- **改动详情**：导出 `EnhancedContextResult` 类型与 `filterContextWithExtensions` 上下文拦截方法。

### 6. `packages/coding-agent/src/core/extensions/runner.ts`（扩展运行时调度打通）
- **修改位置**：`ExtensionRunner` 类的内部方法与上下文构建。
- **改动详情**：
  - `createContext()` 暴露 `getAllToolDefinitions()`、`emitAgentEvent(event)` 与 `executeTool(toolName, input, options)` 方法，允许扩展插件编排调用其它工具并触发完整生命周期事件（tool_call / tool_result）。
  - 新增 `emitContextEnhancements(options)` 与 `emitTools(tools)`，支持通过插件 context 事件动态过滤或改写 tools 与 systemPrompt。

### 7. `packages/coding-agent/src/core/extensions/types.ts`（类型声明扩展）
- **修改位置**：扩展相关的 TypeScript 接口定义。
- **改动详情**：
  - `ExtensionContext` 中追加 `getAllToolDefinitions`、`emitAgentEvent`、`executeTool` 方法签名。
  - `ContextEvent` 与 `ContextEventResult` 中扩展 `tools?: any[]` 与 `systemPrompt?: string` 字段。
  - `ToolCallEventBase` 中追加 `parentToolCallId` 与 `callerTool`，支持工具嵌套调用追踪。
  - `ExtensionContextActions` 中追加 `getAllToolDefinitions` 与 `emitAgentEvent` 回调类型。

### 8. 构建与工程配置修改
- `packages/coding-agent/package.json`：添加 `@earendil-works/pi-enhance-tui: ^0.86.0` 依赖与 `build:binary` 前置构建。
- `package.json`：在根目录 `build` 与 `build:offline` 中添加 `packages/pi-enhance-tui` 的构建步骤。
- `tsconfig.json` & `vitest.base.ts`：添加 `@earendil-works/pi-enhance-tui` 的路径映射及别名解析。
- `package-lock.json`、`install-lock/package-lock.json`、`npm-shrinkwrap.json`：注册并锁定本地 workspace 包 (0.86.1)。
- `.npmrc`：开启 `link-workspace-packages=deep` 与 `prefer-workspace-packages=true`。
- `.gitignore`：追加本地打包及临时文件夹忽略。

---

## 三、独立新增文件及模块说明（简要文件名及功能）

### 1. `packages/coding-agent/src/core/extensions/pi-extension-enhance.ts`
- **功能说明**：实现 Extension 上下文增强器、SDK `applyContextEnhancements` 辅助函数、动态 Tool 执行钩子包装器（`executeToolWithExtensions`）与本地配置过滤逻辑（`isToolEnabledInConfig`、`filterEnabledExtensions`、`filterEnabledSkills`）。

### 2. `packages/coding-agent/test/pi-extension-enhance.test.ts`
- **功能说明**：测试 Extension 增强逻辑、工具包装执行钩子与本地扩展/技能过滤功能。

### 3. `packages/pi-enhance-tui/` 视觉与运行时增强独立包
独立 workspace 包，通过原型链在运行时动态增强 TUI 交互体验，保持官方组件源码 100% 纯净：
- **`src/index.ts`**：包统一导出入口。
- **`src/init.ts`**：无侵入初始化调度器，负责组件原型挂载与安全还原。
- **`src/bottom-input/`**：底部常驻输入框系统（`compositor.ts`, `extension.ts`, `frame.ts`, `icons.ts`, `runtime.ts`, `sanitize.ts`, `settings.ts`, `shortcuts.ts`, `status.ts`, `types.ts`）。
- **`src/ui/`**：UI 视觉增强卡片与组件（`banner.ts`, `card-box.ts`, `spinner.ts`, `theme.ts`, `tool-args.ts`, `tool-card.ts`）。
- **`src/clipboard.ts`**：终端及系统剪贴板交互适配。
- **`src/highlighter.ts`**：ANSI 语法高亮引擎。
- **`src/measure.ts`**：快速字符宽度计算引擎与双向测量缓存。
- **`src/memo.ts`**：高性能计算记忆化工具。
- **`src/strip-borders.ts`**：文本复制过滤，剔除卡片圆角框等装饰性字符。
- **`src/writer.ts`**：Bun 原生输出管道封装。
- **`test/`**：自动化测试套件（`enhance.test.ts`, `bottom-input.test.ts`）。

### 4. 工具与维护脚本
- **`update_code_from_pi.sh`**：自动从官方 upstream/main 拉取并合并同步最新源码。
- **`replace.sh`**：本地增强包构建并替换安装至全局 bun 运行环境的脚本。
- **`pack.sh`**：项目打包发布与制品归档脚本（生成 `pi-bundle.tar.gz`）。
- **`pnpm-workspace.yaml` / `pnpm-lock.yaml`**：pnpm workspace 配置文件与依赖锁。
- **`UPDATECODE.md`**：上游代码拉取合并与冲突解决维护说明。
