/**
 * 插件创造模式 · 门禁层共享库（gates/lib.mjs）
 *
 * 只依赖 Node 内置模块，加上同目录 `vendor/js-yaml.mjs`（js-yaml 4.2.0，MIT，见 vendor/js-yaml.LICENSE）。
 * 这一层是确定性脚本：没有网络、没有模型、没有任何"我看了一下应该没问题"。
 * 退出码约定：0 = 通过，1 = 门禁失败，2 = 用法错误。
 */
import { createHash } from 'node:crypto'
import {
  cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import yaml from './vendor/js-yaml.mjs'

export { yaml }

/** 本文件所在目录（gates/）。 */
export const GATES_DIR = dirname(fileURLToPath(import.meta.url))
/** 模式的安装根目录（gates/ 的上一级）。 */
export const MODE_DIR = dirname(GATES_DIR)
/** 模式自带 skill 的根目录。 */
export const SKILLS_DIR = join(MODE_DIR, 'skills')
/** 项目侧状态目录名。 */
export const STATE_DIR_NAME = '.plugin-creator'
/** 默认保留的历史版本数。 */
export const DEFAULT_KEEP = 3

/**
 * 六个阶段。id 用于状态与快照目录，skill 是该阶段的规则入口。
 *
 * `survey` 故意落在 interview 与 design 之间：把"这件事值不值得自己写"变成一道**有产出的关卡**，
 * 而不是设计阶段开头一句"顺便看了一眼"。skill 名带 `1b` 是权衡后的选择——改这一段序号要连带
 * 改四份 skill 名、全部交叉引用和既有项目文档里的路径引用，收益为零，风险不小。
 */
export const STAGES = [
  { id: 'interview', name: '需求采访', skill: 'pc-stage-1-interview', doc: 'docs/01-需求.md' },
  { id: 'survey', name: '现成插件调研', skill: 'pc-stage-1b-survey', doc: 'docs/01b-市场调研.md' },
  { id: 'design', name: '交互与运行时设计', skill: 'pc-stage-2-design', doc: 'docs/02-设计.md' },
  { id: 'plan', name: '拆计划', skill: 'pc-stage-3-plan', doc: 'docs/03-计划.md' },
  { id: 'develop', name: '开发', skill: 'pc-stage-4-develop', doc: 'docs/04-开发记录.md' },
  { id: 'verify', name: '检查与交付', skill: 'pc-stage-5-verify-deliver', doc: 'docs/05-验收.md' },
]
/** 合法阶段 id 序列（含终态 delivered）。 */
export const STAGE_IDS = [...STAGES.map((stage) => stage.id), 'delivered']
/** 本模式自带的 skill 名单（顺序即目录顺序）。 */
export const MODE_SKILLS = [
  'plugin-creator',
  'pc-stage-1-interview',
  'pc-stage-1b-survey',
  'pc-stage-2-design',
  'pc-stage-3-plan',
  'pc-stage-4-develop',
  'pc-stage-5-verify-deliver',
  'pc-review-protocol',
  'pc-goal-creator',
  'pc-plugin-installer',
]
/** 允许与参考组装不同的行：persona 是本模式的人设，skill-filesystem 挂本模式自己的 skill 目录。 */
export const ALLOWED_DEVIATIONS = {
  'persona': '本模式自己的流水线人设',
  'skill-filesystem': '额外挂载本模式的 skills/ 目录',
}
/** 允许出现的 Cordis 内建行名（不是 npm 包）。 */
export const BUILTIN_ROW_NAMES = ['cordis:group', 'cordis:include', 'cordis:plugin']

// ── 环境事实 ────────────────────────────────────────────────────────────────

/** DSH home：优先 DSH_HOME，其次 ~/.dsh。 */
export function dshHome() {
  return process.env.DSH_HOME && process.env.DSH_HOME.trim() !== ''
    ? resolve(process.env.DSH_HOME)
    : join(homedir(), '.dsh')
}

/** 当前 Profile 目录：优先 DSH_PROFILE_DIR，其次 <dshHome>/profiles/<DSH_PROFILE|desktop>。 */
export function profileDir() {
  if (process.env.DSH_PROFILE_DIR && process.env.DSH_PROFILE_DIR.trim() !== '') return resolve(process.env.DSH_PROFILE_DIR)
  const profile = process.env.DSH_PROFILE && process.env.DSH_PROFILE.trim() !== '' ? process.env.DSH_PROFILE : 'desktop'
  return join(dshHome(), 'profiles', profile)
}

/** 模式的安装根目录（默认 <dshHome>/plugin-creator）。 */
export function modeDir() {
  return process.env.PC_MODE_DIR && process.env.PC_MODE_DIR.trim() !== '' ? resolve(process.env.PC_MODE_DIR) : join(dshHome(), 'plugin-creator')
}

/** 本模式 skill 目录的绝对路径（被 preset 的 skill-filesystem 行引用）。 */
export function modeSkillsDir() {
  return join(modeDir(), 'skills')
}

/** 已安装的桌面/其它部署 app.asar 路径候选。 */
export function appAsarCandidates() {
  const candidates = []
  if (process.env.PC_APP_ASAR) candidates.push(resolve(process.env.PC_APP_ASAR))
  const local = process.env.LOCALAPPDATA
  if (local) candidates.push(join(local, 'Programs', 'DeepSeek Harness', 'resources', 'app.asar'))
  if (process.platform === 'darwin') candidates.push('/Applications/DeepSeek Harness.app/Contents/Resources/app.asar')
  candidates.push(join(homedir(), 'AppData', 'Local', 'Programs', 'DeepSeek Harness', 'resources', 'app.asar'))
  return candidates
}

// ── 命令行 ──────────────────────────────────────────────────────────────────

/**
 * 解析 `--key value` / `--key=value` / `--flag` 形式的参数。
 * @param {string[]} argv 原始参数（不含 node 与脚本名）
 * @returns {{_: string[], flags: Record<string, string|boolean|string[]>}}
 */
export function parseArgs(argv) {
  const positionals = []
  const flags = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) {
      positionals.push(token)
      continue
    }
    const equal = token.indexOf('=')
    if (equal !== -1) {
      addFlag(flags, token.slice(2, equal), token.slice(equal + 1))
      continue
    }
    const key = token.slice(2)
    const next = argv[index + 1]
    if (next !== undefined && !next.startsWith('--')) {
      addFlag(flags, key, next)
      index += 1
    } else {
      addFlag(flags, key, true)
    }
  }
  return { _: positionals, flags }
}

function addFlag(flags, key, value) {
  if (flags[key] === undefined) {
    flags[key] = value
    return
  }
  if (Array.isArray(flags[key])) {
    flags[key].push(value)
    return
  }
  flags[key] = [flags[key], value]
}

/** 把可能重复的 flag 归一成数组。 */
export function flagList(flags, key) {
  const value = flags[key]
  if (value === undefined || value === true) return []
  return Array.isArray(value) ? value : [value]
}

// ── 输出 ────────────────────────────────────────────────────────────────────

const counters = { pass: 0, fail: 0, warn: 0 }

/** 记一条通过。 */
export function pass(message) { counters.pass += 1; console.log(`[PASS] ${message}`) }
/** 记一条失败。 */
export function fail(message) { counters.fail += 1; console.log(`[FAIL] ${message}`) }
/** 记一条警告（不改变退出码）。 */
export function warn(message) { counters.warn += 1; console.log(`[WARN] ${message}`) }
/** 记一条说明。 */
export function info(message) { console.log(`[INFO] ${message}`) }
/** 记一条证据（命令、目录、清单事实）。 */
export function evidence(message) { console.log(`[EVIDENCE] ${message}`) }
/** 标题行。 */
export function title(message) { console.log(`\n=== ${message} ===`) }
/** 当前计数。 */
export function tally() { return { ...counters } }
/** 收尾：打印汇总并按失败数给出退出码（0/1）。 */
export function finish(label) {
  const result = counters.fail === 0 ? 'PASS' : 'FAIL'
  console.log(`\nRESULT ${result} — ${label} | pass=${counters.pass} fail=${counters.fail} warn=${counters.warn}`)
  return counters.fail === 0 ? 0 : 1
}
/** 用法错误：打印后以 2 退出。 */
export function usage(message) {
  console.error(`[USAGE] ${message}`)
  process.exit(2)
}

// ── 文件与哈希 ──────────────────────────────────────────────────────────────

/** 递归列出文件。 */
export function walkFiles(root, options = {}) {
  const skipDirs = new Set(options.skipDirs ?? ['.git', 'node_modules', STATE_DIR_NAME, 'dist', 'build', '.cache'])
  const maxBytes = options.maxBytes ?? Number.POSITIVE_INFINITY
  const out = []
  if (!existsSync(root)) return out
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue
        visit(full)
        continue
      }
      if (!entry.isFile()) continue
      const size = statSync(full).size
      if (size > maxBytes) continue
      out.push({ path: full, rel: relative(root, full).split(sep).join('/'), size })
    }
  }
  visit(root)
  out.sort((left, right) => left.rel.localeCompare(right.rel))
  return out
}

/** 字符串或 Buffer 的 sha256（十六进制，前 16 位足够做产物指纹）。 */
export function sha256(data) {
  return createHash('sha256').update(data).digest('hex')
}

/** 文件内容的 sha256。 */
export function hashFile(path) {
  return sha256(readFileSync(path))
}

/** 读文本（去掉 BOM，保留原始换行以便格式守卫检查）。 */
export function readText(path) {
  return readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
}

/** 读 JSON，失败时返回 fallback。 */
export function readJson(path, fallback = undefined) {
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(readText(path))
  } catch {
    return fallback
  }
}

/** 写 JSON（2 空格缩进 + 末尾换行）。 */
export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

/** 确保目录存在。 */
export function ensureDir(path) {
  mkdirSync(path, { recursive: true })
  return path
}

/** 复制目录树。 */
export function copyTree(from, to) {
  mkdirSync(dirname(to), { recursive: true })
  cpSync(from, to, { recursive: true, force: true })
}

/** 删除文件或目录（不存在时静默）。 */
export function removeTree(path) {
  rmSync(path, { recursive: true, force: true })
}

/** 原子写：先写临时文件再改名，避免半截文件被别的进程读到。 */
export function writeFileAtomic(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.tmp-${process.pid}`
  writeFileSync(temp, content, 'utf8')
  renameSync(temp, path)
}

// ── YAML ────────────────────────────────────────────────────────────────────

const jsTag = new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: (data) => ({ __js: String(data) }) })
const jsShortTag = new yaml.Type('!js', { kind: 'scalar', construct: (data) => ({ __js: String(data) }) })
/** 认识 `!!js` / `!js` 标签的 schema：标签值保留成 { __js: 表达式原文 }。 */
export const PC_SCHEMA = yaml.DEFAULT_SCHEMA.extend([jsTag, jsShortTag])

/** 解析一个 YAML 文件。 */
export function loadYamlFile(path) {
  return yaml.load(readText(path), { schema: PC_SCHEMA })
}

/** 解析 YAML 文本。 */
export function loadYamlText(text) {
  return yaml.load(text, { schema: PC_SCHEMA })
}

/** 取值：`!!js` 表达式取原文，其它原样。 */
export function jsSource(value) {
  return value !== null && typeof value === 'object' && typeof value.__js === 'string' ? value.__js : undefined
}

/**
 * 在沙箱里求值一个 `!!js` 表达式（门禁专用，绝不执行行内业务逻辑）。
 * 表达式里的 `baseUrl` 由调用方注入：preset 行的 baseUrl 是模式目录的 file URL。
 * @param {string} source 表达式原文（可含折行）
 * @param {Record<string, unknown>} scope 注入的变量
 * @returns {{ok: true, value: unknown}|{ok: false, error: string}}
 */
export function evaluateJs(source, scope = {}) {
  const flat = source.replace(/\s*\n\s*/g, ' ').trim()
  const names = Object.keys(scope)
  try {
    const fn = new Function(...names, `"use strict"; return (${flat});`)
    return { ok: true, value: fn(...names.map((name) => scope[name])) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

// ── 组装（preset / 插件行）──────────────────────────────────────────────────

/** 把插件行列表压平（含 group 的 config 子行），返回 {id, name, disabled, config, depth, hasChildren}。 */
export function flattenRows(rows, depth = 0, out = []) {
  if (!Array.isArray(rows)) return out
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue
    out.push({
      id: typeof row.id === 'string' ? row.id : undefined,
      name: typeof row.name === 'string' ? row.name : undefined,
      disabled: row.disabled,
      config: row.config,
      depth,
      hasChildren: Array.isArray(row.config),
    })
    if (Array.isArray(row.config)) flattenRows(row.config, depth + 1, out)
  }
  return out
}

/** 从一个 profile 组合文件里取出某个 preset 行的 plugins 列表。 */
export function presetPluginsFromProfile(profileYamlPath, presetRowId) {
  const tree = loadYamlFile(profileYamlPath)
  if (!Array.isArray(tree)) return undefined
  const row = tree.find((entry) => entry !== null && typeof entry === 'object' && entry.id === presetRowId)
  return row?.config?.plugins
}

/** 从 asar 路径名推断包名，例如 /dsh/node_modules/@deepseek-ai/dsh-tool-fs/lib/x.js → @deepseek-ai/dsh-tool-fs。 */
export function packageFromAsarPath(path) {
  const match = path.match(/\/node_modules\/((?:@[^/]+\/)?[^/]+)\/(package\.json|[^/]+\/package\.json)$/)
  return match === null ? undefined : match[1]
}

// ── 项目状态 ────────────────────────────────────────────────────────────────

/** 项目状态目录。 */
export function stateDir(projectDir) { return join(projectDir, STATE_DIR_NAME) }
/** 状态文件路径。 */
export function statePath(projectDir) { return join(stateDir(projectDir), 'state.json') }

/** 内容寻址对象库：同一份文件内容只存一次，供多次快照复用。 */
export function objectsDir(projectDir) { return join(stateDir(projectDir), 'objects') }

/**
 * 一个 sha256 对应的对象路径。
 *
 * 用哈希前两位分桶：单目录堆几万个文件在 Windows 上会让列目录明显变慢。
 * @param {string} projectDir 项目根
 * @param {string} sha 文件的 sha256（十六进制）
 * @returns {string} 对象文件的绝对路径
 */
export function blobPath(projectDir, sha) { return join(objectsDir(projectDir), sha.slice(0, 2), sha) }

/** 读项目状态。 */
export function readState(projectDir) {
  const state = readJson(statePath(projectDir))
  if (state === null || state === undefined) return undefined
  return state
}

/** 时间戳（本地时区，秒级，便于人读）。 */
export function stamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

/** 默认纳入快照/冻结的路径（项目根，除去状态目录与重型目录）。 */
export function trackedFiles(projectDir, extraSkip = [], maxBytes = 2 * 1024 * 1024) {
  return walkFiles(projectDir, {
    skipDirs: new Set(['.git', 'node_modules', STATE_DIR_NAME, 'dist', 'build', '.cache', ...extraSkip]),
    maxBytes,
  })
}

/** 把绝对路径缩成相对当前目录的短路径，便于输出。 */
export function short(path) {
  const rel = relative(process.cwd(), path)
  return rel === '' || rel.startsWith('..') ? path : rel
}

/** 目录是否像一个插件项目（有 package.json 或 preset.yml 或任意 .js）。 */
export function looksLikeProject(dir) {
  if (!existsSync(dir)) return false
  if (existsSync(join(dir, 'package.json'))) return true
  return walkFiles(dir, { maxBytes: 1024 }).length > 0
}

/** 目录名（去掉末尾分隔符）。 */
export function name(path) { return basename(path) }
