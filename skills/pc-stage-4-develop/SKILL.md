---
name: pc-stage-4-develop
description: 插件创造模式阶段四「开发」的规则与标准。每个任务一轮闭环：写代码 → 格式守卫 → 安装并核对 → 冻结 → 派独立审查员 → 核对冻结 → 阻断清零 → 记录 → 落快照，全过程把证据写进 docs/04-开发记录.md。
when-to-use: 项目处在 develop 阶段，正在按 docs/03-计划.md 逐个任务实现插件的时候。
---

# 阶段四 · 开发

**目标：每完成一个任务，都留下一份"真的装上、真的能用、并且被别人独立审过"的证据。**

## 一个任务一轮，顺序不能换

```powershell
$PC = "$env:DSH_HOME\plugin-creator\gates\pc.mjs"
$R  = <轮次号，从 1 开始>
```

1. **写代码**：只动这个任务范围内的文件，用计划里的产物清单当准绳。
2. **格式守卫**：`node $PC guard --project <目录>`（非 0 先修，别带病往下走）。
3. **安装并核对安装态**（**只有本任务改了"会被安装的产物"才做这一步**：包内文件、`package.json`、`cordis.patch.yml`、`sounds/`、`locale/` 之类。纯文档改动 —— 只改了 `docs/` 里的记录 —— **跳过安装**，并在记录里写一句"纯文档改动，未安装"）：
   - 本地 bundle：`plugin_manager` 的 `install_bundle`，`target` 传目录绝对路径（需要完整访问权限；`approvedBuilds` 只在用户明确同意后传）。
   - **保存状态与激活结果分开读**：`applied` 只说明写进去了；`failed` 要诊断；`overridden` 说明被更高优先级的层盖住；`restart-required` 说明还没生效（告诉用户要重启，别声称已可用）。
   - 核对：`node $PC verify-install --name <包名> --target <目录>`（退出码 0 才算"装上了"）。
4. **冻结**：`node $PC freeze --project <目录> --tag before --round $R`。
5. **派发独立审查员**：`subagent`（provider `spawn`），prompt 里只有路径。模板见 `plugin-creator` 的「派发审查员的固定写法」，**三段不能省**：

   ```
   你是本轮的独立审查员。只读，不改任何文件，不要向派发方提问（路径缺失就记一条 Finding）。

   审查协议（必须先完整读）：
     <DSH_HOME>\plugin-creator\skills\pc-review-protocol\SKILL.md

   规则范围（只读这两个，不要通读 gates/*.mjs 源码）：
     <DSH_HOME>\plugin-creator\skills\pc-stage-4-develop\SKILL.md

   待审产出物（绝对路径）：
     <本任务的产物文件，逐个列全>
     <docs/03-计划.md>
     <docs/04-开发记录.md>

   已证事实（命令输出原文，已由确定性脚本执行过——不要重跑，只核对是否覆盖规则要求）：
     docs\reviews\brief-r<R>.md

   本轮要核对的证据清单（绝对路径）：
     <install 返回原文落盘的路径，或 verify-install 的输出落盘路径>

   按协议输出：VERDICT + 阻断/主要六字段 + 次要一行。
   ```

   **先落盘已证事实再派发**（这就是「不要重跑门禁」的依据）——一条命令搞定，不要手搓：

   ```powershell
   node $PC review-brief --stage develop --project <目录> --round $R --name <包名> --target <目录>
   ```

   它产出 `docs/reviews/brief-r$R.md`：本轮变更（freeze 差量）、`gate` 与 `verify-install` 的**输出原文**（附指纹）、本阶段 skill 的**逐字摘录**、成功判据摘录、待审产物清单。

   > `docs/reviews/` 不在格式守卫与冻结范围内：它是门禁与审查器的**输出**，不是作者写的产物。

   把审查员的完整回答**原样落盘**到 `docs/reviews/r<N>-<任务 id>.md`，这是证据，不许摘要代替。

6. **核对冻结**：`node $PC verify-freeze --project <目录> --round $R`。非 0 → 审查期间文件被动过 → **这一轮作废**，记一条原因，回到第 4 步重派（轮次 +1）。

   > `docs/reviews/` **不在冻结范围内**：审查报告是"审查的产出"，按流程就是派发之后才落盘的，算进去会让每一轮都判成"审查期间被新增"，于是永远重派。
   > 被审产物（`pkg/`、`docs/01..05`）仍然全部在范围内 —— 改代码、改设计文档照样作废。
7. **处理 Finding**：
   - 阻断级：必须清零。清零后要**重跑同一条证据**（第 3 步）。
   - 主要：修，或在记录里写清为什么本次不修并让用户确认。
   - 次要：记进文档，不阻塞。
   - 修完之后的重审**用复审模板**（`plugin-creator` 的「返工轮」），**不要**再把全量产物递一遍：

     ```
     本轮是复审，不是首审。
     审查协议：<DSH_HOME>\plugin-creator\skills\pc-review-protocol\SKILL.md
     上一轮 Finding 原文：docs\reviews\r<N-1>-*.md
     本轮修复点（差量清单，只读这些）：<改动过的文件，逐个列全>
     需重新取证的判据：<verify-freeze 输出 / 04 里"修复"那几行>
     按「复审模式」输出：逐条复查表 + VERDICT + 仅由本次修复引入的新问题。
     ```
   - **不许**只在脑子里确认"我改了"；也不许用"我又读了一遍全量"冒充复审。
   - 修改后必须重新冻结/重派——**不许**只在脑子里确认"我改了"。
8. **记录**（见下）。**这个任务不落快照** —— 快照是"回退点"，不是"任务日志"；任务级证据已经在 `docs/04-开发记录.md` 与 `docs/reviews/r<N>-*.md` 里。快照在阶段收口时落一次（见下「收口」）。

## 记录格式（门禁检查 `## 任务记录` / `证据：` / `审查：`）

`docs/04-开发记录.md`：

```markdown
## 任务记录

### T2 <任务名>（轮次 R3）
产物：<文件列表>
改动：<一句话说清改了什么，不写心路历程>
证据：<命令 + 关键输出摘要 + 观察到的现象>
清单：<plugin_manager 返回的 applied/failed/overridden/restart-required 原文摘要>
审查：<docs/reviews/r3-T2.md>，VERDICT=FAIL→已修→重审 PASS；阻断 2→0，主要 1（未修，用户已确认）
快照：阶段收口时统一落（develop/v1）
```

## 铁律（这个阶段最容易破的就是这几条）

- **不许自审。** 不许写"我已重新检查，没有问题"。
- **不许用 `subagent_fork`** 派审查员（它继承父对话，等于自审）。
- **不许在审查期间碰任何产物文件**（冻结核对会抓到，整轮作废）。
- **不许一次改两个任务的文件。**
- **不许把"安装成功"写成"功能可用"。** 真机现象没看到就写"未验证"。
- **不许把失败过的证据留着充数**：修完必须重跑同一条命令。

## 收口

```powershell
node $PC gate --stage develop --project <目录>
node $PC snapshot --project <目录> --stage develop      # 阶段级回退点，落一次就够
node $PC stage verify --project <目录> --note "任务清单全部完成并通过审查"
```
