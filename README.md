# 插件创造模式（plugin-creator）

> 一个把「做个 DSH 插件」变成**有证据的流水线**的 agent 模式：六阶段、每阶段独立审查、每阶段可回退。

```text
需求采访 → 现成插件调研 → 交互与运行时设计 → 拆计划 → 开发 → 检查与交付
```

| | |
|---|---|
| 类型 | DSH agent preset（模式）+ 一套确定性门禁脚本 |
| 平台 | Windows + PowerShell，Node.js ≥ 20 |
| 许可 | MIT |
| 它不做什么 | 不替你做设计判断；不伪造"已验证"；不跳过独立审查 |

一个自定义 DSH 模式 + 一条六阶段插件开发流水线。装完在模式下拉里会多出「**插件创造模式**」，
选中它就进入这条流水线：**需求采访 → 现成插件调研 → 交互与运行时设计 → 拆计划 → 开发 → 检查与交付**，
每个阶段都由**现场派发的独立审查员**和**确定性门禁脚本**收口，并且每个阶段都能回退到旧版。

## 为什么它值得一用

普通的"让 AI 写个插件"有三个反复出现的坑，这套东西是奔着它们去的：

- **写完说"应该能跑"** —— 这里"能不能用"只认真机现象，拿不到就写「未验证」。
- **自己审自己** —— 审查由 `subagent` 现场派发，全新上下文、只给路径、派发前后冻结哈希；文件被动过整轮作废。
- **从零开始造轮子** —— 需求谈完先去 GitHub / npm 找同类，把候选和"差在判据哪一条"列给宿主，由宿主决定自研还是直接装。

## 它靠什么保证做出来的东西真能跑

```
┌─────────────────────────────────────────────────┐
│ 调度层  skill plugin-creator（唯一入口）          │
│         判断项目走到哪一步，带你进对应阶段         │
├─────────────────────────────────────────────────┤
│ 流水线  pc-stage-1..5 + 1b（规则与标准，过程留白） │
│         需求采访 → 现成插件调研 → 交互与运行时设计  │
│         → 拆计划 → 开发 → 检查与交付              │
├─────────────────────────────────────────────────┤
│ 审核层  subagent 现场派发的独立审查员              │
│         全新上下文、只读、只递路径、只认证据       │
├─────────────────────────────────────────────────┤
│ 门禁层  gates/pc.mjs 确定性脚本链                 │
│         状态 快照回退 冻结核对 健康检查           │
│         脚手架 安装核对 格式守卫                  │
├─────────────────────────────────────────────────┤
│ 辅助    pc-goal-creator 起草 /goal 自驱指令       │
│         pc-plugin-installer 一句话装本地插件      │
└─────────────────────────────────────────────────┘
```

### 为什么需求谈完先去 GitHub 找现成的

需求一旦成形，第一个该问的问题不是"怎么实现"，而是"**是不是已经有人做完了，而且做得比我马上能写的更好**"。

所以在「需求采访」和「交互与运行时设计」之间插了一道 `survey` 阶段（skill `pc-stage-1b-survey`）：

1. 去 GitHub 与 npm 上**真检索**同类插件（四组查询：命名空间、功能词中英文、`topic:dsh-plugin`、npm 关键词），
   检索记录要写进 `docs/01b-市场调研.md`，**每条带查询式与命中数**，别人能照着复算。
2. 挑 3–5 个最适合的，**按贴合度排序**（star 不进评分），每个都要对着 `01-需求.md` 的判据说清"差在哪"。
3. 列给宿主看，宿主选：**继续自研** / **直接装一个现成的** / **先装再改**。
4. 选现成 → 门禁过了之后直接 `stage delivered`（本模式唯一允许跳过阶段的近路，门禁会核对文档里确实写着
   `决定：采用现成插件` 且有 `--note`），然后用 `pc-plugin-installer` 装并核对安装态。
5. 选自研 → `决定：自研`，并把"为什么不用现成的"带进设计阶段的取舍小节。

**"搜不到"不是"没有"**：查了三条都没有，也要留三条检索记录加一行 `无合适候选：<理由>`。
门禁查的是可复算的事实——检索记录 ≥ 3 条、候选 ≥ 3 行（或显式声明无候选）、结论写死成三选一、宿主确认里有 `选择：`。

### 审核层为什么不可替代

- 审查一律用 `subagent`（provider `spawn`，全新上下文），**绝不**用 `subagent_fork`（它继承父对话 = 自审）。
- 派发时只递**路径**：产出物绝对路径、`pc-review-protocol` 路径、本轮证据清单路径。不递摘要、不递推理、不递辩解。
- 审查员只读、只认文件和证据；路径给漏了它只能记一条 Finding，不能反过来问。
- 派发前后用 `gates/freeze.mjs` 冻结/核对产物哈希：**文件被动过，整轮作废重派**。
- 阻断级 Finding 必须清零，且修完要**重跑同一条证据**。

### 证据优先

装没装上看目录与清单（`verify-install` + 部署 `app.asar` 的真实包清单）；能不能用看真机
（Web UI 里真的渲染出来；模式是下拉里被选中**并且真的切过去**）。没证据的部分一律写「未验证」。

## 安装

**要求**：Windows + PowerShell（门禁脚本用到 PowerShell 的路径约定）、Node.js ≥ 20、已装 DeepSeek Harness 桌面端。

```powershell
git clone https://github.com/Xiaolin105-lab/dsh-plugin-creator.git 插件创造模式
cd 插件创造模式
node install.mjs --profile desktop      # profile 名按你的实际填，默认 desktop
```

> `install.mjs` 只做一件需要动 Profile 的事：把本模式作为**一行声明式 preset** 写进
> `%DSH_HOME%\profiles\<profile>\cordis.patch.yml`。写之前先跑门禁自检，写的时候带备份 + 原子替换 + 写前自检，写之后核对安装态。

它会：门禁自检 → 把运行时文件摊到 `%DSH_HOME%\plugin-creator\` → 往
`%DSH_HOME%\profiles\<profile>\cordis.patch.yml` 写入一行声明式 preset（带备份、原子替换、写前自检）
→ 核对安装态。任何一步不过就原样退出，绝不半装。

装完**如果界面没有立刻出现**，完全退出并重开一次 DeepSeek Harness（补丁层是启动时应用的；
长驻界面也可能直接热重载）。然后新建会话，在模式下拉里选中「插件创造模式」，
说一句「列出你现在的 skill」，应当看到 `plugin-creator`、六个阶段 skill 与三个辅助。

卸载：

```powershell
node install.mjs --uninstall        # 只删掉自己生成的那一段，其余补丁保留
```

### 另一种装法：走「插件经理」

```powershell
node install.mjs --bundle           # 生成 bundle/cordis.patch.yml
# 然后在能用的模式里：plugin_manager action=install_bundle target=<bundle 目录绝对路径>
```

两种方式写入的是同一行 id，**只能二选一**（同时存在会让加载器报重复 id，Profile 起不来）；
install.mjs 会检测并拒绝在半装状态下继续。详见 `bundle/README.md`。

## 日常怎么用

在插件创造模式里直接说人话，例如「给我做一个显示当前时间的挂件」。
路由 skill 会读 `.plugin-creator/state.json`，判断阶段并带你往下走。手动命令：

```powershell
$PC = "$env:DSH_HOME\plugin-creator\gates\pc.mjs"

node $PC status                                         # 我在哪一步
node $PC init --project <目录> --name <名> --kind ui     # 新项目
node $PC gate   --stage <阶段> --project <目录>          # 阶段收口门禁（退出码非 0 就是不过）
node $PC snapshot --project <目录> --stage <阶段> --keep 3
node $PC rollback --project <目录> --stage <阶段> --version v2
node $PC freeze  --project <目录> --tag before --round 1
node $PC verify-freeze --project <目录> --round 1
node $PC scaffold --out <目录> --name @local/my-widget --kind ui
node $PC verify-install --name @local/my-widget --target <目录>
node $PC guard --project <目录>
node $PC check                                          # 校验模式自身是否健康
```

每个阶段收口时它会落一份快照。**保留几版是项目开始时问一次的**（`init --keep`，默认 3 版），
阶段收口不再逐次追问；版本落在 `<项目>\.plugin-creator\versions\<阶段>\vN\`，带每个文件的 sha256。
要改约定就 `node $PC snapshot --stage <阶段> --keep <N>` 显式给一次。

## 目录结构

```
插件创造模式\
├── install.mjs               一键安装 / 卸载 / 生成 bundle 补丁
├── preset\
│   ├── preset.yml            展示元数据（id / name / description / order）
│   └── agent.cordis.yml      组装定义（= preset 行 config.plugins 原文，缩进 0）
├── skills\                   10 个流水线 skill + 辅助
│   ├── plugin-creator\               总路由（唯一入口）
│   ├── pc-stage-1-interview\         需求采访
│   ├── pc-stage-1b-survey\           现成插件调研（GitHub / npm 挑候选，宿主决定买不买）
│   ├── pc-stage-2-design\            交互与运行时设计
│   ├── pc-stage-3-plan\              拆计划
│   ├── pc-stage-4-develop\           开发
│   ├── pc-stage-5-verify-deliver\    检查与交付
│   ├── pc-review-protocol\           审查员作业协议
│   ├── pc-goal-creator\              起草 /goal 自驱指令
│   └── pc-plugin-installer\          一句话装本地插件
├── gates\                    门禁层（确定性脚本）
│   ├── pc.mjs                统一入口 / 阶段收口脚本链
│   ├── lib.mjs               共享库（含 vendor 的 js-yaml）
│   ├── asar.mjs              只读读部署 app.asar 的真实包清单
│   ├── check-preset.mjs      模式健康检查（行名可解析 + 与「创造模式」逐行对比）
│   ├── guard-format.mjs       格式守卫（BOM/CRLF/Tab/YAML/JSON/语法/frontmatter）
│   ├── syntax-check.cjs       批量脚本语法检查（一次进程编译全部文件，由 guard 派发）
│   ├── freeze.mjs            审查轮冻结与核对
│   ├── snapshot.mjs          分阶段快照与回退
│   ├── scaffold.mjs          最小可装可用 bundle 脚手架
│   └── verify-install.mjs    安装核对（并显式列出未验证项）
├── bundle\                   走「插件经理」装法的配置型 bundle
└── README.md                 本文件
```

安装后运行时目录是 `%DSH_HOME%\plugin-creator\`（`skills\`、`gates\`、`preset\`）。
skill 里的命令都按这个路径写，所以**不要**手工搬动它。

## 它怎么防住「模式出现在下拉里，一选中就加载失败」

这类故障的根因是：**声明注册成功 ≠ 组装能挂载**。声明行进了注册表（于是下拉里有它），
但选中时子插件逐行挂载，任何一行点名了一个不存在的包/子路径，整个模式就挂。

`gates/check-preset.mjs` 专门盯这条链：

1. 组装 YAML 必须能解析、是顶层数组、每行都有 `id` 与 `name`、`id` 不重复。
2. **每个行名都要在这台机器的部署里真实存在** —— 它直接读 `app.asar` 的真实包清单（511 个包），
   而不是相信字符串长得对。
3. **与本机正在工作的「创造模式」组装逐行对比** —— 只允许两处差异（`persona`、`skill-filesystem`）。
   少一行、改一个名字、去掉一个 `disabled` 门，都会 FAIL。
4. 本模式自己的硬要求：10 个 skill 全在、frontmatter 的 `name` 与目录一致、
   `skill-filesystem` 真的挂到了 `%DSH_HOME%\plugin-creator\skills`（表达式会被实际求值验证——
   写错的 `!!js` 是静默失败的高发区）。
5. Profile 补丁里那一行必须与组装定义逐行一致（装完之后防止补丁和源码漂移）。

再往后才是真机：模式在下拉里被**选中**并**真的切过去**。这一步只有人能完成，脚本会把这一点
显式列成「未验证项」，不允许被含糊地当成已验证。

## 它为什么快得起来（且没降标准）

门禁里最容易白白烧时间的不是检查本身，是**重复做同一件检查**。两处改动把这块成本压掉了：

| 改动 | 之前 | 之后 | 怎么保证结论不变 |
|---|---|---|---|
| `guard` 的脚本语法检查 | 每个文件一次 `node --check` 子进程（60 文件 **4.90 s**） | 一次进程批量编译（**0.24 s**） | 同一套 V8 解析器，失败信息逐条照样报；批量这条路跑不起来时自动退回逐文件 |
| `snapshot` 的存储 | 每版整树复制（300 文件 **4.67 s**） | 内容寻址对象库，同内容只存一次（首次 **0.63 s**，之后 **0.47 s**） | 回退逐字节还原（含二进制）；老 `tree/` 布局的快照照样能回退；对象只在没有任何版本引用时才回收 |
| `freeze` 的冻结集合 | 把 `docs/reviews/` 也算进去 → 每轮 `--check` 必然报"审查期间被新增" → **每轮作废重派，收敛不了** | `docs/reviews/` 排除在冻结之外 | 被审产物（`pkg/`、`docs/01..05`）一个不少；改代码照样作废 |

另外三处是**流程上的重复**，不是脚本的重复：

- **保留几版只问一次**（项目创建时），不再每阶段打断一次。
- **快照只在阶段收口落**，不再每个开发任务落一份——快照是回退点，不是任务日志。
- **纯文档改动不再走安装**（本来就没东西可装）。

**没有降低的部分**：独立审查、只递路径、冻结哈希、阻断清零、真机未验证照写「未验证」——一条都没动。

## 审查怎么省时间（2026-10-19）

实测：一次任务级审查 **232 秒**，而整条脚本链只有 **5 秒**——所以提速只能动审查。三处改动，都不削弱独立性：

| 改法 | 改前 | 改后（实测） |
|---|---|---|
| **`pc.mjs review-brief`（确定性简报）**：一条命令生成 `docs/reviews/brief-r<N>.md`，内含变更差量、门禁输出原文+指纹、阶段 skill 逐字摘录、判据摘录 | 审查员自己决定读什么，还会重跑门禁、翻 gates 源码 | **232.4 s → 68.3 s（3.4×）**，同一夹具同一模型 |
| **返工用复审模板**：只给上轮 Finding + 修复点差量，不再全量重派 | 232 s | 结构上更短（尚未实测） |
| **不复核已证事实**：简报里的命令**不许重跑**，只核对"是否覆盖规则要求" | 重跑门禁 + 读 5 个 gate 脚本源码 | 只核对覆盖 |
| **输出分级**：阻断/主要六字段，次要只写一行 | 9 条 Finding 全写六字段 | 次要项单行 |
| **可并行**：同一冻结点下互不相干的任务同时派发 | N×T | max(T)，但 token ×N |

> 关键对照：**只改措辞、不带简报**的那一次跑了 >375 秒仍未完（中断）。所以有效的是「确定性简报」这一味，不是措辞。

### 可选：深审（交付前那一次）

日常迭代用快审（实测约 68 秒）。但它有个已知盲区：**它信简报**，所以抓不到被改过的证据。

真要交付、或怀疑门禁本身有洞时，把终审升格为**深审**：

```powershell
node $PC review-brief --stage verify --project <目录> --round 99 --deep [--name <包名> --target <目录>]
```

| | 快审简报 | 深审简报（`--deep`） |
|---|---|---|
| 门禁输出 | 给原文，**不许重跑** | 不给，改成「**你必须自己重跑的这几条命令**」 |
| 前几轮结论 | 不出现 | 列成**待核实声明**（"这不是结论，是主张"） |
| gates 源码 | 不许读 | **允许且鼓励**，任务之一就是找「门禁没覆盖哪条规则」 |
| 六字段 | 次要一行 | 全部写全 |
| 耗时 | ≈68 秒 | ≈4–6 分钟 |

**默认不开。** 一句话：**快的用于日常迭代，深审用于交付前的那一次。**

```powershell
node $PC review-brief --stage develop --project <目录> --round 2 --name <包名> --target <目录>
```

配套还加了「规则范围」：审查员只读**协议 + 本阶段 skill**，不通读 `gates/*.mjs` 去还原门禁行为——门禁的行为由它自己的输出证明。

**没有放松的部分**：全新上下文、只递路径、冻结哈希、阻断清零、真机未验证照写「未验证」。

## 参与 / 自己改

```powershell
git clone https://github.com/Xiaolin105-lab/dsh-plugin-creator.git 插件创造模式
cd 插件创造模式

node gates/guard-format.mjs --mode-dir .   # 格式守卫（CI 跑的就是这条）
node gates/check-preset.mjs --mode-dir .   # 模式健康检查：要本机装了 DSH（读 app.asar 核实行名）
node make-manifest.mjs                     # 改了任何交付文件都要重算清单
```

三条规矩，都是门禁会拦的：

1. **换行符必须 LF**。`.gitattributes` 已经锁死；`guard` 遇到 `.yml/.js/.json` 里的 CRLF 会**直接失败**（不是警告）。
2. **改了交付文件就重算 `MANIFEST.sha256`**，否则 CI 的 `--check` 会红。那个指纹代表"这版交付的到底是哪份内容"。
3. **新 skill 的 frontmatter `name` 必须等于目录名**，`description` 非空——门禁逐字查。

CI（`.github/workflows/ci.yml`）只跑 `guard` + 脚本语法 + 清单一致性。它**不跑** `check-preset`：那要读本机部署的 `app.asar`，CI 机器上没有 DSH。

## 许可

MIT，见 [LICENSE](LICENSE)。

## 已知边界（别指望它做这些）

- 它不替你做设计判断：阶段 skill 只讲规则与标准，过程留白。
- 真机视觉验证需要浏览器控制或人来点一次；拿不到就如实标「未验证」，本模式不去找截图工具凑证据。
- 审查质量取决于审查员读到的路径是否给全；路径给漏了只会得到一条 Finding，而不是一个答案。
- `snapshot` 默认排除 `node_modules`/`.git`/`.plugin-creator`，且单文件超过 32 MiB 不纳入快照。
