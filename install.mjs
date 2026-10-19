// 插件创造模式 · 一键安装 / 卸载
//
// 它只做一件需要动到 Profile 的事：把「插件创造模式」作为一个声明式 preset 行写进
// <DSH_HOME>/profiles/<profile>/cordis.patch.yml（用户补丁层，长驻界面会热重载）。
// 写之前先跑门禁自检；写的时候原子替换；写之后核对。任何一步不过就原样退回，绝不半装。
//
// 用法：
//   node install.mjs [--profile desktop] [--dry-run] [--force]
//   node install.mjs --uninstall [--profile desktop]
//   node install.mjs --bundle            # 只生成 bundle/cordis.patch.yml（给 plugin_manager 用）
//
// 退出码：0 成功 / 1 失败 / 2 用法错误。
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { PC_SCHEMA, loadYamlText } from './gates/lib.mjs'

const PACK_DIR = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const value = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 || args[index + 1] === undefined ? fallback : args[index + 1]
}

const dshHome = resolve(process.env.DSH_HOME && process.env.DSH_HOME.trim() !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh'))
const profile = String(value('profile', process.env.DSH_PROFILE ?? 'desktop'))
const profileDir = join(dshHome, 'profiles', profile)
const patchPath = join(profileDir, 'cordis.patch.yml')
const modeDir = join(dshHome, 'plugin-creator')
const PRESET_ROW_ID = 'preset-plugin-creator'
const PRESET_ID = 'plugin-creator'
const dryRun = flag('dry-run')

let failures = 0
const pass = (m) => console.log(`[PASS] ${m}`)
const fail = (m) => { failures += 1; console.log(`[FAIL] ${m}`) }
const warn = (m) => console.log(`[WARN] ${m}`)
const info = (m) => console.log(`[INFO] ${m}`)
const title = (m) => console.log(`\n=== ${m} ===`)

console.log(`[INFO] PACK_DIR   ${PACK_DIR}`)
console.log(`[INFO] DSH_HOME   ${dshHome}`)
console.log(`[INFO] Profile    ${profileDir}`)
console.log(`[INFO] 模式目录   ${modeDir}`)
console.log(`[INFO] 补丁层     ${patchPath}`)

if (!existsSync(profileDir)) {
  console.log(`[USAGE] Profile 目录不存在：${profileDir}`)
  process.exit(2)
}

// ── 1. 自检：先证明要装的东西是对的 ─────────────────────────────────────────

title('第一步：门禁自检（先证明，再安装）')
const gatesDir = join(PACK_DIR, 'gates')
const targetProfileDir = join(dshHome, 'profiles', profile)
const targetPatchPath = join(targetProfileDir, 'cordis.patch.yml')

/**
 * 找一份"已经物化好的组合树"当参考，用来做与「创造模式」的逐行对比。
 * 目标 profile 自己可能还没物化（例如 web 的 cordis.yml 是空壳），所以在所有 profile 里找一个
 * 含 `preset-cordis` 的即可——它代表这个部署真实加载过的那份创造模式组装。
 */
function referenceCordis() {
  const candidates = []
  if (process.env.DSH_PROFILE_DIR) candidates.push(join(process.env.DSH_PROFILE_DIR, 'cordis.yml'))
  const profilesRoot = join(dshHome, 'profiles')
  if (existsSync(profilesRoot)) {
    for (const entry of readdirSync(profilesRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) candidates.push(join(profilesRoot, entry.name, 'cordis.yml'))
    }
  }
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    try {
      if (readFileSync(candidate, 'utf8').includes('id: preset-cordis')) return candidate
    } catch { /* 读不动就试下一个 */ }
  }
  return undefined
}

const reference = referenceCordis()
if (reference !== undefined) console.log(`[INFO] 参考组装（创造模式）${reference}`)
else console.log('[WARN] 找不到已物化的创造模式组合树，本次跳过逐行对比')

const check = spawnSync(process.execPath, [
  join(gatesDir, 'check-preset.mjs'), '--mode-dir', PACK_DIR, '--profile-patch', targetPatchPath,
  ...reference === undefined ? [] : ['--profile-cordis', reference],
], { stdio: 'inherit' })
if (check.status !== 0) {
  fail('模式健康检查未通过：先修 check-preset 报出来的问题，再安装')
  process.exit(1)
}
pass('模式健康检查通过')

const guard = spawnSync(process.execPath, [join(gatesDir, 'guard-format.mjs'), '--mode-dir', PACK_DIR], { stdio: 'inherit' })
if (guard.status !== 0) {
  fail('格式守卫未通过')
  process.exit(1)
}
pass('格式守卫通过')

// ── 2. 摊开运行时文件到 <DSH_HOME>/plugin-creator ───────────────────────────

function copyDir(from, to) {
  mkdirSync(to, { recursive: true })
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, entry.name)
    const target = join(to, entry.name)
    if (entry.isDirectory()) copyDir(source, target)
    else copyFileSync(source, target)
  }
}

if (!flag('bundle')) {
  title('第二步：把运行时文件摊到 DSH_HOME')
  if (dryRun) {
    info(`[dry-run] 会写入 ${modeDir}/{skills,gates,preset,README.md}`)
  } else {
    copyDir(join(PACK_DIR, 'skills'), join(modeDir, 'skills'))
    copyDir(join(PACK_DIR, 'gates'), join(modeDir, 'gates'))
    copyDir(join(PACK_DIR, 'preset'), join(modeDir, 'preset'))
    if (existsSync(join(PACK_DIR, 'README.md'))) copyFileSync(join(PACK_DIR, 'README.md'), join(modeDir, 'README.md'))
    const skills = readdirSync(join(modeDir, 'skills'), { withFileTypes: true }).filter((e) => e.isDirectory()).length
    pass(`运行时文件就位：${modeDir}（skills ${skills} 个）`)
  }
}

// ── 3. 生成/更新补丁层里的 preset 行 ────────────────────────────────────────

/** 读取补丁层为 {entries: any[], text: string}；文件不存在时给一个空壳。 */
function readPatch() {
  if (!existsSync(patchPath)) return { exists: false, text: '' }
  return { exists: true, text: readFileSync(patchPath, 'utf8') }
}

/** 把安装定义缩进 6 格，包成 `- insert: [ ... ]` 的一段。 */
function presetBlock() {
  const definition = readFileSync(join(PACK_DIR, 'preset', 'agent.cordis.yml'), 'utf8')
  const meta = loadYamlText(readFileSync(join(PACK_DIR, 'preset', 'preset.yml'), 'utf8'))
  const name = typeof meta?.name === 'string' ? meta.name : '插件创造模式'
  const description = typeof meta?.description === 'string' ? meta.description : ''
  const order = meta?.order ?? 5
  // plugins: 在 config 下（8 空格），它下面的序列项必须再深一级（10 空格）
  const body = definition.split(/\r?\n/).map((line) => (line.trim() === '' ? '' : `          ${line}`)).join('\n').replace(/\s+$/, '')
  return [
    '- insert:',
    `    - id: ${PRESET_ROW_ID}`,
    "      name: '@deepseek-ai/dsh-agent-preset'",
    '      config:',
    `        id: ${PRESET_ID}`,
    `        name: ${name}`,
    `        description: ${description}`,
    `        order: ${order}`,
    '        plugins:',
    body,
  ].join('\n')
}

const MARK_START = `# >>> 插件创造模式 install.mjs 生成区（勿手改）${PRESET_ID}`
const MARK_END = `# <<< 插件创造模式 install.mjs 生成区 ${PRESET_ID}`

/**
 * 去掉上一次生成的区块，并按需修正"空文档标记"。
 *
 * 两件必须同时成立的事：
 *  1. 顶层 `[]`（profile 模板里的空补丁列表）在**追加**前必须去掉，否则文件里会出现两个根节点，
 *     YAML 直接非法——写前自检会在这一步拦下来。
 *  2. **删除**生成区之后若只剩注释，必须补回一个 `[]`：注释-only 的文件解析成 undefined，
 *     而加载器要求"顶层必须是数组"，那样会让整个 profile 起不来。
 * @param {string} text 现有补丁文本
 * @param {boolean} ensureEmptyMarker 剩余内容为空时是否补 `[]`（卸载时为 true）
 * @returns {string} 处理后的文本（以换行结尾）
 */
function stripGenerated(text, ensureEmptyMarker) {
  const start = text.indexOf(MARK_START)
  const withoutBlock = start === -1
    ? text
    : (() => {
      const end = text.indexOf(MARK_END)
      const tail = end === -1 ? '' : text.slice(end + MARK_END.length)
      return `${text.slice(0, start)}${tail}`
    })()
  // 只去掉顶层（顶格）的 []：缩进的 [] 是嵌套值，不能动
  const lines = withoutBlock.split(/\r?\n/).filter((line) => !(line === '[]' || (line.trim() === '[]' && line === line.trimStart())))
  const meaningful = lines.filter((line) => line.trim() !== '' && !line.trim().startsWith('#'))
  if (meaningful.length === 0 && ensureEmptyMarker) lines.push('[]')
  return `${lines.join('\n').replace(/\s+$/, '')}\n`
}

if (flag('uninstall')) {
  title('卸载：只删掉本模式生成的那一段')
  const patch = readPatch()
  if (!patch.exists) {
    warn(`补丁层不存在：${patchPath}`)
  } else if (!patch.text.includes(MARK_START)) {
    warn('补丁层里没有本模式生成的区块（可能本来就没装，或是手工装的）')
  } else if (dryRun) {
    info('[dry-run] 会移除生成区并保留其余补丁')
  } else {
    const next = stripGenerated(patch.text, true)
    writeFileSync(`${patchPath}.bak-${Date.now()}`, patch.text, 'utf8')
    writeFileSync(patchPath, next, 'utf8')
    pass('已移除生成区（原文件已备份为 .bak-<时间戳>）')
  }
  console.log(`\n[INFO] 建议顺手删掉运行时目录：${modeDir}（可选；删了模式就取不到流水线 skill）`)
  console.log(failures === 0 ? '\nRESULT PASS — 卸载' : '\nRESULT FAIL — 卸载')
  process.exit(failures === 0 ? 0 : 1)
}

if (flag('bundle')) {
  title('只生成 bundle 补丁（给 plugin_manager install_bundle 用）')
  const bundleDir = join(PACK_DIR, 'bundle')
  mkdirSync(bundleDir, { recursive: true })
  const text = `${MARK_START}\n${presetBlock()}\n${MARK_END}\n`
  writeFileSync(join(bundleDir, 'cordis.patch.yml'), text, 'utf8')
  pass(`已写出 ${join(bundleDir, 'cordis.patch.yml')}`)
  info('安装：在 创造模式 / 本模式下让 agent 调 plugin_manager install_bundle，target 传 bundle 目录绝对路径。')
  process.exit(0)
}

title('第三步：写入 Profile 补丁层')

// 互斥保护：bundle 路径与补丁层路径会写同一行 id，同时存在会让加载器报重复 id
const profileManifestPath = join(profileDir, 'package.json')
if (existsSync(profileManifestPath)) {
  try {
    const manifest = JSON.parse(readFileSync(profileManifestPath, 'utf8'))
    if (manifest?.dependencies?.['@local/dsh-plugin-creator-mode'] !== undefined) {
      fail('这个 Profile 已经用 bundle 方式装了本模式（@local/dsh-plugin-creator-mode）。')
      fail('请先卸载 bundle（plugin_manager remove_bundle target=@local/dsh-plugin-creator-mode），再跑本脚本；')
      fail('否则同一行 id 会出现两次，Profile 起不来。')
      process.exit(1)
    }
  } catch {
    warn('Profile package.json 读不动，跳过互斥检查')
  }
}

const patch = readPatch()
const block = `${MARK_START}\n${presetBlock()}\n${MARK_END}\n`
const base = stripGenerated(patch.text, false)
const nextText = `${base.replace(/\s+$/, '')}\n\n${block}`
if (patch.exists && patch.text.includes(MARK_START) && !flag('force')) info('检测到已安装：本次为更新（会先移除旧区块再写入）')

// 写之前先验证：新文本必须是合法 YAML，且恰好只多出我们这一行
let patchValid = true
try {
  const patches = loadYamlText(nextText)
  if (!Array.isArray(patches)) throw new Error('顶层不是数组')
  const inserted = []
  for (const entry of patches) for (const row of (entry && entry.insert) || []) inserted.push(row)
  const mine = inserted.filter((row) => row && row.config && row.config.id === PRESET_ID)
  if (mine.length !== 1) throw new Error(`preset 行数量异常：${mine.length}`)
  const plugins = mine[0].config.plugins
  if (!Array.isArray(plugins) || plugins.length < 15) throw new Error(`组装行数异常：${Array.isArray(plugins) ? plugins.length : 'not-array'}`)
  const rowNames = plugins.filter((row) => row && typeof row === 'object' && row.name).length
  pass(`新补丁自检通过：${patches.length} 个补丁条目，${plugins.length} 行组装（其中 ${rowNames} 行有名）`)
} catch (error) {
  patchValid = false
  fail(`新补丁自检失败，未写入任何东西：${error instanceof Error ? error.message : String(error)}`)
}
if (!patchValid) process.exit(1)

if (dryRun) {
  info('[dry-run] 不会写入')
} else {
  if (patch.exists) {
    const backup = `${patchPath}.bak-${Date.now()}`
    copyFileSync(patchPath, backup)
    pass(`已备份原补丁：${backup}`)
  }
  const temp = `${patchPath}.tmp-${process.pid}`
  writeFileSync(temp, nextText, 'utf8')
  renameSync(temp, patchPath)
  pass(`已写入 ${patchPath}`)
}

// ── 4. 核对安装态 ───────────────────────────────────────────────────────────

title('第四步：核对')
const verifyInstall = spawnSync(process.execPath, [
  join(gatesDir, 'verify-install.mjs'), '--kind', 'mode', '--id', PRESET_ID,
  '--profile', profile, '--mode-dir', dryRun ? PACK_DIR : modeDir,
], { stdio: 'inherit' })
if (verifyInstall.status !== 0) fail('安装核对未通过')

title('完成')
pass('接下来只有人能完成的那一步：')
console.log('  1) 如果界面没有立刻出现：完全退出并重开 DeepSeek Harness（补丁层是启动时应用的）。')
console.log('  2) 新建会话，在模式下拉里选中「插件创造模式」。')
console.log('  3) 在新会话里说一句「列出你现在的 skill」，应该看到 plugin-creator、六个阶段 skill 与三个辅助。')
console.log(`  卸载：node "${join(PACK_DIR, 'install.mjs')}" --uninstall --profile ${profile}`)
console.log(failures === 0 ? '\nRESULT PASS — 安装插件创造模式' : `\nRESULT FAIL — 安装（${failures} 项未通过）`)
process.exit(failures === 0 ? 0 : 1)
