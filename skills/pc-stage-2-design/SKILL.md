---
name: pc-stage-2-design
description: 插件创造模式阶段二「交互与运行时设计」的规则与标准。先查真实 API 再画设计：把 Service/Event/Slot/Theme 的真实声明、挂载点、配置、失败降级与真机验证方案写进 docs/02-设计.md，并留下可核对证据。
when-to-use: 项目处在 design 阶段，或者正准备写代码但还没查过运行时接口的时候。进入本阶段的硬前提是 docs/01b-市场调研.md 的结论为「决定：自研」或「决定：混合」。
---

# 阶段二 · 交互与运行时设计

**目标：把需求翻译成本 Harness 真实存在的接口与落点，并且每条接口名都有 `cordis_inspect_query` 的原始输出作证。**
本阶段最贵的一句话是"我记得那个 Slot 叫 xxx"。

## 进来之前先看一眼调研结论

`docs/01b-市场调研.md` 里的 `决定：` 必须是 `自研` 或 `混合`。如果是 `采用现成插件`，本项目已经在上一步收尾了——别在这里继续设计。

**并把"为什么不用现成的"带进设计**：调研里排在前面那几个候选，各自差在需求的哪一条判据上，决定了这次要重点做什么。把这条取舍写进 `docs/02-设计.md` 的取舍小节；审查员会问它。

## 铁律：先查后写

任何 Service 名、Event 名、Tool 名、Theme token、Slot 名、注册选项、props，**必须来自只读查询**：

```powershell
# Host / Client 的提供方目录
cordis_inspect_list

# 精确契约（一次查一个，别猜）
cordis_inspect_query  platform=host   provider=Service method=listService input={"service":"<ServiceKey>"}
cordis_inspect_query  platform=host   provider=Event   method=listEvents  input={"event":"<event/name>"}
cordis_inspect_query  platform=host   provider=Config  method=listConfigs input={}
cordis_inspect_query  platform=host   provider=Tool    method=listTools
cordis_inspect_query  platform=client provider=Slots   method=listSubTree input={}
cordis_inspect_query  platform=client provider=Slots   method=listSubTree input={"root":"<slot 名>"}
cordis_inspect_query  platform=client provider=Theme   method=listTokens
```

- 查询是只读的，不会调用任何业务方法；也**绝不能**把 Inspect 当成业务 Service 来用。
- 不要靠读 Loader/React/Slot 的实现源码来"研究"接口；源码级诊断只从一次具体的安装或运行时失败开始。
- 需要写已安装插件的代码细节时，加载 `cordis-plugin-development`（含 `references/` 与 `templates/`）。

## 产出

`docs/02-设计.md`，必须含这些小节（门禁逐字检查前两个）：

```markdown
# <项目名> 设计

## 形态与半边
## 运行时接口证据（cordis_inspect_query）
## 挂载点与交互
## 配置（Config schema 与默认值）
## 失败与降级
## 生命周期与清理
## 文案、主题与可访问性
## 安装形态
## 真机验证方案
```

### 各小节标准

- **形态与半边**：本地 bundle 的 Host 半边（`index.js`：`apply`/Service/`inject`/`Config` 只选一种形式）与 Client 半边（`client.js`：`window.__ModuleLoader__.load({ id: '<包名>', factory… })`，工厂里不许有副作用）。纯 UI 插件也要写清 Host 半边是否为空 `apply(){}`。
- **运行时接口证据**：把**查询命令 + 关键返回片段**贴进来。至少覆盖：你要注入的 Slot（名字、props、注册选项）、你要读/写的 Service 与其方法签名、你要订阅的 Event 名与模式。没查到就不许往下写。
- **挂载点与交互**：选哪个 Slot、为什么（空间是否已分配、是否在流程里）、`order` 值、用户动作 → 状态变化 → 可见反馈的完整链路。**不要**去读别的插件的 DOM/样式来估算位置。
- **配置**：`Config` schema 字段、类型、默认值、非法值怎么办；需要用户填的东西写清格式。密钥类一律走 Loader 的 `!!js` 引用现有凭据，绝不把秘密写进对话或代码。
- **失败与降级**：接口拿不到、安装失败、`plugin_manager` 返回 `failed`/`overridden`/`restart-required` 时分别怎么办；有没有可用的降级路径。
- **生命周期与清理**：所有资源（定时器、监听器、样式、订阅）都在 `apply` 里用 `ctx.effect`/`ctx.on` 注册并返回清理函数；卸载后不留痕迹。
- **文案、主题与可访问性**：用户可见文案走 Client locale 服务；容器与控件继承 Host 主题 token（艺术图形可以用自己的颜色）；不要替换应用根节点、不要往 `document.body` 追加第二个应用。
- **安装形态**：bundle 的 `package.json`（`dsh.bundle.patch`、UI 插件还要 `dsh.client`）、补丁里的行 id 与包名、需要哪个 Profile、是否会影响其它会话。
- **真机验证方案**：一条条写清"怎么证明它能用"，例如"在已连接的页面里点击 X，观察 Y"；并写明如果浏览器控制不可用，验证将止步于哪一步（JS 语法 + manifest + 运行时注册），以及**明确标注"视觉未经证实"**。

## 这个阶段不许做的事

- 不许写实现代码（只允许写文档与查询）。
- 不许把没查到的接口名写进文档。
- 不许发明 Slot：查不到就换一个已分配的 Slot，或者把需求退回阶段一。
- 不许在文档里承诺"顺便优化一下"这类没有验收方法的活。

## 收口

```powershell
$PC = "$env:DSH_HOME\plugin-creator\gates\pc.mjs"
node $PC gate --stage design --project <目录>
```

派发独立审查员（`subagent`，只给路径，按 `plugin-creator` 的**三段写法**：规则范围 / 已证事实 / 输出分级）。本轮让审查员重点核对：**文档里每个接口名是否都能在 `cordis_inspect_query` 的输出里找到**、挂载点是否真实存在、失败路径是否覆盖、验证方案是否可执行。审查完 `verify-freeze`，然后落快照并推进（保留策略在项目创建时已约定，不再问）：

```powershell
node $PC snapshot --project <目录> --stage design
node $PC stage plan --project <目录> --note "设计已定，开始拆任务"
```
