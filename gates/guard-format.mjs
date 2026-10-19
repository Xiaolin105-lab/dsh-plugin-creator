#!/usr/bin/env node
/**
 * 插件创造模式 · 格式守卫（gates/guard-format.mjs）
 *
 * 门禁层里那个"可选格式守卫"：它不评价设计，只管那些能让加载器或解析器悄悄出问题、
 * 而人眼永远看不出来的格式事实——BOM、CRLF、Tab 缩进、YAML/JSON 解析、脚本语法、
 * skill frontmatter 的 name 是否与目录一致。
 *
 * 用法：
 *   node guard-format.mjs --mode-dir <模式目录>      # 守卫模式自身（preset/ + skills/ + gates/）
 *   node guard-format.mjs --project <项目目录>        # 守卫插件项目产物
 *   [--fix]                                          # 就地规范化 BOM 与 CRLF（不改变其它内容）
 * 退出码：0 通过 / 1 失败 / 2 用法错误。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import {
  GATES_DIR, MODE_DIR, MODE_SKILLS, PC_SCHEMA, evidence, fail, finish, info, parseArgs, pass, readText,
  removeTree, short, title, usage, walkFiles, warn, yaml,
} from './lib.mjs'

const { flags } = parseArgs(process.argv.slice(2))
const modeDir = flags['mode-dir'] === undefined ? undefined : resolve(String(flags['mode-dir']))
const projectDir = flags.project === undefined ? undefined : resolve(String(flags.project))
const strict = flags.strict === true
const fix = flags.fix === true

if (modeDir === undefined && projectDir === undefined) usage('需要 --mode-dir <模式目录> 或 --project <项目目录> 之一')
if (modeDir !== undefined && projectDir !== undefined) usage('--mode-dir 与 --project 只能给一个')

const root = modeDir ?? projectDir
const isMode = modeDir !== undefined
title(`插件创造模式 · 格式守卫 ${short(root)}${isMode ? '（模式自身）' : '（插件项目）'}`)
if (!existsSync(root)) usage(`目录不存在：${root}`)

const files = walkFiles(root, { skipDirs: new Set(['.git', 'node_modules', '.plugin-creator', 'dist', 'build', 'vendor']) })
if (files.length === 0) warn('目录里没有可检查的文件')
let checked = 0
/** 脚本文件攒起来批量查语法，不在这里逐个起进程。 */
const scriptFiles = []

for (const file of files) {
  // docs/reviews/ 是**门禁与审查器的输出**，不是作者写的产物：它由 PowerShell 管道
  // 落盘时天然带 BOM/CRLF，纳入格式守卫只会制造一堆假告警（2026-10-19 实测踩到）。
  // 同一个理由也让 freeze 把它排除在冻结集合外。
  if (file.rel.startsWith('docs/reviews/')) continue
  const ext = extname(file.rel).toLowerCase()
  const isText = ['.md', '.yml', '.yaml', '.json', '.mjs', '.js', '.cjs', '.ts', '.txt', '.patch'].includes(ext)
  if (!isText) continue
  checked += 1
  const raw = readText(file.path)
  const rawBytes = readFileSync(file.path)
  const hadBom = rawBytes.subarray(0, 3).equals(Buffer.from([0xEF, 0xBB, 0xBF]))
  const hadCr = raw.includes('\r')

  if (rawBytes.includes(0)) {
    fail(`${file.rel}：包含 NUL 字节（不是纯文本）`)
    continue
  }
  if (hadBom || hadCr) {
    // 机器要解析的文件（yml/json/js）不允许 BOM/CRLF：那是会真出问题的地方；
    // 人读的 md/txt 只警告。--fix 一律就地规范化。
    if (fix) {
      const normalized = raw.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
      writeFileSync(file.path, normalized, 'utf8')
      pass(`已规范化换行/BOM：${file.rel}`)
    } else if (['.yml', '.yaml', '.json', '.mjs', '.js', '.cjs', '.ts'].includes(ext)) {
      fail(`${file.rel}：包含 ${hadBom ? 'BOM ' : ''}${hadCr ? 'CRLF/CR' : ''}（机器要解析的文件必须 LF、无 BOM；加 --fix 自动规范化）`)
    } else {
      warn(`${file.rel}：包含 ${hadBom ? 'BOM ' : ''}${hadCr ? 'CRLF/CR' : ''}（建议统一成 LF；加 --fix 自动规范化）`)
    }
  }
  if (['.md', '.yml', '.yaml'].includes(ext) && /^[\t ]*\t/m.test(raw)) {
    fail(`${file.rel}：缩进里出现 Tab（YAML/Markdown 只接受空格缩进）`)
  }
  if (!isMode && raw.trim() === '') {
    warn(`${file.rel}：空文件`)
  }

  if (ext === '.json') {
    try {
      JSON.parse(raw)
    } catch (error) {
      fail(`${file.rel}：JSON 解析失败 — ${error instanceof Error ? error.message : String(error)}`)
    }
    continue
  }

  if (ext === '.yml' || ext === '.yaml') {
    try {
      yaml.load(raw, { schema: PC_SCHEMA })
    } catch (error) {
      fail(`${file.rel}：YAML 解析失败 — ${error instanceof Error ? error.message : String(error)}`)
    }
    continue
  }

  if (ext === '.mjs' || ext === '.js' || ext === '.cjs') {
    // 语法检查不在这里做：攒起来，循环结束后一次进程批量编译（见 checkScripts）。
    scriptFiles.push(file)
    continue
  }

  if (ext === '.md') {
    const headings = raw.match(/^#{1,6}\s+\S/m)
    if (headings === null) warn(`${file.rel}: Markdown 没有任何标题`)
    if (isMode && file.rel.startsWith('skills/')) {
      const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
      if (match === null) {
        fail(`${file.rel}：skill 缺少 frontmatter`)
        continue
      }
      let front
      try {
        front = yaml.load(match[1], { schema: PC_SCHEMA })
      } catch (error) {
        fail(`${file.rel}：frontmatter 解析失败 — ${error instanceof Error ? error.message : String(error)}`)
        continue
      }
      const dirName = file.rel.split('/')[1]
      if (front?.name !== dirName) fail(`${file.rel}：frontmatter name=${String(front?.name)} 与目录名 ${dirName} 不一致`)
      if (typeof front?.description !== 'string' || front.description.trim() === '') fail(`${file.rel}：缺少 description`)
      if (front?.description !== undefined && String(front.description).length > 500) {
        warn(`${file.rel}：description 超过 500 字符，会话目录里会被截断（当前 ${String(front.description).length}）`)
      }
    }
  }
}

// 脚本语法：一次进程批量编译（等价结论，49× 快）
if (scriptFiles.length > 0) {
  const { mode, results } = checkScripts(scriptFiles)
  const bad = results.filter((entry) => !entry.ok)
  for (const entry of bad) fail(`${entry.rel}：${entry.message === '' ? '语法错误' : entry.message}`)
  if (bad.length === 0) pass(`脚本语法通过：${results.length} 个文件（${mode}）`)
  else info(`脚本语法：${results.length} 个里 ${bad.length} 个不通过（${mode}）`)
}

// 模式自身的额外事实：skill 目录齐全
if (isMode) {
  const skillsRoot = join(root, 'skills')
  if (!existsSync(skillsRoot)) {
    fail('模式缺少 skills/ 目录')
  } else {
    const present = readdirSync(skillsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    const missing = MODE_SKILLS.filter((skill) => !present.includes(skill))
    if (missing.length > 0) fail(`缺少流水线 skill：${missing.join('、')}`)
    else pass(`流水线 skill 齐全（${MODE_SKILLS.length} 个）：${present.length} 个目录`)
    for (const skill of present) {
      const file = join(skillsRoot, skill, 'SKILL.md')
      if (!existsSync(file) || statSync(file).size === 0) fail(`skill ${skill}: SKILL.md 缺失或为空`)
    }
  }
  const presetFile = join(root, 'preset', 'agent.cordis.yml')
  if (!existsSync(presetFile)) warn(`模式目录里没有 preset/agent.cordis.yml（安装时会被复制过来）`)
}

pass(`格式检查通过：${checked} 个文本文件（BOM/CRLF/Tab/YAML/JSON/语法/frontmatter）`)
if (strict && checked === 0) fail('--strict：没有任何可检查文件')
evidence(`  扫描根目录 ${root}`)
info('提示：格式守卫只保证"能被解析"，不保证"装上能用"——那要 check-preset + verify-install + 真机。')
process.exit(finish('格式守卫'))

/**
 * 批量做脚本语法检查。
 *
 * 优先一次进程编译全部文件（实测 60 个文件 0.12 s）；`--experimental-vm-modules` 不可用、
 * 或子进程本身跑不起来时，退回逐文件 `node --check`（结论相同，慢约 49 倍）。
 *
 * 两条路的 stdio 都走 `'ignore'` + 文件交换：受限沙箱下管道 stdio 会被拒绝，
 * 所以批量子进程不通过 stdout 回话，而是把结果写进临时文件再由调用方读。
 *
 * @param {{path: string, rel: string}[]} files 待检查的脚本文件
 * @returns {{mode: string, results: {rel: string, ok: boolean, message: string}[]}}
 */
function checkScripts(files) {
  const driver = join(GATES_DIR, 'syntax-check.cjs')
  if (existsSync(driver)) {
    let scratch
    try {
      scratch = mkdtempSync(join(tmpdir(), 'dsh-pc-syntax-'))
      const inputPath = join(scratch, 'in.json')
      const outputPath = join(scratch, 'out.json')
      writeFileSync(inputPath, JSON.stringify({ files: files.map((file) => file.path) }), 'utf8')
      const result = spawnSync(
        process.execPath,
        ['--experimental-vm-modules', '--no-warnings', driver, inputPath, outputPath],
        { stdio: 'ignore' },
      )
      if (result.status === 0 && existsSync(outputPath)) {
        const parsed = JSON.parse(readFileSync(outputPath, 'utf8'))
        const byPath = new Map((parsed.results ?? []).map((entry) => [entry.path, entry]))
        return {
          mode: '批量',
          results: files.map((file) => {
            const hit = byPath.get(file.path)
            if (hit === undefined) return { rel: file.rel, ok: false, message: '语法检查没有返回这个文件的结果' }
            return { rel: file.rel, ok: hit.ok === true, message: typeof hit.message === 'string' ? hit.message : '' }
          }),
        }
      }
    } catch {
      // 落到逐文件检查，绝不因为"批这条路坏了"而放过语法错误
    } finally {
      if (scratch !== undefined) removeTree(scratch)
    }
  }
  return {
    mode: '逐文件',
    results: files.map((file) => {
      const result = spawnSync(process.execPath, ['--check', file.path], { stdio: 'ignore' })
      return { rel: file.rel, ok: result.status === 0, message: 'node --check 失败（语法错误）' }
    }),
  }
}
