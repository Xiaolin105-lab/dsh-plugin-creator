#!/usr/bin/env node
/**
 * 插件创造模式 · 分阶段版本快照与回退（gates/snapshot.mjs）
 *
 * 每过一个阶段，由路由 skill 问用户"保留前面几版"，然后本脚本落盘一份可回退的快照。
 * 快照是**整棵项目树**（排除 .plugin-creator / node_modules / .git 等），带每个文件的 sha256，
 * 因此"回退到第 N 版"是逐文件恢复，不是让人凭记忆重写。
 *
 * 用法：
 *   node snapshot.mjs --project <目录> --stage <阶段> [--keep 3|1|5|0|all] [--label "…"]
 *   node snapshot.mjs --project <目录> --stage <阶段> --rollback v2
 *   node snapshot.mjs --project <目录> --list
 * 退出码：0 成功 / 1 失败 / 2 用法错误。
 */
import { existsSync, readdirSync } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import {
  DEFAULT_KEEP, STAGE_IDS, blobPath, copyTree, ensureDir, evidence, fail, finish, hashFile, info,
  objectsDir, parseArgs, pass, readJson, removeTree, short, stamp, stateDir,
  title, trackedFiles, usage, warn, writeJson, walkFiles,
} from './lib.mjs'

const { flags } = parseArgs(process.argv.slice(2))
const projectDir = resolve(String(flags.project ?? process.cwd()))
const stage = flags.stage === undefined ? undefined : String(flags.stage)
const versionsRoot = join(stateDir(projectDir), 'versions')
/** 状态文件路径（`resolveKeep` 缺省时要先读到项目自己的保留策略）。 */
const statePath = join(stateDir(projectDir), 'state.json')

if (!existsSync(projectDir)) usage(`项目目录不存在：${projectDir}`)

/**
 * 解析 --keep：数字 / all / 缺省。
 *
 * 缺省时读项目自己的保留策略（`init --keep` 定下的那个），而不是永远回落到 3：
 * 保留几版本质上是项目开始时的一次约定，不该每个阶段重问一遍。
 */
function resolveKeep(raw) {
  if (raw === undefined) {
    const stored = readJson(statePath, undefined)?.keepVersions
    if (stored === 'all') return Number.POSITIVE_INFINITY
    if (typeof stored === 'number' && Number.isInteger(stored) && stored >= 0) return stored
    return DEFAULT_KEEP
  }
  const value = String(raw).toLowerCase()
  if (value === 'all' || value === '全部') return Number.POSITIVE_INFINITY
  if (value === '') return DEFAULT_KEEP
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 0) usage(`--keep 只接受 0 及正整数或 all，收到 ${raw}`)
  return parsed
}

/** 列出一个阶段的既有版本（升序）。 */
function listVersions(stageId) {
  const dir = join(versionsRoot, stageId)
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^v\d+$/.test(entry.name))
    .map((entry) => Number.parseInt(entry.name.slice(1), 10))
    .sort((left, right) => left - right)
}

// ── --list ──────────────────────────────────────────────────────────────────

if (flags.list === true) {
  title(`插件创造模式 · 版本清单 ${short(projectDir)}`)
  if (!existsSync(versionsRoot)) {
    info('还没有任何快照')
    process.exit(finish('版本清单'))
  }
  const stageIds = new Set([
    ...STAGE_IDS,
    ...readdirSync(versionsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name),
  ])
  for (const stageId of stageIds) {
    const versions = listVersions(stageId)
    if (versions.length === 0) continue
    console.log(`\n阶段 ${stageId}：${versions.length} 版`)
    for (const version of versions) {
      const manifest = readJson(join(versionsRoot, stageId, `v${version}`, 'manifest.json'), {})
      console.log(`  v${version}  ${manifest.at ?? '?'}  ${manifest.files?.length ?? 0} 个文件  ${manifest.label ?? ''}`)
    }
  }
  process.exit(finish('版本清单'))
}

if (stage === undefined) usage('需要 --stage <阶段>（interview|design|plan|develop|verify|delivered）')
if (!STAGE_IDS.includes(stage)) usage(`未知阶段 ${stage}；合法值：${STAGE_IDS.join(', ')}`)

// ── --rollback ──────────────────────────────────────────────────────────────

if (flags.rollback !== undefined) {
  const raw = String(flags.rollback)
  const version = raw.startsWith('v') ? raw : `v${raw}`
  const versionDir = join(versionsRoot, stage, version)
  title(`插件创造模式 · 回退 ${stage}/${version}`)
  if (!existsSync(versionDir)) {
    fail(`该版本不存在：${short(versionDir)}（先跑 snapshot.mjs --list 看有哪些）`)
    process.exit(finish('回退'))
  }
  const manifest = readJson(join(versionDir, 'manifest.json'), { files: [] })
  let restored = 0
  let unchanged = 0
  for (const entry of manifest.files ?? []) {
    // 两种布局都认：老快照是整棵树复制（tree/），新快照是内容寻址对象（objects/）。
    const legacy = join(versionDir, 'tree', entry.rel)
    const source = existsSync(legacy) || typeof entry.sha256 !== 'string'
      ? legacy
      : blobPath(projectDir, entry.sha256)
    const to = join(projectDir, entry.rel)
    if (!existsSync(source)) {
      warn(`快照里缺文件：${entry.rel}`)
      continue
    }
    // 按原始字节比对，不解读成文本再比：图片、wav 这类二进制才算得准。
    if (existsSync(to) && hashFile(to) === entry.sha256) {
      unchanged += 1
      continue
    }
    ensureDir(join(to, '..'))
    copyTree(source, to)
    restored += 1
    evidence(`恢复 ${entry.rel}`)
  }
  const result = { at: new Date().toISOString(), stage, version, restored, unchanged }
  writeJson(join(stateDir(projectDir), 'last-rollback.json'), result)
  pass(`回退完成：恢复 ${restored} 个文件，${unchanged} 个本来一致`)
  info('快照里没有、而项目里多出来的文件不会被删除；需要严格回到旧版请先自行清理或从干净副本重来。')
  process.exit(finish(`回退 ${stage}/${version}`))
}

// ── 新建快照 ────────────────────────────────────────────────────────────────

const keep = resolveKeep(flags.keep)
const label = flags.label === undefined ? '' : String(flags.label)
title(`插件创造模式 · 阶段快照 ${stage}`)
info(`项目        ${projectDir}`)
info(`保留策略    最近 ${keep === Number.POSITIVE_INFINITY ? '全部' : keep} 版`)

const files = trackedFiles(projectDir, [], 32 * 1024 * 1024)
if (files.length === 0) {
  fail('项目目录里没有任何可快照的文件（是不是路径写错了？）')
  process.exit(finish('阶段快照'))
}

const existing = listVersions(stage)
const version = (existing.length === 0 ? 0 : existing[existing.length - 1]) + 1
const versionDir = join(versionsRoot, stage, `v${version}`)
ensureDir(versionDir)

// 文件内容进内容寻址对象库：同一份内容只写一次，第二次快照起几乎零拷贝。
// 不用硬链接：硬链接与工作文件共用 inode，之后任何一次就地改写都会连带改掉历史快照。
const manifestFiles = new Array(files.length)
let written = 0
let reused = 0
const COPY_CONCURRENCY = 32
for (let base = 0; base < files.length; base += COPY_CONCURRENCY) {
  const slice = files.slice(base, base + COPY_CONCURRENCY)
  await Promise.all(slice.map(async (file, offset) => {
    const digest = hashFile(file.path)
    const target = blobPath(projectDir, digest)
    if (existsSync(target)) {
      reused += 1
    } else {
      await mkdir(dirname(target), { recursive: true })
      await copyFile(file.path, target)
      written += 1
    }
    manifestFiles[base + offset] = { rel: file.rel, size: file.size, sha256: digest }
  }))
}
const totalBytes = manifestFiles.reduce((sum, entry) => sum + entry.size, 0)
const manifest = {
  stage, version, at: new Date().toISOString(), stamp: stamp(), label, layout: 'blob',
  keep: keep === Number.POSITIVE_INFINITY ? 'all' : keep,
  project: projectDir, files: manifestFiles, totalBytes,
}
writeJson(join(versionDir, 'manifest.json'), manifest)
pass(`快照 ${stage}/v${version}：${manifestFiles.length} 个文件，${(totalBytes / 1024).toFixed(1)} KiB（新写 ${written} 个对象，复用 ${reused} 个）`)
evidence(`  ${short(versionDir)}`)

// 状态文件：存在就追加历史，不存在就建一份最小的
const state = readJson(statePath, undefined)
if (state !== undefined) {
  state.history = Array.isArray(state.history) ? state.history : []
  state.history.push({ stage, version: `v${version}`, at: manifest.at, label })
  state.keepVersions = keep === Number.POSITIVE_INFINITY ? 'all' : keep
  writeJson(statePath, state)
  info('已写入 state.json 历史')
}

// 裁剪
if (keep !== Number.POSITIVE_INFINITY) {
  const versions = listVersions(stage)
  const remove = versions.slice(0, Math.max(0, versions.length - keep))
  for (const old of remove) {
    removeTree(join(versionsRoot, stage, `v${old}`))
    warn(`按保留策略删除旧版 ${stage}/v${old}`)
  }
  if (remove.length === 0) info(`保留策略下无需删除（当前 ${versions.length} 版）`)
  if (remove.length > 0) collectGarbage()
}

info(`回退命令：node "${join(process.cwd(), 'gates', 'pc.mjs')}" rollback --project "${projectDir}" --stage ${stage} --version v${version}`)
process.exit(finish(`阶段快照 ${stage}/v${version}`))

/**
 * 回收不再被任何快照引用的对象。
 *
 * 对象按内容去重，所以删掉一个版本不等于能删它的对象——只有没有任何剩余版本
 * 还引用它时才删。老布局（`tree/`）的快照根本没有对象，自然不受影响。
 */
function collectGarbage() {
  const objects = objectsDir(projectDir)
  if (!existsSync(objects)) return
  const referenced = new Set()
  const stageDirs = readdirSync(versionsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
  for (const stageId of stageDirs) {
    for (const version of listVersions(stageId)) {
      const manifest = readJson(join(versionsRoot, stageId, `v${version}`, 'manifest.json'), { files: [] })
      for (const entry of manifest.files ?? []) {
        if (typeof entry.sha256 === 'string') referenced.add(entry.sha256)
      }
    }
  }
  let deleted = 0
  let freed = 0
  for (const file of walkFiles(objects, { skipDirs: new Set() })) {
    if (referenced.has(basename(file.path))) continue
    removeTree(file.path)
    deleted += 1
    freed += file.size
  }
  if (deleted === 0) info('对象库里没有可回收的对象')
  else info(`回收不再被引用的对象 ${deleted} 个（${(freed / 1024).toFixed(1)} KiB）`)
}
