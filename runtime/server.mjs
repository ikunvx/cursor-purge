#!/usr/bin/env node
/**
 * Cursor MCP bridge for the DSH redteam store.
 *
 * Minimal-change design:
 *   - All facts (assets/vulns/evidence/credentials/webshells/tunnels/scores/POC)
 *     live in DSH's RedteamStore, rooted at ~/.cursor-purge.
 *   - Tool names match DSH's redteam_* tools, so the copied role prompts and
 *     skills keep working.
 *   - Shell network tools are guarded by Cursor's beforeShellExecution hook
 *     (bin/cursor-scope-guard.mjs).
 */
import { createInterface } from 'node:readline'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
  DATA_ROOT, ensureConfig, ensureDataRoot, loadDsh, readJson, writeJson,
  engagementFor, engagementView, readScope, writeScope, writeBinding, readBindings,
  normalizeScope, isExpired, scopePath,
} from './dsh-bridge.mjs'

const SERVER = { name: 'cursor-purge', version: '1.0.0' }
const PROTOCOL = '2024-11-05'
const CWD = process.env.CURSOR_PROJECT_DIR || process.cwd()
const MAX_TEXT = 200_000

let store = null
let dsh = null
let initError = null
const slots = new Map() // engagement -> [{ key, role, at }]

function log(...args) { if (process.env.CURSOR_PURGE_DEBUG === '1') console.error('[cursor-purge] ' + args.map((a) => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')) }

async function init() {
  try {
    ensureConfig(DATA_ROOT)
    dsh = await loadDsh()
    store = new dsh.RedteamStore(DATA_ROOT)
    log('store ready', DATA_ROOT, 'dsh=', dsh.file)
  } catch (error) {
    initError = error
    console.error('[cursor-purge] store init failed: ' + (error && error.message ? error.message : String(error)))
  }
}

function requireStore() {
  if (!store) throw new Error(initError ? initError.message : 'redteam store 未初始化')
  return store
}

function nowIso() { return new Date().toISOString() }
function plusHours(h) { return new Date(Date.now() + h * 3600_000).toISOString() }

function engagementId(args = {}) {
  const id = engagementFor(requireStore(), DATA_ROOT, CWD, args.engagement)
  if (!id) {
    throw new Error('尚未绑定靶标：请先调用 redteam_engagement_open（新建/打开）或 redteam_session_bind')
  }
  return id
}

function clampText(text) {
  const s = typeof text === 'string' ? text : JSON.stringify(text, null, 2)
  if (s.length <= MAX_TEXT) return s
  return s.slice(0, MAX_TEXT) + `\n\n[truncated ${s.length - MAX_TEXT} chars]`
}

function textResult(value, isError = false) {
  return {
    content: [{ type: 'text', text: clampText(value) }],
    ...(isError ? { isError: true } : {}),
  }
}

function resultOk(value) {
  const ok = !(value && typeof value === 'object' && value.ok === false)
  return textResult(value === undefined ? { ok: true } : value, !ok)
}

/* ------------------------------------------------------------------ tools */

const tools = new Map()
function register(name, description, properties = {}, handler, required = []) {
  tools.set(name, {
    name,
    description,
    inputSchema: {
      type: 'object',
      properties: Object.assign({ engagement: { type: 'string', description: '靶标 id；省略则用当前工作区绑定' } }, properties),
      ...(required.length ? { required } : {}),
      additionalProperties: true,
    },
    handler,
  })
}

/* --- engagement / preflight ------------------------------------------------ */

register('redteam_engagement_open', '创建/打开一个授权靶标并绑定到当前 Cursor 工作区。scope 只接受 IPv4/CIDR，domains 接受域名；拒绝 0.0.0.0/0 与过宽公网段。', {
  name: { type: 'string', description: '靶标单位/项目名称' },
  scope: { type: 'array', items: { type: 'string' }, description: '授权 CIDR/IP 列表，例如 ["10.0.0.0/24","192.168.1.10"]' },
  domains: { type: 'array', items: { type: 'string' }, description: '授权域名列表，例如 ["example.com"]' },
  authorization_ref: { type: 'string', description: '授权书/工单编号或授权说明' },
  expires_at: { type: 'string', description: '授权到期时间 ISO；省略默认 24h' },
  high_risk: { type: 'boolean', description: '是否允许利用/隧道/内网等高危动作' },
  notes: { type: 'string' },
  bind: { type: 'boolean', description: '默认 true：绑定到当前工作区' },
}, async (args) => {
  const s = requireStore()
  const name = String(args.name || '').trim()
  if (!name) return { ok: false, error: 'name 必填' }
  const normalized = normalizeScope(args.scope || [], args.domains || [])
  if (normalized.errors.length) return { ok: false, error: '授权范围校验失败', details: normalized.errors }
  let expires = args.expires_at || plusHours(24)
  const ts = Date.parse(expires)
  if (!Number.isFinite(ts)) return { ok: false, error: `expires_at 不是合法时间：${expires}` }
  const opened = s.openEngagement(name, normalized.cidrs, { bindCurrent: true })
  const scope = {
    cidrs: normalized.cidrs,
    domains: normalized.domains,
    authorization_ref: String(args.authorization_ref || '').trim(),
    expires_at: new Date(ts).toISOString(),
    high_risk: args.high_risk === true,
    notes: String(args.notes || ''),
  }
  writeScope(DATA_ROOT, opened.id, scope)
  if (args.bind !== false) writeBinding(DATA_ROOT, CWD, opened.id)
  const warnings = [...normalized.warnings]
  if (!scope.authorization_ref) warnings.push('未填写 authorization_ref：建议补授权书/工单号，否则报告缺少授权依据。')
  if (!scope.high_risk) warnings.push('high_risk=false：利用/隧道/内网等高危动作默认拒绝。')
  return {
    ok: true,
    engagement: { id: opened.id, name: opened.name, scope: opened.scope },
    scope,
    warnings,
    next: '调用 redteam_preflight，然后按五阶段派发 Agent',
  }
})

register('redteam_session_bind', '把当前工作区绑定到一个已存在的靶标。', {
  engagement: { type: 'string', description: '靶标 id' },
}, async (args) => {
  const s = requireStore()
  const id = String(args.engagement || '').trim()
  if (!id) return { ok: false, error: 'engagement 必填' }
  const view = engagementView(s, id)
  if (!view) return { ok: false, error: `靶标不存在：${id}` }
  s.setActiveEngagement(id)
  writeBinding(DATA_ROOT, CWD, id)
  return { ok: true, engagement: view, scope: readScope(DATA_ROOT, id) }
})

register('redteam_session_info', '当前工作区绑定的靶标、授权范围、过期状态与绑定表。', {}, async () => {
  const s = requireStore()
  const id = engagementFor(s, DATA_ROOT, CWD)
  return {
    ok: true,
    cwd: CWD,
    data_root: DATA_ROOT,
    dsh_store: dsh.file,
    engagement: id ? engagementView(s, id) : null,
    scope: id ? readScope(DATA_ROOT, id) : null,
    expired: id ? isExpired(readScope(DATA_ROOT, id)) : false,
    bindings: readBindings(DATA_ROOT),
    engagements: s.listEngagements(),
  }
})

const HIGH_RISK = new Set(['fscan', 'gogo', 'suo5', 'frpc', 'frps', 'chisel', 'sqlmap', 'impacket', 'masscan', 'ncat'])

register('redteam_preflight', '检查 DSH store、工具路径、nuclei 模板、授权范围与过期状态。不发起网络请求。', {}, async () => {
  const s = requireStore()
  const config = ensureConfig(DATA_ROOT)
  const id = engagementFor(s, DATA_ROOT, CWD)
  const scope = id ? readScope(DATA_ROOT, id) : null
  const view = id ? engagementView(s, id) : null
  const toolRows = Object.entries(config.tools || {}).map(([name, path]) => ({
    name, path, exists: existsSync(path), category: HIGH_RISK.has(name) ? 'high-risk' : 'recon',
  }))
  const missing = toolRows.filter((t) => !t.exists).map((t) => t.name)
  const templatesDir = config.nucleiTemplatesDir
  const templateExists = templatesDir ? existsSync(templatesDir) : false
  const expired = scope ? isExpired(scope) : false
  const warnings = []
  if (!id) warnings.push('还没有绑定靶标：先 redteam_engagement_open')
  if (scope && scope.cidrs.length === 0 && scope.domains.length === 0) warnings.push('授权范围为空：网络工具会被 hook 拒绝')
  if (scope && !scope.authorization_ref) warnings.push('缺少 authorization_ref')
  if (expired) warnings.push('授权已过期：请更新 expires_at')
  if (missing.length) warnings.push(`缺少工具：${missing.join(', ')}`)
  if (!templateExists) warnings.push(`nuclei 模板目录不可用：${templatesDir}`)
  return {
    ok: true,
    data_root: DATA_ROOT,
    dsh_store: dsh.file,
    toolkit_dir: config.toolkitDir,
    tools: toolRows,
    nuclei_templates: { dir: templatesDir, exists: templateExists },
    env: {
      FOFA_KEY: !!(config.env && config.env.FOFA_KEY),
      VPS_HOST: (config.env && config.env.REDTEAM_VPS_HOST) || '',
      VPS_KEY_EXISTS: !!(config.env && config.env.REDTEAM_VPS_KEY && existsSync(config.env.REDTEAM_VPS_KEY)),
    },
    engagement: view,
    scope,
    expired,
    warnings,
    onboarding: {
      complete: !!id && !expired && missing.length === 0,
      first_run: !id,
      missing,
      high_risk: scope ? scope.high_risk === true : false,
      setup_script: { exists: existsSync(join(DATA_ROOT, 'setup.sh')), path: join(DATA_ROOT, 'setup.sh') },
      toolkit: { dir: config.toolkitDir, exists: existsSync(config.toolkitDir) },
    },
  }
})

register('redteam_agent_slot', '并发闸门（最多 3 个执行 Agent）。action=status|acquire|release。Cursor 不会自动释放，任务结束后必须 release。', {
  action: { type: 'string', enum: ['status', 'acquire', 'release'], description: '默认 status' },
  role: { type: 'string', description: 'recon|assess|vuln-scan|exploit|internal' },
  key: { type: 'string', description: 'acquire 返回的 key；release 时优先使用' },
}, async (args) => {
  const id = engagementId(args)
  const max = 3
  const list = (slots.get(id) || []).filter((x) => Date.now() - x.at < 2 * 3600_000)
  slots.set(id, list)
  const action = args.action || 'status'
  if (action === 'status') return { ok: true, engagement: id, max, active: list.length, slots: list }
  if (action === 'acquire') {
    const role = String(args.role || '').trim()
    if (!role) return { ok: false, error: 'role 必填' }
    if (list.length >= max) return { ok: false, error: `并发已满（${list.length}/${max}）`, slots: list }
    const key = `${role}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    list.push({ key, role, at: Date.now() })
    slots.set(id, list)
    return { ok: true, engagement: id, key, active: list.length, max, note: '任务结束后调用 action=release key=...' }
  }
  if (action === 'release') {
    const key = String(args.key || '').trim()
    const role = String(args.role || '').trim()
    const next = list.filter((x) => key ? x.key !== key : x.role !== role)
    slots.set(id, next)
    return { ok: true, engagement: id, released: list.length - next.length, active: next.length, slots: next }
  }
  return { ok: false, error: `未知 action：${action}` }
})

register('redteam_scope_get', '读取当前靶标的授权范围。', {}, async (args) => {
  const id = engagementId(args)
  return { ok: true, engagement: id, scope: readScope(DATA_ROOT, id), path: scopePath(DATA_ROOT, id) }
})

register('redteam_scope_update', '更新授权范围/到期时间/高危开关；cidrs/domains 为替换，add_cidrs/add_domains 为追加。', {
  cidrs: { type: 'array', items: { type: 'string' } },
  domains: { type: 'array', items: { type: 'string' } },
  add_cidrs: { type: 'array', items: { type: 'string' } },
  add_domains: { type: 'array', items: { type: 'string' } },
  authorization_ref: { type: 'string' },
  expires_at: { type: 'string' },
  high_risk: { type: 'boolean' },
  notes: { type: 'string' },
}, async (args) => {
  const s = requireStore()
  const id = engagementId(args)
  const view = engagementView(s, id)
  if (!view) return { ok: false, error: `靶标不存在：${id}` }
  const old = readScope(DATA_ROOT, id)
  const cidrs = args.cidrs !== undefined ? args.cidrs : [...old.cidrs, ...(args.add_cidrs || [])]
  const domains = args.domains !== undefined ? args.domains : [...old.domains, ...(args.add_domains || [])]
  const normalized = normalizeScope(cidrs, domains)
  if (normalized.errors.length) return { ok: false, error: '授权范围校验失败', details: normalized.errors }
  const expires = args.expires_at || old.expires_at || plusHours(24)
  const ts = Date.parse(expires)
  if (!Number.isFinite(ts)) return { ok: false, error: `expires_at 不是合法时间：${expires}` }
  s.openEngagement(view.name, normalized.cidrs, { bindCurrent: false })
  const scope = {
    cidrs: normalized.cidrs,
    domains: normalized.domains,
    authorization_ref: args.authorization_ref !== undefined ? String(args.authorization_ref) : old.authorization_ref,
    expires_at: new Date(ts).toISOString(),
    high_risk: args.high_risk !== undefined ? args.high_risk === true : old.high_risk,
    notes: args.notes !== undefined ? String(args.notes) : old.notes,
  }
  writeScope(DATA_ROOT, id, scope)
  return { ok: true, engagement: id, scope, warnings: normalized.warnings }
})

/* --- assets ---------------------------------------------------------------- */

register('redteam_asset_add', '写入资产（幂等 upsert），可带 names/ports/服务/指纹。provenance 必填 passive|active。', {
  ip: { type: 'string', description: '资产 IPv4' },
  state: { type: 'string', description: 'live|dead|unknown' },
  primary_name: { type: 'string' },
  provenance: { type: 'string', enum: ['passive', 'active'] },
  tool: { type: 'string' },
  discovered_at: { type: 'string' },
  first_seen: { type: 'string' },
  names: { type: 'array', items: { type: 'object', additionalProperties: true } },
  ports: { type: 'array', items: { type: 'object', additionalProperties: true } },
}, async (args) => {
  const s = requireStore()
  const id = engagementId(args)
  if (!args.ip) return { ok: false, error: 'ip 必填' }
  if (!args.provenance) return { ok: false, error: 'provenance 必填（passive|active）' }
  const asset = {
    ip: args.ip, state: args.state, primary_name: args.primary_name,
    provenance: args.provenance, tool: args.tool,
    names: args.names, ports: args.ports,
    discovered_at: args.discovered_at, first_seen: args.first_seen,
  }
  const r = s.importBundle(id, { scan: { tool: args.tool || 'cursor-purge', argv: ['redteam_asset_add'] }, assets: [asset] })
  const written = s.listAssets(id, { ip: args.ip, limit: 1 }).items[0] || null
  return { ok: true, engagement: id, counts: r.counts, asset: written, discovered_at: written && written.discovered_at }
}, ['ip', 'provenance'])

register('redteam_asset_link', '写入资产关系边（resolves/exposes/contains/trusts/shares_cert 等）。', {
  src_kind: { type: 'string' }, src_id: { type: 'string' },
  dst_kind: { type: 'string' }, dst_id: { type: 'string' },
  relation: { type: 'string' }, confidence: { type: 'number' },
}, async (args) => {
  const s = requireStore()
  const id = engagementId(args)
  for (const k of ['src_kind', 'src_id', 'dst_kind', 'dst_id', 'relation']) {
    if (!args[k]) return { ok: false, error: `${k} 必填` }
  }
  const r = s.importBundle(id, { edges: [{
    src_kind: args.src_kind, src_id: args.src_id, dst_kind: args.dst_kind,
    dst_id: args.dst_id, relation: args.relation, confidence: args.confidence,
  }] })
  return { ok: true, engagement: id, edges: r.counts.edges }
}, ['src_kind', 'src_id', 'dst_kind', 'dst_id', 'relation'])

/* --- reports / audit -------------------------------------------------------- */

register('redteam_report_save', '生成并保存报告到 ~/.cursor-purge/reports；format=score（只收录得分成果）| full。', {
  format: { type: 'string', enum: ['score', 'full'], description: '默认 score' },
  limit: { type: 'number' },
  include_markdown: { type: 'boolean', description: '默认 false，只返回摘要与路径' },
}, async (args) => {
  const s = requireStore()
  const id = engagementId(args)
  const fmt = args.format === 'full' ? 'full' : 'score'
  const r = fmt === 'score' ? s.scoreReport(id, { limit: args.limit }) : s.report(id)
  const dir = join(DATA_ROOT, 'reports')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = join(dir, `${id}-${fmt}-${stamp}.md`)
  writeFileSync(file, r.markdown || '', 'utf8')
  return {
    ok: true, engagement: id, format: fmt, file,
    summary: r.summary || null,
    ...(args.include_markdown ? { markdown: r.markdown } : {}),
  }
})

register('redteam_audit_tail', '查看 scope hook 审计日志（最近 N 条）。', {
  limit: { type: 'number', description: '默认 50' },
}, async (args) => {
  const file = join(DATA_ROOT, 'audit', 'scope.ndjson')
  if (!existsSync(file)) return { ok: true, file, items: [] }
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-Math.min(Number(args.limit) || 50, 500))
  return { ok: true, file, items: lines.map((l) => { try { return JSON.parse(l) } catch { return { raw: l } } }) }
})

/* --- generic escape hatch --------------------------------------------------- */

register('redteam_api', '直接调用 DSH redteam dispatch。op 见 DSH store-core（assets/addVuln/addChainStep/scoreReport/pocSearch…）。', {
  op: { type: 'string', description: 'dispatch op 名称' },
  args: { type: 'object', description: '传给 op 的参数对象；也可平铺在顶层' },
}, async (args) => {
  const s = requireStore()
  const op = String(args.op || '').trim()
  if (!op) return { ok: false, error: 'op 必填' }
  const flat = Object.assign({}, args)
  delete flat.op
  delete flat.args
  const req = Object.assign(flat, args.args || {})
  if (req.engagement) req.engagement = engagementId({ engagement: req.engagement })
  else if (!['bootstrap', 'pocSearch', 'pocList', 'pocGet', 'pocSave', 'pocUpdate', 'pocDelete', 'pocUse', 'pocStats', 'platformConfigGet'].includes(op)) {
    req.engagement = engagementId({})
  }
  return dsh.dispatchAsync(s, Object.assign({ op }, req))
}, ['op'])

/* --- thin forwarders to DSH dispatch ops ------------------------------------ */

const FORWARD = {
  redteam_asset_query: ['assets', '查询资产（过滤/分页）'],
  redteam_asset_get: ['asset', '按 id 读取资产详情'],
  redteam_asset_stats: ['stats', '资产总览统计'],
  redteam_asset_graph: ['graph', '资产关系图'],
  redteam_asset_test: ['assetTest', '回写资产测试状态/剩余面/封禁'],
  redteam_asset_assess: ['assessAsset', '回写资产评估 priority/potential/reason'],
  redteam_asset_timeline: ['discoveryTimeline', '资产发现时间线'],
  redteam_vuln_add: ['addVuln', '写入漏洞'],
  redteam_vuln_query: ['vulns', '查询漏洞'],
  redteam_vuln_update: ['updateVuln', '更新漏洞状态/证据'],
  redteam_credential_add: ['addCredential', '登记凭据'],
  redteam_credential_list: ['credentials', '列出凭据'],
  redteam_shot_add: ['shotAdd', '登记证据截图'],
  redteam_shot_list: ['shots', '列出证据截图'],
  redteam_shot_delete: ['shotDelete', '删除证据截图'],
  redteam_access_add: ['addAccess', '登记访问会话/账号权限'],
  redteam_access_list: ['access', '列出访问会话'],
  redteam_sessions: ['sessions', 'WebShell/隧道/凭据一屏总览'],
  redteam_session_check: ['probeSessions', '实测 WebShell/隧道连通性并回写'],
  redteam_webshell_add: ['addWebshell', '登记 WebShell'],
  redteam_webshell_list: ['webshells', '列出 WebShell'],
  redteam_webshell_update: ['updateWebshell', '更新 WebShell 状态'],
  redteam_tunnel_add: ['addTunnel', '登记隧道'],
  redteam_tunnel_list: ['tunnels', '列出隧道'],
  redteam_tunnel_update: ['updateTunnel', '更新隧道状态'],
  redteam_attack_path: ['attackGraph', '攻击图谱（含已控资产）'],
  redteam_web_list: ['web', 'Web 资产清单'],
  redteam_domain_index: ['domains', '域名索引'],
  redteam_score_list: ['scores', '计分点与实际得分'],
  redteam_score_hit: ['addScoreHit', '记分'],
  redteam_score_point_save: ['saveScorePoint', '自定义计分点'],
  redteam_http_evidence_add: ['addHttpEvidence', '保存原始 HTTP 请求/响应证据'],
  redteam_chain_add: ['addChainStep', '写攻击链步骤'],
  redteam_chain: ['chain', '读取完整攻击链'],
  redteam_attack_chain: ['scoreChain', '五阶段攻击链与得分'],
  redteam_attack_file_add: ['addAttackFile', '归档实际生效的攻击文件'],
  redteam_attack_file_list: ['attackFiles', '攻击文件树'],
  redteam_report_targets: ['reportTargets', '按目标汇总成果'],
  redteam_score_report: ['scoreReport', '生成得分成果报告'],
  redteam_report: ['report', '生成完整报告（含未得分项）'],
  redteam_poc_search: ['pocSearch', '检索 POC 知识库 + 本机 nuclei 模板'],
  redteam_poc_get: ['pocGet', '取 POC 全文'],
  redteam_poc_add: ['pocSave', '回填 POC 知识库'],
  redteam_poc_list: ['pocList', '列出 POC'],
  redteam_poc_update: ['pocUpdate', '更新 POC'],
  redteam_poc_use: ['pocUse', '标记 POC 复用'],
  redteam_role_prompt: ['prompts', '读取角色提示词'],
  redteam_roles: ['prompts', '列出角色'],
  redteam_role_prompt_reset: ['resetPrompts', '重置角色提示词'],
}

const S = (description) => ({ type: 'string', description })
const N = (description) => ({ type: 'number', description })
const B = (description) => ({ type: 'boolean', description })
const A = (description, items = { type: 'string' }) => ({ type: 'array', items, description })

const FORWARD_PROPS = {
  redteam_asset_query: { q: S('关键字/IP/域名'), priority: S('high|medium|low'), status: S('测试状态'), sort: S('priority|todo|recent 等'), limit: N('默认 100'), offset: N() },
  redteam_asset_get: { id: N('资产 id') },
  redteam_asset_graph: { cidr: S('按 C 段缩小'), maxNodes: N() },
  redteam_asset_test: { asset_id: N('资产 id'), ip: S('或 ip'), status: S('untested|testing|tested|blocked|abandoned|no_surface'), test: S('测试结论（追加）'), surface: S('剩余攻击面'), blocked: B('被封一次') },
  redteam_asset_assess: { asset_id: N('资产 id'), ip: S('或 ip'), priority: S('high|medium|low'), potential: S('预期成果'), reason: S('判断理由') },
  redteam_vuln_add: { asset_id: N(), target: S('目标 IP/URL'), title: S('漏洞标题'), severity: S('critical|high|medium|low|info'), cve: S(), evidence: S('回显/响应特征'), confidence: N('0-1'), status: S('candidate|confirmed'), gained: S('能拿到什么'), agent: S() },
  redteam_vuln_query: { target: S(), status: S('candidate|confirmed|exploited|false-positive'), severity: S(), limit: N() },
  redteam_vuln_update: { id: N('漏洞 id'), status: S('candidate|confirmed|exploited|false-positive|fixed'), severity: S(), gained: S(), evidence: S() },
  redteam_credential_add: { target: S(), username: S(), secret_value: S('明文口令/哈希'), source: S('弱口令/注入/配置泄露/复用/默认口令'), tool: S('实际命令'), note: S() },
  redteam_access_add: { target: S(), method: S('web-login|reverse-shell|ssh|rdp|db 等'), username: S(), detail: S() },
  redteam_webshell_add: { url: S(), shell_type: S('behinder|godzilla|antsword'), pass_key: S(), privilege: S('user|admin|root'), status: S('online|offline|unknown'), note: S() },
  redteam_webshell_update: { id: N('WebShell id'), status: S('online|offline|unknown'), note: S() },
  redteam_tunnel_add: { kind: S('suo5|chisel|frp|socks5 等'), listen: S('本机监听，如 127.0.0.1:1080'), entry: S('目标侧入口'), reach: S('可达网段'), entry_kind: S('target-http|target-tcp 等'), command: S('完整命令'), status: S('active|down|unknown'), note: S() },
  redteam_tunnel_update: { id: N('隧道 id'), status: S('active|down|unknown'), listen: S(), reach: S(), note: S() },
  redteam_score_hit: { code: S('redteam_score_list 返回的 code'), target: S(), evidence: S('结果证据（目标+拿到了什么）'), points: N('通常由规则决定') },
  redteam_http_evidence_add: { vuln_id: N(), asset_id: N(), label: S(), method: S(), url: S(), status: N('响应码'), request: S('完整原始请求'), response: S('响应摘要/全文'), note: S(), captured_by: S() },
  redteam_chain_add: { stage_code: S('recon|internet|boundary|internal|target'), action: S('这一步做了什么'), tool: S('实际命令'), result: S('回显摘要'), target: S(), point_code: S('可选：同时记分') },
  redteam_attack_file_add: { target: S(), name: S('文件名'), content: S('文件内容/脚本'), evidence: S('验证效果，如 uid=0') },
  redteam_report_targets: { target: S() },
  redteam_score_report: { limit: N(), markdown: B('默认 true') },
  redteam_poc_search: { q: S('关键字'), cve: S(), component: S(), category: S(), limit: N() },
  redteam_poc_get: { id: N(), code: S() },
  redteam_poc_add: { code: S('稳定 slug'), title: S(), kind: S('poc|exp|script|template|payload'), category: S(), cve: S(), component: S(), description: S(), usage: S(), source: S(), verified: B(), verified_note: S() },
  redteam_poc_update: { id: N(), code: S(), patch: { type: 'object', additionalProperties: true } },
  redteam_poc_use: { id: N(), code: S(), used_on: S() },
  redteam_poc_list: { limit: N() },
  redteam_role_prompt: { role: S('plan|recon|assess|vuln-scan|exploit|internal') },
  redteam_role_prompt_reset: { role: S('省略则重置全部') },
  redteam_shot_add: { path: S('本机图片路径'), label: S('证明什么'), kind: S('screenshot|card') },
  redteam_shot_delete: { id: N('截图 id') },
  redteam_session_check: { timeoutMs: N('单次探测超时，默认 6000') },
}

for (const [name, [op, desc]] of Object.entries(FORWARD)) {
  register(name, `${desc}（DSH op=${op}）`, FORWARD_PROPS[name] || {}, async (args) => {
    const s = requireStore()
    const req = Object.assign({}, args, { op })
    if (!name.startsWith('redteam_poc_') && !['redteam_roles', 'redteam_role_prompt', 'redteam_role_prompt_reset'].includes(name)) {
      req.engagement = engagementId(args)
    }
    const res = await dsh.dispatchAsync(s, req)
    if (name === 'redteam_role_prompt' && res && res.ok && Array.isArray(res.roles) && args.role) {
      res.roles = res.roles.filter((r) => r.role === args.role)
    }
    return res
  })
}

/* ------------------------------------------------------------------ MCP */

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

function toolList() {
  return [...tools.values()].map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
}

async function handle(msg) {
  const { id, method, params } = msg
  if (method === 'initialize') {
    return send({
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: (params && params.protocolVersion) || PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER,
      },
    })
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} })
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: toolList() } })
  if (method === 'resources/list') return send({ jsonrpc: '2.0', id, result: { resources: [] } })
  if (method === 'prompts/list') return send({ jsonrpc: '2.0', id, result: { prompts: [] } })
  if (method === 'tools/call') {
    const name = params && params.name
    const args = (params && params.arguments) || {}
    const tool = tools.get(name)
    if (!tool) return send({ jsonrpc: '2.0', id, result: textResult({ ok: false, error: `未知工具：${name}` }, true) })
    try {
      if (initError) throw initError
      const value = await tool.handler(args)
      return send({ jsonrpc: '2.0', id, result: resultOk(value) })
    } catch (error) {
      return send({
        jsonrpc: '2.0', id,
        result: textResult({ ok: false, error: error && error.message ? error.message : String(error) }, true),
      })
    }
  }
  // Unknown method: JSON-RPC method-not-found
  send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } })
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
let queue = Promise.resolve()
rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  queue = queue.then(async () => {
    let msg
    try { msg = JSON.parse(trimmed) } catch (e) {
      log('bad json', e.message)
      return
    }
    if (Array.isArray(msg)) {
      for (const item of msg) await handle(item)
    } else {
      await handle(msg)
    }
  }).catch((e) => log('handler error', e && e.stack ? e.stack : e))
})

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
function shutdown() {
  try { if (store) store.close() } catch { /* ignore */ }
  process.exit(0)
}

await init()
log('ready', SERVER.name, SERVER.version)
