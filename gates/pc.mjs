#!/usr/bin/env node
/**
 * 插件创造模式 · 门禁层统一入口（gates/pc.mjs）
 *
 * 阶段收口只跑这一个脚本。它是确定性脚本链的调度器：把状态、快照、冻结、健康检查、
 * 脚手架、安装核对、格式守卫串起来，任何一个环节非 0 退出，整条链就是不过。
 *
 * 常用命令：
 *   node pc.mjs init --project <目录> --name <项目名> [--kind ui|host|bundle|mcp|preset] [--keep 3|all]
 *   node pc.mjs status [--project <目录>] [--json]
 *   node pc.mjs stage <阶段> [--project <目录>] [--note "…"] [--force]
 *   node pc.mjs stage delivered --note "采用 <包名>（<仓库地址>）"   # 调研后采纳现成插件的唯一近路
 *   node pc.mjs snapshot --project <目录> --stage <阶段> [--keep 3]
 *   node pc.mjs rollback --project <目录> --stage <阶段> --version v2
 *   node pc.mjs freeze --project <目录> --tag before --round 1
 *   node pc.mjs verify-freeze --project <目录> --round 1
 *   node pc.mjs guard [--project <目录> | --mode-dir <目录>]
 *   node pc.mjs check [--definition <agent.cordis.yml>]
 *   node pc.mjs scaffold --out <目录> --name <包名> [--kind ui]
 *   node pc.mjs verify-install --name <包名> --target <目录>
 *   node pc.mjs gate --stage <阶段> [--project <目录>] [--round N]
 *   node pc.mjs review-brief --stage <阶段> [--project <目录>] [--round N] [--name <包名> --target <目录>] [--deep]
 * 退出码：0 通过 / 1 门禁失败 / 2 用法错误。
 */
import { spawnSync } from 'node:child_process'
import { closeSync, existsSync, openSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_KEEP, GATES_DIR, MODE_DIR, STAGES, STAGE_IDS, ensureDir, evidence, fail, finish,
  hashFile, info, parseArgs, pass, readJson, readText, short, stateDir, statePath, stamp, title,
  trackedFiles, usage, warn, writeFileAtomic, writeJson, sha256,
} from './lib.mjs'

const { _: positionals, flags } = parseArgs(process.argv.slice(2))
const command = positionals[0]
const projectDir = resolve(String(flags.project ?? process.cwd()))
/** 本脚本自己的绝对路径（review-brief 要递归调 `pc.mjs gate` 取输出原文）。 */
const SELF = fileURLToPath(import.meta.url)

/** 子脚本名映射。 */
const SCRIPTS = {
  snapshot: 'snapshot.mjs',
  freeze: 'freeze.mjs',
  guard: 'guard-format.mjs',
  check: 'check-preset.mjs',
  scaffold: 'scaffold.mjs',
  'verify-install': 'verify-install.mjs',
}

/** 把参数原样转发给子脚本（stdio 继承，受限沙箱下也成立）。 */
function run(script, args) {
  const path = join(GATES_DIR, script)
  const result = spawnSync(process.execPath, [path, ...args], { stdio: 'inherit' })
  return result.status ?? 1
}

/** 重新拼一份原始参数，丢掉本层已消费的位置参数。 */
function forwardArgs() {
  const out = []
  for (let index = 1; index < positionals.length; index += 1) out.push(positionals[index])
  for (const [key, value] of Object.entries(flags)) {
    if (key === 'project') continue
    if (value === true) out.push(`--${key}`)
    else if (Array.isArray(value)) for (const item of value) out.push(`--${key}`, String(item))
    else out.push(`--${key}`, String(value))
  }
  return out
}

if (command === undefined) usage('用法见文件头注释；至少给一个命令（status / init / stage / gate / snapshot / check …）')

// ── 状态：init / status / stage ─────────────────────────────────────────────

if (command === 'init') {
  const name = String(flags.name ?? 'plugin-project')
  const kind = String(flags.kind ?? 'unknown')
  const keepVersions = parseKeep(flags.keep)
  title('插件创造模式 · 初始化项目')
  ensureDir(join(projectDir, 'docs'))
  ensureDir(join(stateDir(projectDir), 'versions'))
  ensureDir(join(stateDir(projectDir), 'review'))
  const state = readJson(statePath(projectDir), undefined)
  if (state !== undefined) {
    warn(`已有 state.json，保留阶段与历史：${short(statePath(projectDir))}`)
    state.project = { ...state.project, name, kind, path: projectDir }
    writeJson(statePath(projectDir), state)
  } else {
    writeJson(statePath(projectDir), {
      schema: 1,
      mode: 'plugin-creator',
      project: { name, kind, path: projectDir },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      stage: 'interview',
      keepVersions,
      round: 1,
      history: [],
    })
    pass('state.json 已创建')
  }
  pass(`项目目录就绪：${projectDir}`)
  evidence(`  状态文件 ${short(statePath(projectDir))}`)
  evidence(`  版本保留策略 ${keepVersions === 'all' ? '全部' : `最近 ${keepVersions} 版`}（阶段收口不再逐次询问；要改用 snapshot --keep）`)
  info(`下一步：加载 skill plugin-creator，从「需求采访」开始。`)
  process.exit(finish('初始化'))
}

if (command === 'status') {
  const state = readJson(statePath(projectDir), undefined)
  title(`插件创造模式 · 项目状态 ${short(projectDir)}`)
  if (state === undefined) {
    warn('这个目录还没有 state.json（先跑 pc.mjs init）')
    info(`加载 skill \`plugin-creator\` 会带你走完六个阶段。`)
    process.exit(finish('项目状态'))
  }
  const stageIndex = STAGE_IDS.indexOf(state.stage)
  const stage = STAGES[stageIndex]
  info(`项目        ${state.project?.name ?? '?'}（${state.project?.kind ?? '?'}）`)
  info(`当前阶段    ${state.stage}${stage === undefined ? '' : ` — ${stage.name}`}${stage === undefined ? '' : `（skill: ${stage.skill}）`}`)
  info(`保留策略    最近 ${state.keepVersions === 'all' ? '全部' : state.keepVersions} 版`)
  info(`审查轮次    ${state.round ?? 0}`)
  const versionsRoot = join(stateDir(projectDir), 'versions')
  for (const stageId of STAGE_IDS) {
    const dir = join(versionsRoot, stageId)
    if (!existsSync(dir)) continue
    const versions = readdirSyncSafe(dir)
    if (versions.length > 0) evidence(`  快照 ${stageId}: ${versions.join(', ')}`)
  }
  const doc = stage === undefined ? undefined : join(projectDir, stage.doc)
  if (doc !== undefined) info(`阶段产出    ${stage.doc} ${existsSync(doc) ? '（已存在）' : '（还没有）'}`)
  state.updatedAt = new Date().toISOString()
  writeJson(statePath(projectDir), state)
  info(`推进阶段：node pc.mjs stage <阶段> --project "${projectDir}"`)
  process.exit(finish('项目状态'))
}

if (command === 'stage') {
  const wanted = positionals[1]
  if (wanted === undefined) usage(`需要一个阶段名：${STAGE_IDS.join(', ')}`)
  if (!STAGE_IDS.includes(wanted)) usage(`未知阶段 ${wanted}；合法值：${STAGE_IDS.join(', ')}`)
  const state = readJson(statePath(projectDir), undefined)
  title(`插件创造模式 · 阶段推进 → ${wanted}`)
  if (state === undefined) {
    fail('没有 state.json，先跑 pc.mjs init')
    process.exit(finish('阶段推进'))
  }
  const current = STAGE_IDS.indexOf(state.stage)
  const target = STAGE_IDS.indexOf(wanted)
  if (target < current && flags.force !== true) {
    fail(`不能从 ${state.stage} 回退到 ${wanted}（要回到旧版请用 rollback；确实要改状态加 --force）`)
    process.exit(finish('阶段推进'))
  }
  // 调研阶段有两条出路：采纳现成插件时直接收尾，其余一律按顺序推进。
  // 这条近路必须**可核对**——文档里没写死「决定：采用现成插件」，就不许借它结案。
  const adoptJump = state.stage === 'survey' && wanted === 'delivered'
  if (adoptJump) {
    const surveyDoc = join(projectDir, 'docs/01b-市场调研.md')
    if (!existsSync(surveyDoc)) {
      fail('调研后直接收尾需要 docs/01b-市场调研.md（调研没做，就不能拿"装现成的"结案）')
      process.exit(finish('阶段推进'))
    }
    if (!readText(surveyDoc).includes('决定：采用现成插件')) {
      fail('docs/01b-市场调研.md 里没有「决定：采用现成插件」：结论不是采纳现成插件，不该跳到交付')
      process.exit(finish('阶段推进'))
    }
    if (flags.note === undefined) {
      fail('跳到交付要写明采用哪个：--note "采用 <npm 包名>（<仓库地址>）"')
      process.exit(finish('阶段推进'))
    }
  }
  if (target > current + 1 && !adoptJump && flags.force !== true) {
    fail(`不能从 ${state.stage} 跳到 ${wanted}：一次只推进一个阶段（跳阶段请先补上门禁与审查，确实要跳加 --force）`)
    process.exit(finish('阶段推进'))
  }
  state.stage = wanted
  state.updatedAt = new Date().toISOString()
  state.history = Array.isArray(state.history) ? state.history : []
  state.history.push({ stage: wanted, at: state.updatedAt, note: flags.note === undefined ? '' : String(flags.note) })
  writeJson(statePath(projectDir), state)
  pass(`阶段已推进到 ${wanted}`)
  const next = STAGES[target + 1]
  info(next === undefined ? '已经是终态：可以做交付了。' : `下一个阶段：${next.id}（${next.name}，skill ${next.skill}）`)
  info(`收口门禁：node pc.mjs gate --stage ${wanted} --project "${projectDir}"`)
  process.exit(finish('阶段推进'))
}

// ── gate：阶段收口脚本链 ────────────────────────────────────────────────────

if (command === 'gate') {
  const stageId = flags.stage === undefined ? undefined : String(flags.stage)
  if (stageId === undefined) usage('gate 需要 --stage <阶段>')
  if (!STAGE_IDS.includes(stageId)) usage(`未知阶段 ${stageId}；合法值：${STAGE_IDS.join(', ')}`)
  const state = readJson(statePath(projectDir), undefined)
  const stage = STAGES.find((entry) => entry.id === stageId)
  title(`插件创造模式 · 阶段收口门禁：${stageId}（${stage?.name ?? '?'}）`)
  let failed = 0

  // 1) 阶段产出文档的存在性与必备小节
  const docPath = join(projectDir, stage.doc)
  const requirements = {
    interview: [['## 成功判据', '成功判据小节'], ['## 不做的事', '边界小节']],
    survey: [
      ['## 检索记录', '检索记录小节'],
      ['## 候选插件', '候选插件小节'],
      ['## 结论', '结论小节'],
      ['## 宿主确认', '宿主确认小节'],
    ],
    design: [['## 运行时接口证据', '来自 cordis_inspect_query 的接口证据小节'], ['## 失败与降级', '失败与降级小节']],
    plan: [['验收：', '每个任务的验收命令'], ['- [ ]', '任务清单']],
    develop: [['## 任务记录', '任务记录小节'], ['证据：', '每个任务的证据行'], ['审查：', '每个任务的审查结论行']],
    verify: [['## 逐条判据与证据', '逐条判据与证据小节'], ['## 未验证项', '未验证项小节'], ['审查：', '终审结论行']],
  }[stageId] ?? []
  if (!existsSync(docPath)) {
    fail(`阶段产出文件不存在：${stage.doc}`)
    failed += 1
  } else {
    const text = readText(docPath)
    let missing = 0
    for (const [marker, label] of requirements) {
      if (!text.includes(marker)) {
        fail(`${stage.doc} 缺少 ${label}（找不到标记 ${JSON.stringify(marker)}）`)
        missing += 1
      }
    }
    if (missing === 0) pass(`${stage.doc} 的必备小节齐全（${requirements.length} 项）`)
    if (missing > 0) failed += missing
    evidence(`  ${short(docPath)}（${text.length} 字符）`)
  }

  // 1b) 调研阶段额外事实：检索可复算、候选带链接、结论与宿主选择都写死
  if (stageId === 'survey' && existsSync(docPath)) {
    const text = readText(docPath)

    // 检索记录：每条一次真实查询，能照着重跑。少于 3 条基本等于"凭印象扫了一眼"。
    const queries = (text.match(/^- 查询：/gm) ?? []).length
    if (queries >= 3) pass(`检索记录 ${queries} 条查询（可复算）`)
    else { fail(`检索记录至少 3 条「- 查询：…」，当前 ${queries} 条`); failed += 1 }

    // 候选：带编号的表格行。搜不到是合法结论，但要显式写「无合适候选：<理由>」。
    const candidates = (text.match(/^\|\s*\d+\s*\|/gm) ?? []).length
    if (candidates >= 3) pass(`候选插件 ${candidates} 行（编号表格行）`)
    else if (/^无合适候选：/m.test(text)) pass('已声明「无合适候选」并给出理由（查询记录仍要够 3 条）')
    else {
      fail('候选插件至少 3 个表格行（形如 `| 1 | 名字 | 链接 | …`），或写一条 `无合适候选：<理由>`')
      failed += 1
    }

    // 结论：三选一，写死一行，不许含糊。
    const decision = (text.match(/^决定：(自研|采用现成插件|混合)[ \t]*$/m) ?? [])[1]
    if (decision === undefined) {
      fail('结论小节缺一行 `决定：自研` / `决定：采用现成插件` / `决定：混合`')
      failed += 1
    } else pass(`结论已写死：决定：${decision}`)

    // 宿主确认：这一条是宿主自己做的决定，不能让 agent 代填。
    if (/^选择：/m.test(text)) pass('宿主确认小节写了宿主的选择')
    else { fail('宿主确认小节缺 `选择：…`（宿主自己做的决定，不能由你代填）'); failed += 1 }
  }

  // 2) 格式守卫
  const guardStatus = run('guard-format.mjs', ['--project', projectDir])
  if (guardStatus === 0) pass('格式守卫通过')
  else { fail(`格式守卫未通过（退出码 ${guardStatus}）`); failed += 1 }

  // 3) 冻结核对（如果这一轮有派发前基线）
  //    --round 不给时用 state.round；复审轮要显式传，否则会拿上一轮的基线去判本轮，报假 FAIL。
  const round = flags.round === undefined
    ? (state?.round ?? 1)
    : Math.max(1, Number.parseInt(String(flags.round), 10) || 1)
  const baseline = join(stateDir(projectDir), 'review', `freeze-before-r${round}.json`)
  if (existsSync(baseline)) {
    const freezeStatus = run('freeze.mjs', ['--project', projectDir, '--check', '--round', String(round)])
    if (freezeStatus === 0) pass(`第 ${round} 轮冻结核对通过`)
    else { fail(`第 ${round} 轮冻结核对未通过：产物在派发审查前后被动过`); failed += 1 }
  } else {
    warn(`没有第 ${round} 轮的派发前冻结基线（这一轮没有派发审查员，或者漏了 freeze）`)
  }

  // 4) 检查与交付阶段额外要求：模式健康检查（若本项目就是模式项目）
  if (stageId === 'verify') {
    const isModeProject = existsSync(join(projectDir, 'preset', 'agent.cordis.yml'))
    if (isModeProject || flags['mode-check'] === true) {
      const checkStatus = run('check-preset.mjs', ['--definition', join(projectDir, 'preset', 'agent.cordis.yml'), '--meta', join(projectDir, 'preset', 'preset.yml')])
      if (checkStatus === 0) pass('模式健康检查通过')
      else { fail(`模式健康检查未通过（退出码 ${checkStatus}）`); failed += 1 }
    } else {
      info('本项目不是模式项目，跳过模式健康检查（要强制跑加 --mode-check）')
    }
  }

  console.log('')
  if (failed === 0) pass(`阶段 ${stageId} 收口：脚本链全部通过`)
  else fail(`阶段 ${stageId} 收口：${failed} 项未通过，不许进入下一阶段`)
  process.exit(failed === 0 ? finish(`阶段门禁 ${stageId}`) : 1)
}

// ── review-brief：确定性生成「派发简报」 ────────────────────────────────────

if (command === 'review-brief') {
  const stageId = flags.stage === undefined ? undefined : String(flags.stage)
  if (stageId === undefined) usage('review-brief 需要 --stage <阶段>')
  if (!STAGE_IDS.includes(stageId)) usage(`未知阶段 ${stageId}；合法值：${STAGE_IDS.join(', ')}`)
  const stage = STAGES.find((entry) => entry.id === stageId)
  const state = readJson(statePath(projectDir), undefined)
  const round = Math.max(1, Number.parseInt(String(flags.round ?? state?.round ?? 1), 10) || 1)
  const packageName = flags.name === undefined ? undefined : String(flags.name)
  const packageTarget = flags.target === undefined ? projectDir : resolve(String(flags.target))

  title(`插件创造模式 · 派发简报 ${stageId} · 第 ${round} 轮`)

  const lines = []
  const put = (text = '') => lines.push(text)

  put(`# 派发简报 · ${state?.project?.name ?? '未命名项目'} · ${stageId} · 第 ${round} 轮`)
  put('')
  put(`> 由 \`pc.mjs review-brief\` 于 ${new Date().toISOString()} 确定性生成。`)
  put('> 本文件的内容只来自两类东西：**磁盘事实**，与**门禁命令的输出原文**。没有作者的自述。')
  put('')
  put(`- 项目：\`${projectDir}\``)
  put(`- 阶段：\`${stageId}\`（${stage.name}，skill \`${stage.skill}\`）`)
  put('')

  const deep = flags.deep === true

  // ── 本轮变更（两种模式共用）──
  put('## 本轮变更（由 freeze 基线差量算出，不可伪造）')
  put('')
  const current = trackedFiles(projectDir).filter((entry) => !entry.rel.startsWith('docs/reviews/'))
  const currentHashes = new Map(current.map((entry) => [entry.rel, hashFile(entry.path)]))
  const prevBaseline = join(stateDir(projectDir), 'review', `freeze-before-r${round - 1}.json`)
  const hasBaseline = round > 1 && existsSync(prevBaseline)
  if (!hasBaseline) {
    put(`首次审查（第 1 轮）：没有上一轮基线，本轮需看**全部 ${current.length} 个文件**（清单见「待审产物清单」那节）。`)
    put('')
  } else {
    const before = new Map((readJson(prevBaseline, { files: [] }).files ?? []).map((entry) => [entry.rel, entry.sha256]))
    const added = [...currentHashes.keys()].filter((rel) => !before.has(rel))
    const modified = [...currentHashes.keys()].filter((rel) => before.has(rel) && before.get(rel) !== currentHashes.get(rel))
    const removed = [...before.keys()].filter((rel) => !currentHashes.has(rel))
    const listing = (items) => (items.length === 0 ? '（无）' : items.map((rel) => `\`${rel}\``).join('、'))
    put(`相对上一轮派发前（\`${short(prevBaseline)}\`）：`)
    put('')
    put(`- 新增 **${added.length}**：${listing(added)}`)
    put(`- 修改 **${modified.length}**：${listing(modified)}`)
    put(`- 删除 **${removed.length}**：${listing(removed)}`)
    put('')
    if (added.length + modified.length + removed.length === 0) {
      put('⚠️ 与上一轮基线相比**一个文件都没变**：这次"修复"可能没落盘，或者改在了别的地方。')
      put('')
    }
  }

  // ── 证据段：快审给"已证事实"，深审给"待核实声明 + 必须自己跑的命令" ──
  const facts = []
  if (deep) {
    put('## 待核实声明（**不是结论**，是前几轮声称的结果）')
    put('')
    put('下面每一条都只是**主张**。把它们当"待核实"，不要当"已确认"——深审的价值就在这里。')
    put('')
    let claims = 0
    for (const doc of ['docs/04-开发记录.md', 'docs/05-验收.md']) {
      const docPath = join(projectDir, doc)
      if (!existsSync(docPath)) continue
      readText(docPath).split(/\r?\n/).forEach((line, index) => {
        if (!line.startsWith('审查：')) return
        claims += 1
        put(`- \`${doc}:${index + 1}\` → ${line.slice(3).trim()}`)
      })
    }
    if (claims === 0) put('- ⚠️（没有找到任何 `审查：` 记录——这本身是一条 Finding）')
    put('')
    put('## 你必须自己重跑的命令（深审不认二手证据）')
    put('')
    put('```powershell')
    put(`node "$env:DSH_HOME\\plugin-creator\\gates\\pc.mjs" guard --project "${projectDir}"`)
    if (packageName !== undefined) {
      put(`node "$env:DSH_HOME\\plugin-creator\\gates\\pc.mjs" verify-install --name "${packageName}" --target "${packageTarget}"`)
    }
    put(`node "$env:DSH_HOME\\plugin-creator\\gates\\pc.mjs" gate --stage ${stageId} --round ${round} --project "${projectDir}"`)
    put('```')
    put('')
    if (packageName === undefined) {
      put('> 没有给 `--name`，所以清单里没有 `verify-install`。**安装态在这一轮仍然是未验证的**，请把它写成一条 Finding 或未验证项。')
      put('')
    }
  } else {
    put('## 已证事实（命令输出原文——**不要重跑**，只核对是否覆盖规则要求）')
    put('')
    facts.push([`gate --stage ${stageId} --round ${round}`, capture(SELF, ['gate', '--stage', stageId, '--project', projectDir, '--round', String(round)])])
    if (packageName !== undefined) {
      facts.push([`verify-install --name ${packageName}`, capture(SELF, ['verify-install', '--name', packageName, '--target', packageTarget])])
    } else {
      put('> 未提供 `--name`，本次没有 `verify-install` 的原文；安装态仍未验证。')
      put('')
    }
    for (const [label, result] of facts) {
      // 指纹对**展示出来的文本**（trim 后）求，审查员才能拿代码块内容自己复算一遍（H2）
      const shown = result.output.trim() === '' ? '(无输出)' : result.output.trim()
      put(`### \`${label}\` → 退出码 **${result.code}**　输出指纹 \`${sha256(shown).slice(0, 16)}\`（对下方代码块内容求 sha256）`)
      put('')
      // 四反引号：门禁输出里可能出现三反引号，短围栏会被自己截断
      put('````text')
      put(shown)
      put('````')
      put('')
    }
  }

  // ── 规则摘录（两种模式共用）──
  put('## 规则摘录（逐字摘自阶段 skill，未改写）')
  put('')
  const skillPath = join(MODE_DIR, 'skills', stage.skill, 'SKILL.md')
  if (existsSync(skillPath)) {
    const skillText = readText(skillPath)
    const excerpt = pickSection(skillText, '## 产出') ?? skillText
    // 四反引号：阶段 skill 自己带代码块，三反引号会提前闭合
    put('````markdown')
    put(excerpt.trim())
    put('````')
    put('')
    if (deep) {
      put(`原文：\`${skillPath}\`（${skillText.length} 字符）。深审可以读原文，也**可以读 \`gates/*.mjs\`**——这一轮的任务之一就是审计门禁自身。）`)
    } else {
      put(`原文：\`${skillPath}\`（${skillText.length} 字符）。要判定本文件之外的规则，再去读原文，不要通读 \`gates/*.mjs\`。`)
    }
  } else {
    put(`⚠️ 找不到阶段 skill：\`${skillPath}\``)
  }
  put('')

  // ── 判据摘录（共用）──
  put('## 成功判据摘录（逐字摘自 docs/01-需求.md）')
  put('')
  const requirementPath = join(projectDir, 'docs', '01-需求.md')
  if (existsSync(requirementPath)) {
    const requirementText = readText(requirementPath)
    const excerpt = pickSection(requirementText, '## 成功判据') ?? '（需求文档里找不到 `## 成功判据` 小节）'
    put(excerpt.trim())
  } else {
    put('⚠️ 找不到 `docs/01-需求.md`——没有判据就无法判断"做到没有"。')
  }
  put('')

  // ── 待审产物（共用）──
  put('## 待审产物清单')
  put('')
  for (const entry of current) put(`- \`${entry.rel}\`（${entry.size} B）`)
  put('')

  // ── 硬约束（按模式不同）──
  put('## 本轮的硬约束')
  put('')
  if (deep) {
    put('1. **不认二手证据**：上面的命令都要你自己跑一遍，用它们的真实输出说话。')
    put('2. 前几轮的结论只是「待核实声明」：逐条重验，**不许**引用它们当证据。')
    put('3. **审计门禁自身的洞**：如果发现某条规则门禁根本没检查，单独列一节 `## 门禁缺口` 写出来。')
    put('4. 输出：阻断/主要/次要**全部六字段**（深审是交付物，值得写全）。')
    put('5. 这是一次**抽样级**的严格复核，慢是应该的；不要为了快而跳过重跑。')
  } else {
    put('1. 「已证事实」那节的命令**已经执行过**，不要重跑；核对"这些输出是否覆盖了规则要求的每一项"。')
    put('2. 输出分级：阻断/主要写全六字段；**次要只写一行**。')
    put('3. 规则来源只有：`pc-review-protocol`、本阶段 skill、「成功判据摘录」那节。不要通读 `gates/*.mjs` 源码。')
    if (round > 1) put('4. **本轮是复审**：只查「本轮变更」列出的文件与上一轮 Finding，其余不必重读。')
    put('')
    put('> **例外（H1）**：如果「已证事实」里的结论与产物**直接矛盾**（例如它说 PASS，而产物明显不成立），')
    put('> 允许并**要求**重跑那一条命令，并在结论里写明"我重跑了 X，因为 Y"。矛盾处是伪造最可能藏身的地方。')
  }
  put('')

  const briefPath = join(projectDir, 'docs', 'reviews', deep ? `brief-r${round}-deep.md` : `brief-r${round}.md`)
  ensureDir(join(projectDir, 'docs', 'reviews'))
  const text = `${lines.join('\n').replace(/\s+$/, '')}\n`
  writeFileAtomic(briefPath, text)

  pass(`简报已写出：${short(briefPath)}${deep ? '（深审版）' : ''}`)
  evidence(`  ${text.length} 字符，sha256:${sha256(text).slice(0, 16)}`)
  evidence(`  变更来源：${hasBaseline ? short(prevBaseline) : '首次审查（全量）'}`)
  for (const [label, result] of facts) evidence(`  ${label} → 退出码 ${result.code}`)
  if (deep) {
    info('深审：明确要求审查员自己重跑门禁、并把前几轮结论当"待核实声明"。慢，但回到一手证据。')
  } else {
    info('派发时把这份文件作为「已证事实」路径给审查员，不要再让它重跑门禁。')
  }
  process.exit(finish(`派发简报 ${stageId} r${round}${deep ? '（深审）' : ''}`))
}

// ── 转发到子脚本 ────────────────────────────────────────────────────────────

if (SCRIPTS[command] !== undefined) {
  const args = forwardArgs()
  const withProject = command === 'check' || command === 'scaffold' ? args : ['--project', projectDir, ...args]
  process.exit(run(SCRIPTS[command], withProject))
}

if (command === 'verify-freeze') {
  process.exit(run('freeze.mjs', ['--project', projectDir, '--check', ...forwardArgs()]))
}
if (command === 'rollback') {
  // 允许 `rollback --version v2` 与 snapshot.mjs 的 `--rollback v2` 两种写法
  const forwarded = forwardArgs()
  if (flags.version !== undefined && flags.rollback === undefined) {
    const index = forwarded.indexOf('--version')
    if (index !== -1) forwarded.splice(index, 2, '--rollback', String(flags.version))
    else forwarded.push('--rollback', String(flags.version))
  }
  process.exit(run('snapshot.mjs', ['--project', projectDir, ...forwarded]))
}

usage(`未知命令：${command}`)

/** 列出目录里的子目录名（目录不存在时返回空）。 */
function readdirSyncSafe(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

/**
 * 解析 `init --keep`：数字 / all。
 *
 * 非法值回落默认并要求用 `snapshot --keep` 显式改：初始化不该因为一个笔误停下，
 * 但也不该把笔误当成"用户想要 0 版"而静默丢掉所有回退点。
 * @param {unknown} raw 命令行原值
 * @returns {number|'all'} 保留策略
 */
function parseKeep(raw) {
  if (raw === undefined || raw === true) return DEFAULT_KEEP
  const text = String(raw).trim().toLowerCase()
  if (text === 'all' || text === '全部') return 'all'
  const parsed = Number.parseInt(text, 10)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_KEEP
}

/**
 * 跑一条门禁命令，把 stdout+stderr 抓回来当证据。
 *
 * 用「重定向到临时文件」而不是管道：受限沙箱下管道 stdio 会被拒绝，重定向在那种环境同样可用。
 * 因此这里拿不到流式输出，但简报要的本来就是"跑完之后的原文"。
 * @param {string} script 要跑的脚本绝对路径
 * @param {string[]} args 参数
 * @returns {{code: number, output: string}} 退出码与输出原文
 */
function capture(script, args) {
  const outFile = join(tmpdir(), `pc-brief-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.log`)
  const fd = openSync(outFile, 'w')
  let code = 1
  try {
    const result = spawnSync(process.execPath, [script, ...args], { stdio: ['ignore', fd, fd] })
    code = result.status ?? 1
  } finally {
    closeSync(fd)
  }
  const output = existsSync(outFile) ? readText(outFile) : ''
  try {
    rmSync(outFile, { force: true })
  } catch {
    // 临时文件删不掉不影响结论
  }
  return { code, output }
}

/**
 * 取 markdown 里某个二级标题到**下一个同级标题**之间的原文。
 * 摘录必须逐字：简报里只搬运，不改写。
 * @param {string} text 原文
 * @param {string} heading 二级标题，例如 `## 产出`
 * @returns {string|undefined} 原文片段；找不到标题时返回 undefined
 */
function pickSection(text, heading) {
  const start = text.indexOf(heading)
  if (start === -1) return undefined
  const rest = text.slice(start + heading.length)
  const next = rest.search(/^## /m)
  return next === -1 ? text.slice(start) : text.slice(start, start + heading.length + next)
}
