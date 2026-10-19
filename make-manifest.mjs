#!/usr/bin/env node
/**
 * 插件创造模式 · 交付指纹（make-manifest.mjs）
 *
 * 生成 MANIFEST.sha256：包内每个文件的 sha256 清单，用来回答"这版交付的到底是哪份内容"。
 *
 * 刻意排除两个文件：
 *   - MANIFEST.sha256 自己（清单不可能包含自己的哈希）
 *   - 交付说明.md（它要写下清单的指纹，写进去就成了循环依赖）
 * 因此清单覆盖的是"代码 / skill / 组装 / 文档模板"这一组可执行交付物。
 *
 * 用法：
 *   node make-manifest.mjs            # 在包目录里生成并打印交付指纹
 *   node make-manifest.mjs --check    # 只校验现有清单是否与磁盘一致（不改文件）
 * 退出码：0 一致 / 1 不一致 / 2 用法错误。
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACK_DIR = dirname(fileURLToPath(import.meta.url))
const manifestPath = join(PACK_DIR, 'MANIFEST.sha256')
// 交付清单只覆盖**要装到用户机器上的东西**。
// 仓库管道（.gitignore / .github）与本机交付记录不算交付内容，排除掉，
// 否则改一行 CI 配置也会让"交付指纹"变掉，那个指纹就不再代表交付内容了。
const EXCLUDE = new Set(['MANIFEST.sha256', '交付说明.md', '.gitignore', '.gitattributes'])
const EXCLUDE_DIRS = new Set(['.git', 'node_modules', '.plugin-creator', '.github'])

const files = []
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (EXCLUDE_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full)
      continue
    }
    if (!entry.isFile()) continue
    const rel = relative(PACK_DIR, full).split(sep).join('/')
    if (EXCLUDE.has(rel)) continue
    files.push({
      rel,
      size: statSync(full).size,
      sha: createHash('sha256').update(readFileSync(full)).digest('hex'),
    })
  }
}
walk(PACK_DIR)
files.sort((left, right) => left.rel.localeCompare(right.rel))

const text = `${files.map((file) => `${file.sha}  ${file.rel}`).join('\n')}\n`
const aggregate = createHash('sha256').update(text).digest('hex')

if (process.argv.includes('--check')) {
  let current
  try {
    current = readFileSync(manifestPath, 'utf8')
  } catch {
    console.log('[FAIL] MANIFEST.sha256 不存在，先跑 node make-manifest.mjs')
    process.exit(1)
  }
  if (current === text) {
    console.log(`[PASS] 清单与磁盘一致：${files.length} 个文件`)
    console.log(`[INFO] 交付指纹 = ${aggregate}`)
    process.exit(0)
  }
  const before = new Set(current.split('\n').filter(Boolean))
  const after = new Set(text.split('\n').filter(Boolean))
  for (const line of [...after].filter((entry) => !before.has(entry))) console.log(`[FAIL] 新增或改动：${line.split('  ')[1]}`)
  for (const line of [...before].filter((entry) => !after.has(entry))) console.log(`[FAIL] 删除：${line.split('  ')[1]}`)
  console.log('[FAIL] 清单已过期：内容变了就是新的一版交付，需要重新走一遍复验')
  process.exit(1)
}

writeFileSync(manifestPath, text, 'utf8')
console.log(`[PASS] 已写出 ${manifestPath}`)
console.log(`[INFO] 覆盖 ${files.length} 个文件，共 ${files.reduce((sum, file) => sum + file.size, 0)} 字节`)
console.log(`[INFO] 交付指纹（MANIFEST.sha256 的 sha256）= ${aggregate}`)
