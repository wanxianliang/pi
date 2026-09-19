# Pi Agent 增强扩展与源码修改说明 (vs 官方 upstream/main)

本文档整理了当前版本与官方最新版本 (`upstream/main`) 相比的源码修改点与新增功能文件说明。
所有修改遵循**极简侵入原则**（能不改源码就不改，必须改的以极简 1~2 行单点委托方式完成，逻辑内聚在独立模块中），以最大程度保证后续合并上游代码时零冲突。

---

## 一、官方公共文件修改清单（极简单行侵入）

| 文件 | 修改说明 |
|------|----------|
| `packages/coding-agent/src/core/sdk.ts` | 在 `modelRuntime.streamSimple` 调用前单行调用 `applyContextEnhancements(headerRunner, context)`（已兼容官方最新重构的 `TranscriptContext` 规范） |
| `packages/coding-agent/src/modes/interactive/tui-renderer.ts` | 仅在 `createInteractiveTui` 入口单点调用 `initPiEnhanceTui({ ... })` 动态挂载原型增强，并在复制选区时单行调用 `stripCardBorders(text)` 去除卡片边框 |
| `packages/coding-agent/src/core/agent-session.ts` | 仅在 `runner.bindCore` 的 `contextActions` 中注册 `getAllToolDefinitions` 与 `emitAgentEvent`，并在 `isAllowedTool` 中追加 `isToolEnabledInConfig` 配置过滤 |
| `packages/coding-agent/src/core/resource-loader.ts` | `getExtensions()` 与 `getSkills()` 返回前分别单行经过 `filterEnabledExtensions` 与 `filterEnabledSkills` 过滤 |
| `packages/coding-agent/src/core/extensions/index.ts` | 导出 `EnhancedContextResult` 与 `filterContextWithExtensions` |
| `packages/coding-agent/src/core/extensions/runner.ts` | `createContext` 暴露 `getAllToolDefinitions`、`emitAgentEvent`、`executeTool`，提供 `emitContextEnhancements` 与 `emitTools`，并兼容上游最新的 `normalizeBuildSystemPromptOptions` |
| `packages/coding-agent/src/core/extensions/types.ts` | 声明 `getAllToolDefinitions`、`emitAgentEvent`、`executeTool` 接口扩展，并在 `ContextEvent` / `ContextEventResult` / `ToolCallEventBase` / `ExtensionContextActions` 中声明扩展字段 |
| `packages/coding-agent/package.json` | 添加 `@earendil-works/pi-enhance-tui` 依赖及 `build:binary` 构建前置步骤 |
| `packages/coding-agent/install-lock/package-lock.json` | 记录 `@earendil-works/pi-enhance-tui` 依赖锁信息 |
| `packages/coding-agent/npm-shrinkwrap.json` | 记录 `@earendil-works/pi-enhance-tui` shrinkwrap 信息 |
| `package.json` | 在全局 `build` / `build:offline` 脚本中插入 `pi-enhance-tui` 构建步骤（保留上游最新的 `durable` 构建） |
| `package-lock.json` | 注册 `@earendil-works/pi-enhance-tui` workspace 软链接及依赖项 |
| `tsconfig.json` | 映射 `@earendil-works/pi-enhance-tui` 路径 |
| `vitest.base.ts` | 映射 `@earendil-works/pi-enhance-tui` 路径别名 |
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

## 二、独立新增文件及模块说明

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
