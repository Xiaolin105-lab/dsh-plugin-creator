---
name: plugin-creator
description: 插件创造模式的唯一入口。任何"做个插件 / 改插件 / 装插件 / 修插件 / 交付插件"的请求都先加载它——它读项目状态、判断走到哪一步、把你带进对应阶段，并规定每个阶段必须过的门禁与独立审查。
when-to-use: 用户在插件创造模式里提出插件相关的任何请求（新建、改造、安装、排障、交付），或提到 bundle、皮肤、UI 组件、MCP、agent preset（模式）。
---

# 插件创造模式 · 总路由

你是这条流水线的调度层，也是唯一入口。**不要凭记忆跳阶段，也不要绕过本 skill 直接写代码。**

## 五层结构（先认清你在哪一层干活）

| 层 | 谁 | 干什么 |
|---|---|---|
| 调度层 | 本 skill | 判断项目走到哪一步，带你进对应阶段 |
| 流水线 | `pc-stage-1-interview` … `pc-stage-5-verify-deliver`（含 `pc-stage-1b-survey`） | 讲规则讲标准，过程留白 |
| 审核层 | 现场用 `subagent` 派发的独立审查员 + `pc-review-protocol` | 全新上下文、只读、只认文件和证据 |
| 门禁层 | `gates/pc.mjs` 确定性脚本链 | 状态、快照、冻结校验、健康检查、脚手架、安装核对、格式守卫 |
| 辅助 | `pc-goal-creator`、`pc-plugin-installer` | 起草 /goal 自驱指令；一句话装本地插件 |

## 第一步永远是这三件事

```powershell
# 命令前缀（本机 Windows + PowerShell；换机器把 DSH_HOME 换掉即可）
$PC = "$env:DSH_HOME\plugin-creator\gates\pc.mjs"

node $PC status                 # 1. 读状态：项目走到哪一步了
```

1. **读状态。** 没有 `.plugin-creator/state.json` 就是新项目：
   `node $PC init --project <插件项目目录> --name <项目名> --kind ui|host|bundle|mcp|preset`
2. **定位阶段**，然后**加载对应的阶段 skill**（下表）。一次只处在一个阶段。
3. **按阶段 skill 的规则做事**，收口时跑门禁、派审查员、问用户要不要留旧版。

| 阶段 id | 名字 | skill | 产出文件 |
|---|---|---|---|
| `interview` | 需求采访 | `pc-stage-1-interview` | `docs/01-需求.md` |
| `survey` | 现成插件调研 | `pc-stage-1b-survey` | `docs/01b-市场调研.md` |
| `design` | 交互与运行时设计 | `pc-stage-2-design` | `docs/02-设计.md` |
| `plan` | 拆计划 | `pc-stage-3-plan` | `docs/03-计划.md` |
| `develop` | 开发 | `pc-stage-4-develop` | `docs/04-开发记录.md` |
| `verify` | 检查与交付 | `pc-stage-5-verify-deliver` | `docs/05-验收.md` |
| `delivered` | 已交付 | — | — |

推进与收口：

```powershell
node $PC stage <阶段> --project <目录> --note "为什么推进"
node $PC gate  --stage <阶段> --project <目录>     # 退出码非 0 = 不许推进
```

## 铁律（违反任何一条，这一轮就不算过）

1. **不许自审。** 每完成一个开发任务、每到一次大收口，都要用 `subagent` 工具派发独立审查员。同一个上下文里让模型忘掉自己刚写过的东西，它做不到；写一段"现在请你以审核员身份重读一遍"不算审核。
2. **只递路径。** 派发时给审查员的只有：产出物绝对路径、`pc-review-protocol` 的 SKILL.md 路径、这一轮要核对的证据清单路径。不递摘要、不递你的推理、不递辩解。用 `subagent`（provider `spawn`，全新上下文），**绝不能用 `subagent_fork`**（fork 继承父对话）。
3. **冻结核对。** 派发前 `freeze --tag before`，审查员返回后 `--check`。文件被动过 → 整轮作废、重派，并在记录里写明原因。
4. **证据优先。** "代码写完了"不是完成。装没装上看目录与清单（`verify-install`），能不能用看真机（Web UI 里真的渲染出来 / 模式在下拉里被选中并真的切过去）。没证据的部分显式写「未验证」。
5. **门禁非 0 不许推进。** `pc.mjs gate` 的退出码就是判决书；不要用"我看了下没问题"代替脚本输出。
6. **版本保留只约定一次。** 新建项目时用 `ask_user_question` 问**一次**"保留前面几版"（选项 0 / 1 / 3 / 5 / 全部），
   然后 `node $PC init --project <目录> --name <名> --keep <N>` 把这个约定写进项目状态。
   **之后每个阶段收口一律不再问**，`snapshot` 不写 `--keep` 就按项目约定走。
   只有真要改动这个约定时（或回退前）才再问一次。回退：`node $PC rollback --project <目录> --stage <阶段> --version vN`。
   > 为什么改：保留几版是**项目级的一次性约定**，不是每阶段的新信息。逐阶段追问只会打断人，换不来更安全的回退。

## 派发审查员的固定写法

派发前：

```powershell
node $PC freeze --project <目录> --tag before --round <N>
```

然后用 `subagent`，prompt 只有**路径**，形如：

```
你是本轮的独立审查员。只读，不改任何文件，不要向派发方提问（路径缺失就记一条 Finding）。

审查协议（必须先完整读）：
  <DSH_HOME>\plugin-creator\skills\pc-review-protocol\SKILL.md

规则范围（只读这两个，不要通读 gates/*.mjs 源码）：
  <本阶段的 pc-stage-* SKILL.md 绝对路径>

待审产出物（绝对路径）：
  <产物 1 绝对路径>
  <产物 2 绝对路径>
  <阶段文档绝对路径>

已证事实（命令输出原文，已由确定性脚本执行过——不要重跑，只核对是否覆盖规则要求）：
  <docs\reviews\brief-r<N>.md 绝对路径>

本轮要核对的证据清单（绝对路径）：
  <docs/0X-*.md 或专门的证据清单文件>

按协议要求输出审查结果（VERDICT + 阻断/主要六字段 + 次要一行）。
```

**三处不能省**（2026-10-19 起，这三条是把 232 秒压下来的主要手段）：

1. **规则范围**：只给协议 + 本阶段 skill。不给 `gates/` 源码——门禁的行为由「已证事实」的输出原文证明。
2. **已证事实**：用一条命令生成简报，再把路径给审查员——**不要手搓**：
   ```powershell
   node $PC review-brief --stage <阶段> --project <目录> [--round <N>] [--name <包名> --target <目录>]
   ```
   它确定性产出 `docs/reviews/brief-r<N>.md`，内含：本轮变更（从 freeze 基线差量算）、门禁输出**原文**（附输出指纹）、阶段 skill 的**逐字摘录**、成功判据摘录、待审产物清单、硬约束。
   有 `--name` 时还会跑一次 `verify-install` 并把原文写进去；没有就明写「安装态仍未验证」。
3. **输出分级**：阻断/主要六字段，次要只写一行。

返回后：

```powershell
node $PC verify-freeze --project <目录> --round <N>   # 非 0 = 文件被动过 = 整轮作废
```

### 能并行就并行（⑥）

同一冻结点下，**互不相干的任务**可以同时派多个审查员：它们只读、不改文件，共享同一个基线是安全的。

```
任务 A ─┐
任务 B ─┼─ 同一次 freeze ──► 并行派发 ──► 各自 verify-freeze（同一个 round 都通过才算数）
任务 C ─┘
```

- 省的是**墙上时间**（N×T → max(T)），**不省 token**（每个都是独立上下文）。
- 只有真独立才并行：改同一批文件的任务必须串行，否则 `verify-freeze` 会抓不到是谁改的。
- 并行时每个审查员都要拿到**自己那份** `brief-r<N>.md`（不同任务产物不同，简报也不同），不要共用。

**分模型（可选，看工具支持）**：本模式 preset 里 `tool-subagent` 打开了 `modelSelectionSettings`，所以派发时**可能**可以指定模型。若可用，机械筛查（存在性、可解析、清单一致性——这些本来就大半由门禁脚本做了）可用低一档模型，判断项（判据覆盖、接口真实性、证据质量）仍用默认模型。**没验证过的能力不要写进流程**：先确认当前会话的 `subagent` 真的接受模型参数，再决定用不用。

### 返工轮：用复审模板，不要全量重派

阻断/主要修完之后的重审，**不要**再把全量产物递一遍。换成复审模板（轮次 +1）：

```
本轮是复审，不是首审。

审查协议：
  <DSH_HOME>\plugin-creator\skills\pc-review-protocol\SKILL.md

上一轮 Finding 原文：
  docs\reviews\r<N-1>-*.md

本轮修复点（差量清单，只读这些文件）：
  <改动过的文件绝对路径，逐个列全>

冻结差量 / 需重新取证的判据：
  <verify-freeze 的输出，或 docs\04-开发记录.md 里"修复"那几行>

按协议的「复审模式」输出：逐条复查表 + VERDICT + 仅由本次修复引入的新问题。
```

**预期效果**：首审 120–150 秒，复审 50–70 秒（实测首审基线 232 秒）。省下来的不是"少读一遍"，而是"不必把已经证明过的事再证明一遍"。

## 阶段怎么判定（拿不准时照这个来）

- 没有 `.plugin-creator/state.json` → `init` + `interview`。
- 需求文档过了收口，调研文档还没影子 → `survey`。
- 调研结论是 `决定：自研` 或 `决定：混合`，设计文档还没影子 → `design`。
- 调研结论是 `决定：采用现成插件` → 收口后直接 `stage delivered`（唯一近路，门禁会核对文档），然后去装。
- 设计文档齐了、任务清单还没写 → `plan`。
- 有任务清单、还有 `- [ ]` 未完成 → `develop`。
- 任务全绿、验收文档还没写 → `verify`。
- 用户中途改需求 → 回到受影响的最早阶段重走，别在开发阶段偷偷改需求；回退用 `pc.mjs stage <更早阶段> --force` 并说明为什么。

**`survey` 不是可选项。** 需求收口之后一律先进它——哪怕宿主的想法百分之百独一份，也要留下"我查过，确实没有"的三条检索记录。跳过它直接进设计，等于把"要不要买现成的"这个决定权扔掉了。

## 卡住的时候（不是"再读一遍代码"）

- 装不上 → `verify-install` 看 Profile 里到底有没有；`plugin_manager list_bundles` 读激活结果。
- 装上了没用 → 查 `cordis_inspect_list` / `cordis_inspect_query` 的真实声明，别猜 API 名。
- 模式不出现 → `check-preset`；模式出现但选中失败 → 看补丁里的行名是否都在 `check-preset` 的"行名可解析"清单里。
- 审查员反复给同一类 Finding → 说明规则没落到产物里，回到设计阶段补标准，而不是再改一遍代码。
