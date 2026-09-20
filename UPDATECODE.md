# 上游官方源码同步与维护操作指南 (AI 执行规范)

本项目为官方 Pi Agent (`https://github.com/earendil-works/pi.git`) 的 Fork 定制版本。
当用户指示你执行代码同步（例如提示 `@UPDATECODE.md` 或 `帮我从官方同步最新代码`）时，**必须严格按本文档的标准化流程执行**。

---

## 一、核心原则与铁律

1. **分支铁律**：全部工作在 `main` 分支进行，使用 `git merge` 融入上游，**严禁使用 `git rebase`**（避免重放 40+ 历史提交导致大量回退文件的伪冲突）。
2. **极简侵入原则**：除定制的 `packages/pi-enhance-tui/` 独立包和新增的 `pi-extension-enhance.ts` 之外，对官方源文件的修改**必须控制在 7 处核心文件以内**，且每处均为 1~2 行委托调用。
3. **官方纯净模块不得污染**：`packages/tui/*`、`packages/agent/*`、`packages/ai/*`、`packages/client/*`、`packages/server/*`、`packages/durable/*`、`packages/chord/*` 等必须保持 100% 官方纯净。
4. **生成物绝不手工解冲突**：`package-lock.json`、`npm-shrinkwrap.json`、`install-lock/package-lock.json` 若冲突，直接取上游版本（`--theirs`），随后通过官方脚本全量重新生成。
5. **不变量必须 100% 通过**：同步完成后必须运行 4 项依赖与安全锁检查，全部通过才算成功。
6. **严禁私自提交或推送**：除非用户明确要求 commit 或 push，否则仅在工作区完成合并与更新。

---

## 二、标准同步执行步骤

### 步骤 1：调用自动化同步脚本

在项目根目录下直接执行：
```bash
bash update_code_from_pi.sh
```

该脚本会自动执行：
1. 开启 `rerere` 与 `zdiff3` 冲突样式。
2. 拉取官方 `upstream` 并校验 `upstream/main` 远端与本地 ref 一致性（防止静默 no-op）。
3. 检查落后提交数：
   - 若落后数为 0：提示已是最新，跳过合并。
   - 若有更新：执行 `git merge --no-edit upstream/main`。
4. 自动处理生成物冲突（取上游版本并重新生成）。
5. 执行官方 4 项依赖不变量检查与类型安全检查。
6. 输出基于 `upstream/main...HEAD` 的真实净增量与官方修改文件列表。

---

### 步骤 2：如果发生代码冲突（Exit 1）的处理方式

如果 `update_code_from_pi.sh` 提示冲突并退出，通常发生在以下 7 个核心源文件中：

| 文件 | 允许的侵入逻辑（参考 pi-enhance.md） | 冲突解决原则 |
|------|--------------------------------------|--------------|
| `packages/coding-agent/src/core/sdk.ts` | `streamFn` 中调用 `applyContextEnhancements` 拦截上下文，并传递给 `cacheWarmer.start` 与 `modelRuntime.streamSimple` | 保留上游最新参数构建与预热逻辑，仅将传入的 `context` 替换为增强后的 `llmContext` |
| `packages/coding-agent/src/modes/interactive/tui-renderer.ts` | 入口调用 `initPiEnhanceTui({ ... })` 注入原型；复制选区时调用 `stripCardBorders(text)` | 保留官方最新组件初始化流程，入口插入委托调用，复制拦截处理 |
| `packages/coding-agent/src/core/agent-session.ts` | 暴露 `getAllToolDefinitions`、`emitAgentEvent`；`_isAllowedTool` 追加 `&& isToolEnabledInConfig(name)` | 保留上游权限与工具校验，在尾部追加配置过滤 |
| `packages/coding-agent/src/core/resource-loader.ts` | `getExtensions()` 与 `getSkills()` 返回前分别调用 `filterEnabledExtensions` 与 `filterEnabledSkills` | 保留上游资源加载，仅对返回值做过滤包装 |
| `packages/coding-agent/src/core/extensions/runner.ts` | `createContext` 暴露 `getAllToolDefinitions`、`emitAgentEvent`、`executeTool`；新增 `emitContextEnhancements` 与 `emitTools` | 保留上游 runner 动作，合入增强动作方法 |
| `packages/coding-agent/src/core/extensions/types.ts` | 类型扩展（`ExtensionContext`、`ContextEvent`、`ToolCallEventBase` 等） | 合并 interface 字段，不可删除上游原有属性 |
| `packages/coding-agent/src/core/extensions/index.ts` | 导出 `EnhancedContextResult` 与 `filterContextWithExtensions` | 保留上游导出，追加增强导出 |

**解决冲突流程**：
1. 运行 `git status` 查看具体冲突文件。
2. 针对源码冲突，阅读冲突区块，以**单点委托**方式合入上游变更，确保上游新特性的参数管道不丢失。
3. 针对生成物冲突（若有残留），直接执行：
   ```bash
   git checkout --theirs -- package-lock.json packages/coding-agent/npm-shrinkwrap.json packages/coding-agent/install-lock/package-lock.json
   git add package-lock.json packages/coding-agent/npm-shrinkwrap.json packages/coding-agent/install-lock/package-lock.json
   ```
4. 解决所有冲突后，标记解决并提交合并：
   ```bash
   git add <resolved-files>
   git commit --no-edit
   ```
5. 重新运行同步脚本以确保重新生成锁文件并校验通过：
   ```bash
   bash update_code_from_pi.sh
   ```

---

### 步骤 3：验证与不变量检查

确保以下命令全部执行成功（退出码为 0）：
```bash
node scripts/check-pinned-deps.mjs
node scripts/check-runtime-deps.mjs
node scripts/generate-coding-agent-install-lock.mjs --check
node scripts/generate-coding-agent-shrinkwrap.mjs --check
```
如需全面类型与语法检查（不跑测试），可运行：
```bash
npm run check
```

---

### 步骤 4：比对与更新 `pi-enhance.md`

1. **获取准确基准与差异统计**（**必须使用三点语法 `upstream/main...HEAD`**）：
   ```bash
   UPSTREAM_SHA=$(git rev-parse --short upstream/main)
   git diff --shortstat upstream/main...HEAD
   git diff --name-status upstream/main...HEAD
   ```
2. **核对修改文件清单**：
   - 确认修改的官方源码文件依然严格限于 7 个核心源文件（或由于官方重构有合理增减）。
   - 若官方重构影响了某个文件的挂载点（例如 0.86.0 中提取了 `buildRequestOptions` 和 `cacheWarmer`），在 `pi-enhance.md` 的对应条目下更新技术细节说明。
   - 更新文档顶部的基准 SHA 声明，例如：
     ```markdown
     > **当前基准版本**：`upstream/main @ <UPSTREAM_SHA>`
     > **真实净增量比对命令**：`git diff upstream/main...HEAD`
     ```
3. **独立新增文件**：
   若无文件变动，简易列出文件名与对应职责即可，无需冗余罗列全文。

---

## 三、完成后的回复标准

向用户汇报时，应保持简明扼要，给出以下确定性证据：
1. 本次同步的 Upstream 基准 SHA 与包含的官方上游提交数。
2. 是否发生代码冲突；若有，说明是如何解决的。
3. 四项官方不变量检查（pinned-deps、runtime-deps、install-lock、shrinkwrap）的运行结果（均为 Exit 0）。
4. 净增量摘要（修改的官方源文件数量、总增删行数）。
5. `pi-enhance.md` 的更新情况。
