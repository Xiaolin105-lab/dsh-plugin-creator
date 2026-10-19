#!/usr/bin/env node
/**
 * 插件创造模式 · 安装核对（gates/verify-install.mjs）
 *
 * "装没装上看目录，能不能用看真机。"本脚本负责前半句，并把后半句显式列成未验证项，
 * 免得有人把"安装成功"当成"功能可用"。
 *
 * 用法：
 *   node verify-install.mjs --name <包名> --target <bundle 目录>          # 本地 bundle
 *   node verify-install.mjs --kind mode --id <preset id>                  # 模式（agent preset）
 *   [--profile desktop] [--json]
 * 退出码：0 全部核对通过 / 1 有失败 / 2 用法错误。
 */
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  evidence, fail, finish, info, loadYamlFile, loadYamlText, parseArgs, pass, profileDir, readJson,
  readText, title, usage, warn,
} from './lib.mjs'

const { flags } = parseArgs(process.argv.slice(2))
const asJson = flags.json === true
const kind = String(flags.kind ?? (flags.id !== undefined && flags.target === undefined ? 'mode' : 'bundle'))
const profileRoot = flags.profile === undefined ? profileDir() : join(process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? '', '.dsh'), 'profiles', String(flags.profile))
const unverified = []

title('插件创造模式 · 安装核对')
info(`Profile     ${profileRoot}`)
info(`核对类型    ${kind}`)

if (kind === 'bundle') {
  const packageName = flags.name === undefined ? undefined : String(flags.name)
  const target = flags.target === undefined ? undefined : resolve(String(flags.target))
  if (packageName === undefined) usage('bundle 核对需要 --name <包名>')
  if (target === undefined) usage('bundle 核对需要 --target <bundle 目录>')
  info(`包名        ${packageName}`)
  info(`源码目录    ${target}`)

  const manifestPath = join(target, 'package.json')
  if (!existsSync(manifestPath)) {
    fail(`bundle 目录里没有 package.json：${target}`)
  } else {
    const manifest = readJson(manifestPath, {})
    if (manifest.name !== packageName) fail(`package.json 里的 name 是 ${String(manifest.name)}，与 --name 不一致`)
    else pass(`package.json name = ${packageName}`)
    const patchRel = manifest.dsh?.bundle?.patch
    if (typeof patchRel !== 'string') {
      fail('package.json 缺少 dsh.bundle.patch（不是可安装的 bundle）')
    } else {
      const patchPath = join(target, patchRel)
      if (!existsSync(patchPath)) {
        fail(`dsh.bundle.patch 指向的文件不存在：${patchRel}`)
      } else {
        let patches
        try {
          patches = loadYamlFile(patchPath)
        } catch (error) {
          fail(`补丁文件解析失败：${error instanceof Error ? error.message : String(error)}`)
        }
        if (Array.isArray(patches)) {
          const inserts = []
          for (const patch of patches) {
            if (patch !== null && typeof patch === 'object' && Array.isArray(patch.insert)) {
              for (const row of patch.insert) inserts.push(row)
            }
          }
          if (inserts.length === 0) fail('补丁里没有任何 insert 行，安装后不会带来任何东西')
          else pass(`补丁可解析：${inserts.length} 行 insert（${inserts.map((row) => row?.id ?? '?').join(', ')}）`)
          const declaresSelf = inserts.some((row) => row?.name === packageName)
          if (!declaresSelf) warn(`补丁里没有 name 等于 ${packageName} 的行（可能是纯配置 bundle，请确认这是有意的）`)
        } else if (patches !== undefined) {
          fail('补丁必须是 YAML 顶层数组')
        }
      }
    }
  }

  const profileManifest = readJson(join(profileRoot, 'package.json'), {})
  if (profileManifest.dependencies?.[packageName] !== undefined) {
    pass(`Profile package.json 已声明依赖：${profileManifest.dependencies[packageName]}`)
  } else {
    fail(`Profile package.json 里没有 ${packageName} 的依赖（还没装上，或装到了别的 Profile）`)
  }
  const bundles = profileManifest.dsh?.profile?.bundles ?? []
  if (bundles.includes(packageName)) pass(`Profile 的 bundle 列表包含它：${bundles.join(', ')}`)
  else warn(`Profile 的 bundle 列表里没有 ${packageName}（只在 dependencies 里，可能没有启用）`)

  const installed = join(profileRoot, 'node_modules', packageName)
  if (existsSync(installed)) pass(`Profile node_modules 里有它的实体：${installed}`)
  else fail(`Profile node_modules 里没有 ${installed}`)

  const composedYml = join(profileRoot, 'cordis.yml')
  if (existsSync(composedYml)) {
    const text = readText(composedYml)
    if (text.includes(packageName)) pass('组合文件 cordis.yml 里出现了这个包名')
    else warn('组合文件 cordis.yml 里还没出现这个包名（可能需要重启 Profile 才重新组合）')
  }
  unverified.push('插件真的被加载并生效（激活结果要读 plugin_manager 的返回，或看真机表现）')
  unverified.push('功能真的可用（要按验收文档里的证据逐条跑一遍）')
}

if (kind === 'mode') {
  const presetId = String(flags.id ?? 'plugin-creator')
  info(`模式 id     ${presetId}`)
  const patchPath = join(profileRoot, 'cordis.patch.yml')
  const composedPath = join(profileRoot, 'cordis.yml')
  let found = false
  if (existsSync(patchPath)) {
    try {
      const patches = loadYamlFile(patchPath)
      for (const patch of Array.isArray(patches) ? patches : []) {
        for (const row of Array.isArray(patch?.insert) ? patch.insert : []) {
          if (row?.config?.id === presetId) {
            found = true
            pass(`Profile 补丁里有这个模式的行：insert id=${row.id}，${Array.isArray(row.config.plugins) ? row.config.plugins.length : 0} 行组装`)
            evidence(`  ${patchPath}`)
          }
        }
      }
    } catch (error) {
      fail(`Profile 补丁解析失败：${error instanceof Error ? error.message : String(error)}`)
    }
  } else {
    warn(`Profile 补丁不存在：${patchPath}`)
  }
  if (existsSync(composedPath)) {
    const text = readText(composedPath)
    if (text.includes(`id: preset-${presetId}`) || text.includes(`id: ${presetId}`)) {
      pass('组合文件 cordis.yml 里已经有这个模式的注册行')
    } else {
      info('组合文件 cordis.yml 里还没有这个模式的注册行（补丁层是启动时应用的，重启后才会出现）')
    }
  }
  if (!found) fail('Profile 补丁里没有这个模式的 preset 行：模式不会出现在下拉里')

  const modeRoot = resolve(String(flags['mode-dir'] ?? join(process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? '', '.dsh'), 'plugin-creator')))
  const skillsRoot = join(modeRoot, 'skills')
  if (existsSync(skillsRoot)) {
    const skills = readdirSync(skillsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    pass(`模式 skill 目录就位：${skills.length} 个 skill`)
    evidence(`  ${skillsRoot}`)
  } else {
    fail(`模式 skill 目录不存在：${skillsRoot}`)
  }
  unverified.push('模式真的出现在下拉菜单里（要人眼看一次）')
  unverified.push('选中这个模式能开出会话并真的切过去（要真的开一个会话）')
  unverified.push('会话里能看到流水线 skill（在新会话里让它列出 skill 名单）')
}

console.log('')
if (unverified.length === 0) pass('没有遗留的未验证项')
else {
  console.log('未验证项（这些不是失败，但绝不能当成已验证）：')
  for (const item of unverified) console.log(`  · ${item}`)
}
const exitCode = finish('安装核对')
if (asJson) console.log(JSON.stringify({ kind, exitCode, unverified }))
process.exit(exitCode)
