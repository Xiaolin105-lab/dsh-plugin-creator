---
name: pc-stage-5-verify-deliver
description: 插件创造模式阶段五「检查与交付」的规则与标准。逐条判据回填真机证据、派最后一位独立审查员终审、写清未验证项与回退点，产出 docs/05-验收.md 才算交付。
when-to-use: 项目处在 verify 阶段，或者任务清单已经全部完成、准备交付插件的时候。
---

# 阶段五 · 检查与交付

**目标：把阶段一写下的每一条成功判据，逐条钉上可复现的证据；钉不上的，明写"未验证"。**

## 产出

`docs/05-验收.md`，必须含这些小节（门禁逐字检查）：

```markdown
# <项目名> 验收

## 逐条判据与证据
## 安装态与版本
## 回退点
## 已知限制与未验证项
## 卸载方法
```

### 逐条判据与证据

用表格，一行一条判据，判据原文从 `docs/01-需求.md` 抄过来（不许改写放宽）：

| # | 成功判据（原文） | 证据（命令 / 输出 / 观察） | 结论 |
|---|---|---|---|
| 1 | 在 composer 下方出现 48×48 圆形图标 | `cordis_inspect_query client Slots root=conversation.composer.dock` 输出含 `id=my-decoration`；页面上肉眼可见 | 通过 |
| 2 | 点击后计数 +1 | 未取得浏览器控制，未验证 | **未验证** |

- "结论"只允许三档：**通过 / 未通过 / 未验证**。
- "通过"必须有能被人重跑的记录：命令、输出摘要、或明确的现象描述（谁在哪个页面看到什么）。
- 拿不到浏览器控制时，验证止步于 JS 语法 + manifest + 运行时注册，并**显式**写"视觉未经证实"。不要去找截图工具、不要抠 SVG、不要自己写渲染器来凑证据。
- 失败、部分通过、依赖环境的，一律如实写。

### 安装态与版本

- 安装位置（Profile、bundle 名、模式 id）、版本号、安装时间。
- `plugin_manager list_bundles` / `list_plugins` 的输出摘要，以及**激活结果**（`applied` / `restart-required` / `overridden`）。
- 对模式：`check-preset` 的结论 + 补丁里的那一行。

### 回退点

列出本项目的全部快照（`node $PC snapshot --project <目录> --list` 的输出），并写清回退命令：

```powershell
node $PC rollback --project <目录> --stage <阶段> --version vN
```

### 已知限制与未验证项

- 环境限制（某机器没有 X、某权限没给）。
- 认知限制（没读过的代码路径、没测过的边界）。
- 明确写"如果这些是必须的，下一步该做什么"。

### 卸载方法

`plugin_manager remove_bundle` 的准确 target；模式则写清从 Profile 补丁里删掉哪一行并重启。

## 终审（交付前最后一次独立审查）

用 `subagent` 再派一位审查员（全新上下文、只给路径）：`docs/05-验收.md`、`docs/01-需求.md`、`docs/03-计划.md`、`docs/04-开发记录.md`、全部评价产物，以及 `pc-review-protocol`。

让它专门盯这几件事：

- 有没有把"安装成功"当成"功能可用"；
- 有没有"通过"结论站不住（缺命令、缺输出、现象描述含糊）；
- 判据是否被偷偷改写或放宽；
- 未验证项是否被藏起来；
- 卸载/回退路径是否真的可行。

把它的原样回答落盘到 `docs/reviews/final.md`，并在 `docs/05-验收.md` 里写一行 `审查：<结论>`（门禁检查这个标记）。阻断级必须清零。

派发按 `plugin-creator` 的**三段写法**（规则范围 / 已证事实 / 输出分级）：终审同样不要把门禁已经跑过的命令再跑一遍，把它们的输出原文（`docs/reviews/brief-final.md`）递过去就行。

## 可选：把终审升格为「深审」

默认终审走快规则（信简报、不重跑、不读源码）——快，但它**抓不到伪造的证据**：如果前面某一轮的简报被动过手脚，快审看不出来。

所以留了一个可选的严格复核。**它不是默认项**，只在下面任一情况开：

- 这次真的要交付给别人 / 别人要照着复现；
- 怀疑门禁本身有洞（某条规则好像一直没人检查）；
- 前面几轮出现过"结论与产物对不上"的迹象。

**怎么开**（一条命令，生成深审版简报）：

```powershell
node $PC review-brief --stage verify --project <目录> --round 99 --deep [--name <包名> --target <目录>]
```

它产出 `docs/reviews/brief-r99-deep.md`，与快审版的三处不同：

| | 快审 | 深审 |
|---|---|---|
| 门禁输出 | 给原文，**不许重跑** | **不给**，改成"你必须自己重跑这几条命令"（含完整命令行） |
| 前几轮结论 | 不出现 | 列成**「待核实声明」**，明确写着"这不是结论，是主张" |
| gates 源码 | 不许读 | **允许且鼓励**，任务之一就是审计门禁自身的洞 |

派发时照旧只给路径，但要加一句：

```
本轮是深审（deep）。前几轮的审查结论只是待核实声明，请逐条自己重跑命令核验，
并把"门禁没覆盖哪条规则"写成单独一节。
```

**成本**：一次约 4–6 分钟（快审约 1 分钟）。**收益**：证据回到一手，能抓伪造、能审门禁。

> 一句话：**快的用于日常迭代，深审用于交付前的那一次。**

## 收口

```powershell
$PC = "$env:DSH_HOME\plugin-creator\gates\pc.mjs"
node $PC freeze --project <目录> --tag before --round 99     # 终审也要冻结
# 先把已证事实落盘，再派发终审：
New-Item -ItemType Directory -Force docs\reviews | Out-Null
node $PC gate --stage verify --project <目录> 2>&1 | Tee-Object -FilePath docs\reviews\brief-final.md
# …派发终审（三段写法，指向 brief-final.md）…
node $PC verify-freeze --project <目录> --round 99
node $PC gate --stage verify --project <目录>                 # 含格式守卫 + 冻结核对（+ 模式项目的 check-preset）
node $PC snapshot --project <目录> --stage verify
node $PC stage delivered --project <目录> --note "交付完成"
```

最后对用户交付时，只说清五件事：**装在哪、怎么用、怎么验证、怎么回退、哪里没验证。** 不要堆过程。
