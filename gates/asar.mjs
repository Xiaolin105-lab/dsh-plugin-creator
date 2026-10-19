/**
 * 插件创造模式 · 只读 asar 读取器（gates/asar.mjs）
 *
 * 用来做"装没装上看目录"这类核对：从部署的 app.asar 里读出真实的包清单与指定文件，
 * 不需要 Electron。只读：本模块从不写 asar。
 *
 * asar 布局（与 app.asar 实测一致）：
 *   [0..3]  = 4（pickle 头）
 *   [12]    = headerJson 的字节长度
 *   [16..]  = headerJson（UTF-8 JSON 目录树）
 *   数据起点 = 8 + headerSize + 8
 */
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs'

/**
 * 打开一个 asar 归档（只读）。
 * @param {string} path app.asar 的绝对路径
 * @returns {{path: string, size: number, list: () => string[], has: (inner: string) => boolean, read: (inner: string) => Buffer, index: Map<string, {offset: number, size: number}>}}
 */
export function openAsar(path) {
  if (!existsSync(path)) throw new Error(`asar not found: ${path}`)
  const fd = openSync(path, 'r')
  try {
    const head = Buffer.alloc(16)
    readSync(fd, head, 0, 16, 0)
    const headerSize = head.readUInt32LE(12)
    const headerBuffer = Buffer.alloc(headerSize)
    readSync(fd, headerBuffer, 0, headerSize, 16)
    const header = JSON.parse(headerBuffer.toString('utf8'))
    const dataOffset = 8 + headerSize + 8
    const index = new Map()
    const walk = (node, prefix) => {
      if (node === null || typeof node !== 'object') return
      if (node.files !== undefined) {
        for (const [entryName, child] of Object.entries(node.files)) walk(child, `${prefix}/${entryName}`)
        return
      }
      if (node.offset !== undefined) index.set(prefix, { offset: Number(node.offset), size: Number(node.size) })
    }
    walk(header, '')
    const list = () => [...index.keys()]
    return {
      path,
      size: statSync(path).size,
      index,
      list,
      has: (inner) => index.has(normalize(inner)),
      read: (inner) => {
        const entry = index.get(normalize(inner))
        if (entry === undefined) throw new Error(`asar entry not found: ${inner}`)
        const buffer = Buffer.alloc(entry.size)
        readSync(fd, buffer, 0, entry.size, dataOffset + entry.offset)
        return buffer
      },
    }
  } finally {
    closeSync(fd)
  }
}

/** 归档内路径统一成 `/a/b` 形式。 */
export function normalize(inner) {
  const withSlash = inner.startsWith('/') ? inner : `/${inner}`
  return withSlash.replaceAll('\\', '/')
}

/**
 * 从一份文件清单里收集所有 `node_modules/<pkg>/package.json` 的包名。
 * @param {string[]} paths 归档内文件路径清单
 * @returns {Set<string>} 例如 `@deepseek-ai/dsh-tool-fs`、`dsh-plugin-suite`
 */
export function collectPackageNames(paths) {
  const names = new Set()
  for (const path of paths) {
    const match = path.match(/\/node_modules\/((?:@[^/]+\/)?[^/]+)\/package\.json$/)
    if (match !== null) names.add(match[1])
  }
  return names
}

/**
 * 把插件行名拆成包名与子路径。
 * @param {string} rowName 例如 `@deepseek-ai/dsh-plugin-manager/tools`
 * @returns {{pkg: string, subpath: string|undefined}}
 */
export function splitRowName(rowName) {
  const segments = rowName.split('/')
  if (rowName.startsWith('@')) {
    const pkg = segments.slice(0, 2).join('/')
    return { pkg, subpath: segments.length > 2 ? segments.slice(2).join('/') : undefined }
  }
  return { pkg: segments[0], subpath: segments.length > 1 ? segments.slice(1).join('/') : undefined }
}
