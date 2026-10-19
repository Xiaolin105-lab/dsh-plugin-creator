#!/usr/bin/env node
/**
 * 插件创造模式 · 插件脚手架（gates/scaffold.mjs）
 *
 * 只做一件确定性的事：把一个"最小可装可用"的本地 bundle 摊到磁盘上，格式已经是对的，
 * 让开发者与审查员从一个能安装的基线出发，而不是从一段想象出来的 YAML 出发。
 *
 * 用法：
 *   node scaffold.mjs --out <目录> --name <包名> [--kind host|ui] [--slot <slot 名>] [--force]
 * 退出码：0 成功 / 1 失败 / 2 用法错误。
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { evidence, fail, finish, info, parseArgs, pass, title, usage, warn, writeJson } from './lib.mjs'

const { flags } = parseArgs(process.argv.slice(2))
if (flags.name === undefined) usage('需要 --name <包名>，例如 @local/my-decoration')
const outDir = resolve(String(flags.out ?? process.cwd()))
const packageName = String(flags.name)
const kind = String(flags.kind ?? 'ui')
const slot = String(flags.slot ?? 'conversation.composer.dock')
const force = flags.force === true

if (!/^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(packageName)) {
  usage(`包名不合法：${packageName}（小写、可带 @scope/，只允许 . _ -）`)
}
if (!['host', 'ui'].includes(kind)) usage(`--kind 只接受 host 或 ui，收到 ${kind}`)
if (existsSync(outDir) && readdirSync(outDir).length > 0 && !force) {
  fail(`目标目录非空：${outDir}（要覆盖请加 --force）`)
  process.exit(finish('脚手架'))
}
mkdirSync(outDir, { recursive: true })

const rowId = packageName.split('/').pop().replaceAll('_', '-').replaceAll('.', '-')

const manifest = {
  name: packageName,
  version: '1.0.0',
  private: true,
  type: 'module',
  ...kind === 'ui' ? { exports: { '.': './index.js', './client': './client.js' } } : { exports: { '.': './index.js' } },
  dsh: {
    bundle: { patch: './cordis.patch.yml' },
    ...kind === 'ui'
      ? { client: { platform: 'web', immediately: true, inject: ['@deepseek-ai/dsh-client-ui-conversation'] } }
      : {},
  },
}
writeJson(join(outDir, 'package.json'), manifest)

writeFileSync(join(outDir, 'cordis.patch.yml'), `# 本 bundle 的补丁层：把插件行插进当前 Profile 的组合。
# 安装：plugin_manager install_bundle，target 用本目录的绝对路径。
- insert:
    - id: ${rowId}
      name: '${packageName}'
`, 'utf8')

writeFileSync(join(outDir, 'index.js'), `/** ${packageName} 的 Host 半边。 */
export function apply() {
  // 有行为时在这里注册：ctx.effect / ctx.on / ctx.tools.register ...
}
`, 'utf8')

if (kind === 'ui') {
  writeFileSync(join(outDir, 'client.js'), `/** ${packageName} 的浏览器半边：懒工厂，id 必须等于包名。 */
window.__ModuleLoader__.load({
  id: '${packageName}',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    function View() {
      return h('div', { style: { padding: '4px 0' } }, '${rowId}')
    }
    return {
      inject: ['slots'],
      apply(ctx) {
        // 资源一律在 apply 里注册，并返回清理函数。
        ctx.slots.inject('${slot}', () => ctx.slots.register({
          name: '${slot}', id: '${rowId}', order: 5,
        }, View))
      },
    }
  },
})
`, 'utf8')
}

writeFileSync(join(outDir, 'README.md'), `# ${packageName}

本目录由「插件创造模式」的脚手架生成：一个最小可装可用的本地 bundle。

- 安装：\`plugin_manager install_bundle\`，target 传本目录的绝对路径。
- 已安装证据：\`node <模式目录>/gates/pc.mjs verify-install --name ${packageName} --target "${outDir}"\`
- 半边：${kind === 'ui' ? `Host \`index.js\` + Client \`client.js\`（挂载点 ${slot}）` : 'Host `index.js`'}

安装成功后先跑一遍上面的 verify-install，再谈功能。**安装结果 = 保存状态 + 激活结果，分开读。**
`, 'utf8')

title('插件创造模式 · 脚手架')
pass(`已生成 ${packageName}（kind=${kind}）`)
for (const file of ['package.json', 'cordis.patch.yml', 'index.js', ...kind === 'ui' ? ['client.js'] : [], 'README.md']) {
  evidence(`  ${join(outDir, file)}`)
}
info(`行 id：${rowId}${kind === 'ui' ? `｜挂载点：${slot}` : ''}`)
info('下一步：把真实的 Service/Event/Slot 声明用 cordis_inspect_query 查清楚，再动这些文件。')
warn('脚手架生成的是"能装"的骨架，不是"能用"的实现：功能必须自己写，并留下真机证据。')
process.exit(finish('脚手架'))
