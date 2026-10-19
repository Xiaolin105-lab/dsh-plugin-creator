---
name: pc-stage-1b-survey
description: 插件创造模式「现成插件调研」阶段的规则与标准。需求采访收口后先去 GitHub 与 npm 真检索同类插件，挑出 3–5 个最适合的候选列给宿主，由宿主决定继续自研还是直接装一个现成的；产出 docs/01b-市场调研.md，收口前必须过门禁并由独立审查员审查。
when-to-use: 需求采访已收口（docs/01-需求.md 过了门禁与独立审查），还没进设计阶段；或用户问"这东西是不是已经有人做了 / 有没有现成的"的时候。
---

# 阶段一之后 · 现成插件调研

**目标：在写第一行代码之前，先回答一个问题——这件事是不是已经有人做完了，而且做得比我马上能写的更好？**

两条出路都合法，且都不丢人：

- 有更合适的现成插件 → 就用它，本项目到此为止。**这是省钱，不是失败。**
- 没有，或者差得远 → 把"为什么不用现成的"写下来，带着这个答案进设计。

**最贵的错误不是选错，而是根本没找。** 凭印象说一句"应该没有"，然后从零写一遍别人踩完的坑，是本模式最想拦住的那件事。

## 进入条件

`node $PC status` 显示 `stage=survey`。采访没过门禁的项目不许进这一阶段（顺序由 `pc.mjs` 强制）。

## 产出（唯一交付物）

`docs/01b-市场调研.md`，必须含这四个小节标题（门禁逐字检查）：

```markdown
# <项目名> 市场调研

## 检索记录
## 候选插件
## 结论
## 宿主确认
```

### 检索记录

每次真实查询一行，**带命中数**，以便别人照着重跑：

```markdown
- 查询：`dsh-plugin in:name sort:updated` → 41 个仓库，其中 6 个是同类
- 查询：`微信 通知 插件 dsh`（web_search）→ 3 条相关
- 查询：`topic:dsh-plugin notification` → 12 个
```

至少 **3 条**，且**角度不同**（见下面「四组查询」）。同名查询换个词不算新角度。

### 候选插件

3–5 个，**按贴合度排序**。第 1 名必须是"如果我要自研，就照它这个样子做"的那个。

```markdown
| # | 插件 | 仓库 / npm | 它解决什么 | 差在哪（对着 01-需求.md 的判据） | 许可 | 最近更新 | 装它的代价 |
|---|---|---|---|---|---|---|---|
| 1 | dsh-plugin-notify-sounds | github.com/BillCx330/… | 审批/提问/完成三路提示音 | 判据 2 的"自定义铃声"已满足；判据 4 的"仅 Windows"不满足 | MIT | 2026-10-17 | 零依赖；自更新会写 node_modules |
```

**「差在哪」这一列不许写"功能少""不够强大"这种空话。** 要对着 `docs/01-需求.md` 的成功判据一条一条说：哪条满足、哪条不满足、不满足的那条宿主能不能接受。

### 结论

一行写死，门禁逐字核对：

```markdown
决定：自研
```

取值只能是这三个之一：`决定：自研`、`决定：采用现成插件`、`决定：混合`。
后面跟 3–5 行理由。**选"自研"必须说清现成的为什么不够**——否则设计阶段和开发阶段的审查员都会把它当成缺少依据。

### 宿主确认

记录**宿主的决定**，不是你的推荐：

```markdown
选择：采用 dsh-plugin-notify-sounds（2026-10-19 19:40，宿主原话："先装它的，不够再说"）
```

## 怎么检索（别凭记忆）

工具顺序：`web_search` 找线索 → `web_fetch` 读 README → GitHub API 拿 star / 更新时间 / 许可。

GitHub 搜索 API **在国内可直连，不需要代理**：

```powershell
$q = [uri]::EscapeDataString('dsh-plugin in:name')
(Invoke-WebRequest "https://api.github.com/search/repositories?q=$q&sort=updated&per_page=20" -UseBasicParsing).Content |
  ConvertFrom-Json | ForEach-Object { $_.items } |
  ForEach-Object { "{0,5}★  {1}  {2}" -f $_.stargazers_count, $_.pushed_at, $_.full_name }
```

其他端点：

- 仓库元数据：`https://api.github.com/repos/<owner>/<repo>`
- 文件树：`https://api.github.com/repos/<owner>/<repo>/git/trees/main?recursive=1`
- 单个文件（推荐，稳）：`.../contents/<path>` + 请求头 `Accept: application/vnd.github.raw`
- npm 侧：`https://registry.npmjs.org/<包名>`，看版本数、创建时间、最后发布时间

**`raw.githubusercontent.com` 会间歇性连接重置**，别把整条链路压在它上面：拿到一个 `Recv failure` 就换 contents 或 `codeload.github.com/<owner>/<repo>/tar.gz/refs/heads/main` 下 tarball。

**四组查询，少一组都算没查全：**

1. **命名空间**：`dsh-plugin` / `dsh-` / `deepseek-harness` 作为仓库名、话题、npm 关键词
2. **功能词**：中文一遍、英文一遍（"音效提醒" 与 "notification sounds" 命中的是两批项目）
3. `topic:dsh-plugin`（这个部署的生态就靠这个话题聚合）
4. npm 侧按包名前缀搜（`https://registry.npmjs.org/-/v1/search?text=dsh-plugin&size=50`）

## 评分维度（按这个顺序吵，别按 star 排）

1. **贴不贴合判据** —— 对着 `docs/01-需求.md` 逐条打勾，这是唯一的一票否决项
2. **能不能装在这台机器上** —— 有没有 `dsh` 字段、peerDependencies 要求什么、声明适配哪个 dsh 版本；装的时候会不会被版本门禁拒
3. **活跃度** —— 最近提交、版本数、issue 有没有人回
4. **许可** —— MIT / Apache 好用；**没有许可等于不能改**
5. **代价** —— 零依赖还是要 native？要不要常驻进程？会不会往 `node_modules` 里写文件（pnpm 硬链接下会污染全局 store）？
6. **可维护性** —— 单人还是多人、代码读不读得动、有没有测试

**star 数不进评分。** 它衡量的是被看见的程度，不是贴合度。

## 怎么呈现给宿主

用 `ask_user_question`，**一次问完**，选项按推荐排序、每个选项一句话说清代价：

- 装 `<候选 1>`：一句话说清装上之后还差什么
- 装 `<候选 2>`
- 继续自研：一句话说清自研能拿到什么现成的没有
- 混合：先装 `<候选 1>`，不够再改；说清改它的成本（提 PR 还是本地 fork）

**表格要贴进对话里给宿主看，别只说"我查到几个，你要哪个"。** 宿主看不到你的检索过程，只看得到你贴出来的那几行。

## 宿主的两条答复，两种收法

### A. 采用现成插件

1. 结论写 `决定：采用现成插件`，候选表里把那行标成 `← 采用`
2. 走下面的收口四步
3. 收口之后：

```powershell
node $PC stage delivered --project <目录> --note "采用 <npm 包名>（<仓库地址>）"
```

这是本模式**唯一**允许跳过阶段的近路。门禁会核对文档里确实写着 `决定：采用现成插件`、并且 `--note` 写明了采用哪个，缺一样都跳不过去。

4. 用 `pc-plugin-installer` 装，按它的规矩分开读保存状态与激活结果、跑 `verify-install`、把"真机未经证实"的部分如实标出来
5. 把安装核对证据追加回 `01b`：装在哪个 Profile、什么版本、哪个路由或界面现象能证明它真的在跑

### B. 继续自研（或混合）

1. 结论写 `决定：自研` 或 `决定：混合`
2. 走下面的收口四步
3. `node $PC stage design --project <目录> --note "调研结论：自研"`

**"混合"意味着先装现成的当底座再改**，改法有两种，**现在就想清楚是哪一种**，别留到开发阶段临时决定：

- 给上游提 issue / PR —— 能长期跟着上游走，但慢
- 在本机 fork 一份改 —— 快，但从此刻起自己维护

## 这个阶段不许做的事

- **不许凭记忆列候选。** 每个候选都必须有本次会话真实取回的链接与元数据；记不清就重查，不许补一个"大概是"。
- **不许替宿主决定。** 你可以排序、可以推荐，但 `决定：` 那行来自宿主的答复。
- **不许把"搜不到"写成"没有"。** 搜不到也要 3 条检索记录 + 一行 `无合适候选：<理由>`。
- **不许在这一阶段写插件代码、建 bundle、装任何东西。** 装插件发生在收口之后的 A 路径第 4 步。
- **不许因为 star 多就推荐。** star 高的项目可能完全不贴你的需求。

## 收口（四步，顺序不能换）

1. 门禁：

```powershell
$PC = "$env:DSH_HOME\plugin-creator\gates\pc.mjs"
node $PC gate --stage survey --project <目录>
```

它查的是**可复算的事实**：检索记录 ≥ 3 条、候选 ≥ 3 行（或显式声明无合适候选）、结论写死成三个取值之一、宿主确认里有 `选择：`。

2. 派发独立审查员（`subagent`，只给路径，模板见 `plugin-creator`）。本轮证据清单就是 `docs/01b-市场调研.md` 自己。让它盯：候选是不是真查到的（链接能不能打开）、"差在哪"是不是对着判据说的、结论是不是宿主的而不是 agent 自己的、有没有漏掉明显该查的角度。派发按 `plugin-creator` 的**三段写法**（规则范围 / 已证事实 / 输出分级）。

3. 处理 Finding：阻断级清零；主要 / 次要写进文档并交回宿主确认。

4. 落快照，然后按 A / B 推进（保留几版在项目创建时已约定，这里不再问）：

```powershell
node $PC snapshot --project <目录> --stage survey
```
