#!/usr/bin/env node
/**
 * 插件创造模式 · 审查轮冻结与核对（gates/freeze.mjs）
 *
 * 审核层的"文件被动过，整轮作废"不是靠自觉，是靠这份哈希清单：
 *   1. 派发审查员之前：freeze.mjs --tag before --round N
 *   2. 只递路径给 subagent（产出物绝对路径 + pc-review-protocol + 证据清单）
 *   3. 审查员返回之后：freeze.mjs --check --round N
 * 有任何新增/删除/改动，--check 以非 0 退出，这一轮必须整轮作废重派。
 *
 * 用法：
 *   node freeze.mjs --project <目录> [--tag before|after] [--round 1]
 *   node freeze.mjs --project <目录> --check [--round 1]
 * 退出码：0 一致 / 1 被改动或缺少基线 / 2 用法错误。
 */
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  evidence, fail, finish, info, parseArgs, pass, readJson, readText, sha256, short, stamp,
  stateDir, title, trackedFiles, usage, warn, writeJson,
} from './lib.mjs'

const { flags } = parseArgs(process.argv.slice(2))
const projectDir = resolve(String(flags.project ?? process.cwd()))
const tag = String(flags.tag ?? 'before')
const round = Number.parseInt(String(flags.round ?? '1'), 10)
if (!Number.isInteger(round) || round < 1) usage(`--round 需要正整数，收到 ${flags.round}`)
const freezeDir = join(stateDir(projectDir), 'review')
const file = join(freezeDir, `freeze-${tag}-r${round}.json`)

if (!existsSync(projectDir)) usage(`项目目录不存在：${projectDir}`)

/**
 * 当前产物指纹。
 *
 * `docs/reviews/` **不在冻结范围内**：审查报告是"审查的产出"，按流程定义就是派发之后才落盘的。
 * 把它算进冻结集合，每一轮 `--check` 都必然报「审查期间被新增：docs/reviews/rN-*.md」，
 * 于是这一轮必然作废、必须重派——而重派又产生新的审查报告，永远收敛不了。
 * 2026-10-19 用 14 文件的基准项目实测复现过这个死循环。
 * 被审的产物（`pkg/`、`docs/01..05`）照旧全部纳入，一个都不放过。
 * @returns {object} 基线清单
 */
function fingerprint() {
  const files = trackedFiles(projectDir).filter((entry) => !entry.rel.startsWith('docs/reviews/'))
  return {
    at: new Date().toISOString(),
    stamp: stamp(),
    round,
    tag,
    project: projectDir,
    files: files.map((entry) => ({ rel: entry.rel, size: entry.size, sha256: sha256(readText(entry.path)) })),
  }
}

if (flags.check === true) {
  const baselineFile = existsSync(file) ? file : join(freezeDir, `freeze-before-r${round}.json`)
  title(`插件创造模式 · 审查轮冻结核对（第 ${round} 轮）`)
  if (!existsSync(baselineFile)) {
    fail(`没有找到派发前的冻结基线：${short(baselineFile)}（先跑 freeze.mjs --tag before --round ${round}）`)
    process.exit(finish('冻结核对'))
  }
  const baseline = readJson(baselineFile, { files: [] })
  const current = fingerprint()
  const before = new Map((baseline.files ?? []).map((entry) => [entry.rel, entry]))
  const after = new Map(current.files.map((entry) => [entry.rel, entry]))
  const added = [...after.keys()].filter((rel) => !before.has(rel))
  const removed = [...before.keys()].filter((rel) => !after.has(rel))
  const modified = [...after.keys()].filter((rel) => before.has(rel) && before.get(rel).sha256 !== after.get(rel).sha256)

  info(`基线 ${short(baselineFile)}（${baseline.stamp ?? baseline.at}，${baseline.files?.length ?? 0} 个文件）`)
  info(`当前 ${current.files.length} 个文件`)
  for (const rel of modified.slice(0, 40)) fail(`审查期间被改动：${rel}`)
  for (const rel of added.slice(0, 40)) fail(`审查期间被新增：${rel}`)
  for (const rel of removed.slice(0, 40)) fail(`审查期间被删除：${rel}`)
  if (modified.length + added.length + removed.length > 40) warn('只列出前 40 条，其余同类')
  if (modified.length + added.length + removed.length === 0) {
    pass(`第 ${round} 轮产物在派发前后逐文件一致（${current.files.length} 个文件）`)
    process.exit(finish(`冻结核对（第 ${round} 轮）`))
  }
  fail('这一轮作废：审查期间文件被动过，重派审查员并说明原因')
  process.exit(1)
}

title(`插件创造模式 · 冻结审查轮产物（第 ${round} 轮 / tag=${tag}）`)
const manifest = fingerprint()
writeJson(file, manifest)
pass(`已冻结 ${manifest.files.length} 个文件的指纹`)
evidence(`  ${short(file)}`)
info(`核对命令：node freeze.mjs --project "${projectDir}" --check --round ${round}`)
process.exit(finish(`冻结（${tag} r${round}）`))
