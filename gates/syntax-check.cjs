#!/usr/bin/env node
/**
 * 插件创造模式 · 批量脚本语法检查（gates/syntax-check.cjs）
 *
 * 由 guard-format.mjs 单次派发：读一个 JSON 文件列表，逐个编译，把结果写进另一个 JSON 文件。
 *
 * 为什么要批：每个文件一次 `node --check` 是 80 ms 级的进程启动开销，60 个文件就是 5.8 秒；
 * 一次进程里编译同样 60 个是 0.12 秒（本机实测，约 49×）。语法检查的结论与逐个跑完全一致。
 *
 * 为什么用 vm.SourceTextModule：这些文件是 ESM，`export` / `import` 在普通 Script 里是非法的，
 * `new vm.Script` 会把合法文件判成语法错误。SourceTextModule 只做解析与编译，不链接、不执行，
 * 正好是"语法检查"需要的语义。它需要 `--experimental-vm-modules`；调用方拿不到就退回逐文件检查。
 *
 * 用法（由 guard-format.mjs 调用，不单独使用）：
 *   node --experimental-vm-modules --no-warnings syntax-check.cjs <输入 JSON> <输出 JSON>
 *
 * 输入：{ "files": ["<绝对路径>", ...] }
 * 输出：{ "ok": true, "results": [{ "path": "<绝对路径>", "ok": true, "message": "" }, ...] }
 * 退出码：0 = 结果已写出（单个文件的语法失败记在 results 里，不是本进程的失败）/ 1 = 自身跑不起来。
 */
const { readFileSync, writeFileSync } = require('node:fs')
const vm = require('node:vm')

const [, , inputPath, outputPath] = process.argv
if (inputPath === undefined || outputPath === undefined) {
  console.error('[USAGE] syntax-check.cjs <输入 JSON> <输出 JSON>')
  process.exit(2)
}

if (typeof vm.SourceTextModule !== 'function') {
  // 没有 --experimental-vm-modules：如实告诉调用方"我不行"，由它退回逐文件 node --check。
  console.error('[UNAVAILABLE] vm.SourceTextModule 不可用（缺 --experimental-vm-modules）')
  process.exit(1)
}

let files
try {
  files = JSON.parse(readFileSync(inputPath, 'utf8')).files
} catch (error) {
  console.error(`[FAIL] 读不了输入清单：${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
if (!Array.isArray(files)) {
  console.error('[FAIL] 输入清单里没有 files 数组')
  process.exit(1)
}

const results = []
for (const file of files) {
  try {
    let source = readFileSync(file, 'utf8')
    // 哈希邦（`#!/usr/bin/env node`）在模块里同样合法，但先按行注释处理，避免旧 V8 误判。
    if (source.startsWith('#!')) source = `//${source.slice(2)}`
    new vm.SourceTextModule(source, { identifier: file })
    results.push({ path: file, ok: true, message: '' })
  } catch (error) {
    const message = error instanceof Error ? String(error.message).split('\n')[0] : String(error)
    results.push({ path: file, ok: false, message })
  }
}

try {
  writeFileSync(outputPath, JSON.stringify({ ok: true, results }), 'utf8')
} catch (error) {
  console.error(`[FAIL] 写不了结果文件：${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
process.exit(0)
