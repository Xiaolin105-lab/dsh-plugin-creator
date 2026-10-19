#!/usr/bin/env node
/**
 * 插件创造模式 · 模式健康检查（gates/check-preset.mjs）
 *
 * 这是"看着成了其实没成"的第一道闸。它回答三个问题，每个都必须有文件或清单作证：
 *   1. 这个模式的组装本身合法吗？（YAML 能解析、每行有 id 与 name、id 不重复）
 *   2. 组装里点名的每个包，在这个部署里真的存在吗？（读部署 app.asar 的真实包清单）
 *   3. 它和这台机器上**正在工作**的「创造模式」组装比，多了或少了什么？（读 profile 的组合文件）
 * 再加两条本模式自己的硬要求：自带 skill 全部就位，skill-filesystem 真的挂到了本模式的 skills 目录。
 *
 * 用法：
 *   node check-preset.mjs [--definition <agent.cordis.yml>] [--meta <preset.yml>]
 *                         [--mode-dir <目录>] [--profile-cordis <cordis.yml>]
 *                         [--reference-preset <profile 里的 preset 行 id>]
 *                         [--app-asar <app.asar>] [--allow <行 id>]... [--json]
 * 退出码：0 通过 / 1 失败 / 2 用法错误。
 */
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  BUILTIN_ROW_NAMES, GATES_DIR, MODE_DIR, MODE_SKILLS, PC_SCHEMA, SKILLS_DIR,
  appAsarCandidates, dshHome, evaluateJs, evidence, fail, finish, flagList, flattenRows,
  info, jsSource, loadYamlFile, loadYamlText, modeDir, modeSkillsDir, parseArgs, pass, profileDir,
  readText, title, usage, warn, yaml,
} from './lib.mjs'
import { collectPackageNames, openAsar, splitRowName } from './asar.mjs'
import { existsSync as exists } from 'node:fs'

const { flags } = parseArgs(process.argv.slice(2))
const allowExtra = new Set(flagList(flags, 'allow'))
const asJson = flags.json === true

const definitionPath = resolve(String(flags.definition ?? join(MODE_DIR, 'preset', 'agent.cordis.yml')))
const metaPath = resolve(String(flags.meta ?? join(MODE_DIR, 'preset', 'preset.yml')))
const modeRoot = resolve(String(flags['mode-dir'] ?? modeDir()))
const profileCordis = resolve(String(flags['profile-cordis'] ?? join(profileDir(), 'cordis.yml')))
const referencePresetId = String(flags['reference-preset'] ?? 'preset-cordis')

title('插件创造模式 · 模式健康检查')
info(`组装定义      ${definitionPath}`)
info(`模式元数据    ${metaPath}`)
info(`模式安装目录  ${modeRoot}`)
info(`参考组装      ${profileCordis}（行 ${referencePresetId}）`)

if (!existsSync(definitionPath)) usage(`组装定义不存在：${definitionPath}`)

// ── 1. 组装合法性 ───────────────────────────────────────────────────────────

let rows
let rawText
try {
  rawText = readText(definitionPath)
  rows = yaml.load(rawText, { schema: PC_SCHEMA })
} catch (error) {
  fail(`组装 YAML 解析失败：${error instanceof Error ? error.message : String(error)}`)
  process.exit(finish('组装无法解析'))
}
if (!Array.isArray(rows)) {
  fail('组装必须是 YAML 顶层数组（插件行列表）')
  process.exit(finish('组装形状错误'))
}
pass(`组装 YAML 解析通过，顶层 ${rows.length} 行`)

const flat = flattenRows(rows)
const seenIds = new Map()
for (const row of flat) {
  if (row.id === undefined || row.id === '') fail(`第 ${flat.indexOf(row) + 1} 行缺少 id`)
  else if (seenIds.has(row.id)) fail(`重复的行 id：${row.id}（第 ${seenIds.get(row.id)} 行与第 ${flat.indexOf(row) + 1} 行）`)
  else seenIds.set(row.id, flat.indexOf(row) + 1)
  if (row.name === undefined || row.name === '') fail(`行 ${row.id ?? '(无 id)'} 缺少 name（没有 name 的行不会被加载）`)
}
if (flat.every((row) => row.id !== undefined && row.name !== undefined)) {
  pass(`全部 ${flat.length} 行都有 id 与 name，且 id 不重复`)
}

// ── 1b. 元数据（下拉里显示什么，先读出来）────────────────────────────────────

let presetId = 'plugin-creator'
let metaName = '插件创造模式'
let metaOrder
if (existsSync(metaPath)) {
  try {
    const meta = loadYamlFile(metaPath)
    if (typeof meta?.id === 'string' && meta.id !== '') presetId = meta.id
    if (typeof meta?.name === 'string' && meta.name.trim() !== '') metaName = meta.name
    metaOrder = meta?.order
    if (typeof meta?.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(meta.id)) {
      fail(`preset.yml 的 id 不合法：${String(meta?.id)}（必须匹配 ^[a-z0-9][a-z0-9-]*$）`)
    }
    if (typeof meta?.name !== 'string' || meta.name.trim() === '') fail('preset.yml 缺少 name（下拉里会显示成裸目录名）')
    else pass(`preset.yml name = ${meta.name}`)
    if (typeof meta?.description !== 'string' || meta.description.trim() === '') fail('preset.yml 缺少 description（选择器里的说明会空着）')
    else pass('preset.yml description 就位')
    info(`preset id = ${presetId}｜order = ${meta?.order ?? '(未设置)'}`)
  } catch (error) {
    fail(`preset.yml 解析失败：${error instanceof Error ? error.message : String(error)}`)
  }
} else {
  warn(`没有 preset.yml（${metaPath}），跳过元数据检查`)
}

// ── 2. 行点名到的包在这个部署里存在吗 ───────────────────────────────────────

const asarPath = [flags['app-asar'], ...appAsarCandidates()].find((candidate) => candidate !== undefined && existsSync(String(candidate)))
let deploymentPackages = new Set()
if (asarPath === undefined) {
  warn('没有找到部署 app.asar，跳过"包是否真实存在"的核对（用 --app-asar 指定）')
} else {
  const asar = openAsar(String(asarPath))
  deploymentPackages = collectPackageNames(asar.list())
  evidence(`部署 app.asar：${asarPath}（${asar.list().length} 个文件，${deploymentPackages.size} 个包）`)
}
const profilePackages = new Set()
const profileNodeModules = join(profileDir(), 'node_modules')
if (existsSync(profileNodeModules)) {
  for (const entry of readdirSync(profileNodeModules, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    if (entry.name.startsWith('@')) {
      for (const inner of readdirSync(join(profileNodeModules, entry.name), { withFileTypes: true })) {
        profilePackages.add(`${entry.name}/${inner.name}`)
      }
      continue
    }
    profilePackages.add(entry.name)
  }
}

const missing = []
const resolved = []
for (const row of flat) {
  const rowName = row.name
  if (rowName === undefined) continue
  if (BUILTIN_ROW_NAMES.includes(rowName)) {
    resolved.push(`${rowName}（Cordis 内建）`)
    continue
  }
  const { pkg, subpath } = splitRowName(rowName)
  if (deploymentPackages.has(pkg) || profilePackages.has(pkg)) {
    resolved.push(`${rowName}${subpath === undefined ? '' : `（子路径 ${subpath}）`}`)
    continue
  }
  missing.push(`${rowName}（行 ${row.id ?? '?'}）→ 部署与 Profile 里都没有包 ${pkg}`)
}
if (missing.length === 0) pass(`${resolved.length} 个行名在部署里全部可解析`)
else for (const item of missing) fail(`行名无法解析：${item}`)

// ── 3. 与正在工作的「创造模式」组装逐行对比 ─────────────────────────────────

let referenceRows
if (!existsSync(profileCordis)) {
  warn(`参考组装文件不存在，跳过对比：${profileCordis}`)
} else {
  try {
    const tree = loadYamlFile(profileCordis)
    const referenceRow = Array.isArray(tree)
      ? tree.find((entry) => entry !== null && typeof entry === 'object' && entry.id === referencePresetId)
      : undefined
    referenceRows = referenceRow?.config?.plugins
    if (!Array.isArray(referenceRows)) warn(`参考组合里没有 preset 行 ${referencePresetId} 的 plugins 列表，跳过对比`)
  } catch (error) {
    warn(`参考组装解析失败，跳过对比：${error instanceof Error ? error.message : String(error)}`)
  }
}

const ALLOWED = new Set(['persona', 'skill-filesystem', ...allowExtra])
if (Array.isArray(referenceRows)) {
  const referenceFlat = flattenRows(referenceRows)
  const mine = new Map(flat.map((row) => [row.id, row]))
  const theirs = new Map(referenceFlat.map((row) => [row.id, row]))
  let differences = 0
  for (const row of referenceFlat) {
    const mineRow = mine.get(row.id)
    if (mineRow === undefined) {
      differences += 1
      fail(`组装缺少参考组装里的行：${row.id}（${row.name}）`)
      continue
    }
    if (mineRow.name !== row.name) {
      differences += 1
      fail(`行 ${row.id} 的 name 与参考不一致：本模式 ${mineRow.name} / 参考 ${row.name}`)
    }
    const mineDisabled = mineRow.disabled !== undefined && mineRow.disabled !== false
    const theirsDisabled = row.disabled !== undefined && row.disabled !== false
    if (mineDisabled !== theirsDisabled && !ALLOWED.has(row.id)) {
      differences += 1
      fail(`行 ${row.id} 的 disabled 与参考不一致：本模式 ${mineDisabled} / 参考 ${theirsDisabled}`)
    }
    const mineChildren = flattenRows(Array.isArray(mineRow.config) ? mineRow.config : []).map((child) => child.id).join(',')
    const theirsChildren = flattenRows(Array.isArray(row.config) ? row.config : []).map((child) => child.id).join(',')
    if (mineChildren !== theirsChildren && !ALLOWED.has(row.id)) {
      differences += 1
      fail(`行 ${row.id} 的子行与参考不一致：本模式 [${mineChildren}] / 参考 [${theirsChildren}]`)
    }
  }
  for (const row of flat) {
    if (theirs.has(row.id) || ALLOWED.has(row.id)) continue
    differences += 1
    fail(`组装多出参考组装没有的行：${row.id}（${row.name}）。确属有意请用 --allow ${row.id} 显式记录`)
  }
  if (differences === 0) pass(`与参考组装 ${referencePresetId} 逐行一致（允许的差异：${[...ALLOWED].join('、')}）`)
}

// ── 3b. Profile 补丁里的那一行必须与定义一致 ────────────────────────────────

const patchPath = resolve(String(flags['profile-patch'] ?? join(profileDir(), 'cordis.patch.yml')))
if (existsSync(patchPath)) {
  try {
    const patches = loadYamlFile(patchPath)
    const inserted = []
    if (Array.isArray(patches)) {
      for (const patch of patches) {
        if (patch === null || typeof patch !== 'object' || !Array.isArray(patch.insert)) continue
        for (const row of patch.insert) inserted.push(row)
      }
    }
    const mineInPatch = inserted.find((row) => row?.config?.plugins !== undefined
      && (row.id === `preset-${presetId}` || row.config?.id === presetId))
    if (mineInPatch === undefined) {
      info(`Profile 补丁 ${patchPath} 里还没有本模式的 preset 行（尚未安装，或改用手工/bundle 路径）`)
    } else {
      const patchRows = flattenRows(mineInPatch.config.plugins)
      const byId = new Map(patchRows.map((row) => [row.id, row]))
      let drift = 0
      for (const row of flat) {
        const other = byId.get(row.id)
        if (other === undefined) { drift += 1; fail(`Profile 补丁里的行集合与定义不一致：缺少 ${row.id}`); continue }
        if (other.name !== row.name) { drift += 1; fail(`Profile 补丁行 ${row.id} 的 name 与定义不一致：${other.name} / ${row.name}`) }
      }
      for (const row of patchRows) {
        if (!flat.some((mine) => mine.id === row.id)) { drift += 1; fail(`Profile 补丁多出定义里没有的行：${row.id}`) }
      }
      if (drift === 0) pass(`Profile 补丁里的 preset 行与定义逐行一致（${patchRows.length} 行）`)
      const presetIdInPatch = mineInPatch.config?.id
      if (presetIdInPatch !== undefined) evidence(`  补丁行 id=${mineInPatch.id} config.id=${presetIdInPatch} order=${mineInPatch.config?.order ?? '(未设置)'}`)
    }
  } catch (error) {
    fail(`Profile 补丁解析失败：${error instanceof Error ? error.message : String(error)}`)
  }
} else {
  info(`Profile 补丁不存在：${patchPath}`)
}

// ── 4. 元数据已在 1b 校验 ───────────────────────────────────────────────────

// ── 5. 本模式自带的 skill ───────────────────────────────────────────────────

const skillsRoot = join(modeRoot, 'skills')
if (!existsSync(skillsRoot)) {
  fail(`模式 skill 目录不存在：${skillsRoot}（模式会挂载成功但一个流水线 skill 都没有）`)
} else {
  const present = readdirSync(skillsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  const missingSkills = MODE_SKILLS.filter((skill) => !present.includes(skill))
  if (missingSkills.length === 0) pass(`${MODE_SKILLS.length} 个流水线 skill 全部就位：${present.length} 个目录`)
  else fail(`缺少流水线 skill：${missingSkills.join('、')}`)
  for (const skill of present) {
    const skillFile = join(skillsRoot, skill, 'SKILL.md')
    if (!existsSync(skillFile)) {
      fail(`skill ${skill} 缺少 SKILL.md`)
      continue
    }
    const text = readText(skillFile)
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    if (match === null) {
      fail(`skill ${skill} 的 SKILL.md 没有 frontmatter`)
      continue
    }
    let front
    try {
      front = yaml.load(match[1], { schema: PC_SCHEMA })
    } catch (error) {
      fail(`skill ${skill} 的 frontmatter 解析失败：${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    if (front?.name !== skill) fail(`skill ${skill} 的 frontmatter name 是 ${String(front?.name)}，必须等于目录名`)
    else if (typeof front?.description !== 'string' || front.description.trim() === '') fail(`skill ${skill} 缺少 description`)
  }
  if (present.length > 0) pass('每个 skill 的 frontmatter name 与目录名一致且 description 非空')
}

// ── 6. skill-filesystem 真的挂到了本模式目录 ────────────────────────────────

const skillRow = flat.find((row) => row.id === 'skill-filesystem')
if (skillRow === undefined) {
  fail('组装里没有 skill-filesystem 行，本模式的 skill 不会被加载')
} else {
  const dirs = skillRow.config?.customSkillDirs
  if (!Array.isArray(dirs) || dirs.length === 0) {
    fail('skill-filesystem 没有配置 customSkillDirs')
  } else {
    const sources = dirs.map((dir) => jsSource(dir) ?? String(dir))
    const expected = modeSkillsDir()
    const mineIndex = sources.findIndex((source) => {
      const result = evaluateJs(source, { baseUrl: pathToFileURL(`${modeRoot}/`).href, process, require: undefined })
      return result.ok && String(result.value).replaceAll('\\', '/').toLowerCase() === expected.replaceAll('\\', '/').toLowerCase()
    })
    if (mineIndex === -1) {
      fail(`skill-filesystem 的 customSkillDirs 没有解析到本模式 skill 目录：${expected}`)
      for (const source of sources) {
        const result = evaluateJs(source, { baseUrl: pathToFileURL(`${modeRoot}/`).href, process })
        evidence(`  ${result.ok ? String(result.value) : `求值失败：${result.error}`}`)
      }
    } else {
      pass(`skill-filesystem 已挂载本模式 skill 目录：${expected}`)
      evidence(`  customSkillDirs[${mineIndex}] = ${sources[mineIndex].replace(/\s+/g, ' ').slice(0, 120)}`)
    }
    const others = sources.filter((source) => !source.includes('plugin-creator') && !source.includes('__MODE_DIR__'))
    if (others.length > 0) info(`另外还挂载了 ${others.length} 个共享 skill 目录（部署自带的插件开发参考）`)
  }
}

// ── 7. 门禁脚本自身 ─────────────────────────────────────────────────────────

const requiredGates = ['pc.mjs', 'lib.mjs', 'asar.mjs', 'check-preset.mjs', 'guard-format.mjs', 'syntax-check.cjs', 'snapshot.mjs', 'freeze.mjs', 'scaffold.mjs', 'verify-install.mjs', 'vendor/js-yaml.mjs']
const missingGates = requiredGates.filter((gate) => !existsSync(join(modeRoot, 'gates', gate)))
if (missingGates.length === 0) pass(`门禁脚本齐全：${requiredGates.length} 个文件`)
else warn(`模式安装目录里缺这些门禁脚本（源码目录里有就行）：${missingGates.join('、')}`)

const exitCode = finish(`模式健康检查（preset=${presetId} name=${metaName}）`)
if (asJson) console.log(JSON.stringify({ presetId, metaName, rows: flat.length, missing, exitCode }))
process.exit(exitCode)
