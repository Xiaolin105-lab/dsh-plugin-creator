---
name: pc-plugin-installer
description: 插件创造模式的辅助 skill：一句话装本地插件。给一个目录或包名，走 plugin_manager 安装、分开读保存状态与激活结果、用 verify-install 核对安装态、并把真机验证与回退讲清楚。
when-to-use: 用户说"把这个插件装上 / 装到桌面端 / 重新装一下 / 卸掉它"，或者开发者刚写完一个 bundle 要装上试的时候。
---

# 辅助 · 一句话装本地插件

**"装上了"是三个独立事实：包被写进 Profile、插件行被激活、功能真的可用。只认第一个是最常见的自欺。**

## 本地 bundle（最常见）

1. **确认输入**：一个目录（含 `package.json` 且声明了 `dsh.bundle.patch`），或一个安装 spec。目录不对就先别装，报错比装一半干净。
2. **安装**：用 `plugin_manager`，`action: install_bundle`，`target` 传**目录绝对路径**（或 spec）。
   - 这个动作会执行 Profile 级、沙箱外的持久代码，需要完整访问权限或单次批准；批准一次不会改变会话权限模式。
   - 只有用户在本轮对话里明确同意了构建脚本，才传 `approvedBuilds`。
   - 先 `list_bundles` / `list_plugins` 拿到准确标识，别凭记忆猜名字。
3. **读返回，分开读**：
   - `applied`：写进去了。**不等于**生效。
   - `failed`：要诊断，不要重试同一份坏输入。
   - `overridden`：被更高优先级的层盖住了，这个包现在不起作用。
   - `restart-required`：**明确告诉用户要重启 Profile**，不要说"已经能用了"。
   - 新 bundle 有机会经 HMR 直接激活；替换已安装的包需要重启才能加载新的 JS 模块代。**不要**从"slot id 没变"推断浏览器代码已经更新。
4. **核对安装态**（可复现的目录级证据）：

```powershell
node "$env:DSH_HOME\plugin-creator\gates\pc.mjs" verify-install --name <包名> --target <目录>
```

5. **真机验证**：让用户在已连接的页面里看/点一次。拿不到浏览器控制就如实写"视觉未经证实"，不要去找截图工具、不要抠图、不要自建渲染器。
6. **报告**：装在哪个 Profile、什么版本、激活结果、一眼能看在哪、怎么卸载。

## 安装一个模式（agent preset）

模式不是 bundle，它是一行声明式 preset 行。本模式的安装器已经把它做完了：

```powershell
node "<插件创造模式包目录>\install.mjs" --profile desktop
node "<插件创造模式包目录>\install.mjs" --uninstall --profile desktop
```

装完核对：

```powershell
node "$env:DSH_HOME\plugin-creator\gates\pc.mjs" verify-install --kind mode --id plugin-creator
node "$env:DSH_HOME\plugin-creator\gates\pc.mjs" check
```

**模式的真机证据**：下拉里出现「插件创造模式」，并且**真的选中并切过去**开出一个会话——文件躺在磁盘上不算。

## 接 MCP server

建一个只含配置的 bundle：manifest 只需唯一 `name`、`version`、`dsh.bundle.patch`，补丁里插入已安装的 `@deepseek-ai/dsh-mcp-client`（`transport`、`url` 或 `command`/`args`）。安装后调用一个 `mcp__<serverName>__<tool>` 才算连上。凭据用 Loader 的 `!!js` 引用现有凭据，**绝不**把密钥抄进对话或代码。

## 卸载与回退

```powershell
# 卸载一个 bundle（target 用 list_bundles 里的准确包名）
plugin_manager  action=remove_bundle  target=<包名>
```

- 卸载后同样要核对：Profile 清单里没有了、组合文件里没有了、真机上效果消失。
- 版本回退用本模式的快照：`node $PC rollback --project <目录> --stage <阶段> --version vN`。
- 别用"再装一遍同名包"来修状态：先看清楚是 `overridden`、`failed` 还是 `restart-required`，对症再动。

## 铁律

- 一次只装一样东西，装完立刻核对，再装下一样。
- 没读返回就报成功，等于没装。
- `restart-required` 一律如实转达。
- 装不上时先看 `verify-install` 说的"哪个目录/清单里没有"，再决定改什么；不要反复重装同一个坏包。
