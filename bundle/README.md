# bundle · 用「插件经理」安装的模式包

这个目录是给 **plugin_manager**（界面里的插件经理 / 设置里的插件）用的配置型 bundle：
它没有 Host/Client 代码，只有一份补丁，往当前 Profile 里插入一行声明式 preset —— 也就是「插件创造模式」。

## 先读这条（很重要）

`cordis.patch.yml` 是 **install.mjs 生成物**，不要手改。生成命令：

```powershell
node "<插件创造模式包目录>\install.mjs" --bundle
```

## 安装

在**已经能用的模式**（例如「创造模式」）里，让 agent 调：

```
plugin_manager  action=install_bundle  target=<这个 bundle 目录的绝对路径>
```

安装完读它的返回：`applied` 只说明写进去了；`restart-required` 要重启 Profile；`failed` 要诊断。
之后核对：

```powershell
node "$env:DSH_HOME\plugin-creator\gates\pc.mjs" verify-install --kind mode --id plugin-creator
```

## ⚠️ 与 install.mjs 的补丁层互斥

两种安装方式都会写入同一行 id（`preset-plugin-creator`）与同一个 preset id（`plugin-creator`）。
**同时存在两份会让加载器报重复 id，Profile 起不来。** 所以：

- 用 `install.mjs` 装过 → 先用 `node install.mjs --uninstall` 清掉，再考虑 bundle。
- 用 bundle 装过 → 先 `plugin_manager remove_bundle target=@local/dsh-plugin-creator-mode`，再用 `install.mjs`。

install.mjs 会主动检测并拒绝在半装状态下继续。

## 为什么还需要 install.mjs

bundle 路径要经过插件经理（需要完整访问权限的批准），而 install.mjs 走的是 Profile 用户补丁层
（长驻界面会热重载），两者达到的是同一个效果。你只需要**其中一种**：

| 方式 | 需要人做什么 | 生效时机 |
|---|---|---|
| `install.mjs` | 无（它就是脚本） | 补丁层热重载；没生效就重启 |
| bundle + `plugin_manager` | 批准一次完整访问 | 新 bundle 有机会经 HMR 直接激活，否则重启 |
