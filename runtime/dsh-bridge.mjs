/**
 * DSH redteam bridge.
 *
 * The data layer is not reimplemented: we import the zero-dependency
 * RedteamStore / dispatch() from an installed dsh-purge package at runtime.
 * This is the "minimal change" path — Cursor sees the same assets, vulns,
 * evidence, credentials, webshells, tunnels, score points and POC knowledge
 * base as DSH, but under an independent data root (~/.cursor-purge).
 *
 * IMPORTANT: dsh-purge is commercial software. This module does not copy,
 * vendor or redistribute its source. It only imports the copy already
 * installed and licensed on this machine. See NOTICE.md.
 */
import {
  existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, renameSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'

export const HOME = homedir()
export const DATA_ROOT = process.env.CURSOR_PURGE_HOME || process.env.QODER_PURGE_HOME || join(HOME, '.cursor-purge')
export const DSH_HOME = process.env.DSH_HOME || join(HOME, '.dsh')

const STORE_REL = join('lib', 'redteam', 'store-core.js')

function uniqueExisting(list) {
  const seen = new Set()
  return list.filter((p) => {
    if (!p || seen.has(p)) return false
    seen.add(p)
    try { return existsSync(p) && statSync(p).isFile() } catch { return false }
  })
}

/** Candidate store-core.js paths, most explicit first. */
export function dshStoreCandidates() {
  const out = []
  if (process.env.CURSOR_PURGE_DSH_STORE) out.push(process.env.CURSOR_PURGE_DSH_STORE)
  const profiles = join(DSH_HOME, 'profiles')
  for (const p of ['desktop', 'web', 'cli']) {
    out.push(join(profiles, p, 'node_modules', 'dsh-purge', STORE_REL))
    out.push(join(profiles, p, 'vendor', 'dsh-purge', STORE_REL))
  }
  try {
    for (const name of readdirSync(profiles)) {
      out.push(join(profiles, name, 'node_modules', 'dsh-purge', STORE_REL))
      out.push(join(profiles, name, 'vendor', 'dsh-purge', STORE_REL))
    }
  } catch { /* no profiles dir */ }
  return uniqueExisting(out)
}

export function findDshStore() {
  const found = dshStoreCandidates()[0]
  if (!found) {
    throw new Error(
      '找不到 dsh-purge 的 redteam store-core.js。请先在本机安装并授权 DeepSeek Harness 的 dsh-purge 插件，'
      + '或设置环境变量 CURSOR_PURGE_DSH_STORE 指向 store-core.js。已检查：\n'
      + dshStoreCandidates().join('\n'),
    )
  }
  return found
}

let _dsh = null
/** Load { RedteamStore, dispatch, dispatchAsync, DEFAULT_PROMPTS } from DSH. */
export async function loadDsh() {
  if (_dsh) return _dsh
  const file = findDshStore()
  const mod = await import(pathToFileURL(resolve(file)).href)
  for (const key of ['RedteamStore', 'dispatch', 'dispatchAsync']) {
    if (typeof mod[key] !== 'function') throw new Error(`dsh-purge store-core 缺少导出：${key}`)
  }
  _dsh = {
    file,
    RedteamStore: mod.RedteamStore,
    dispatch: mod.dispatch,
    dispatchAsync: mod.dispatchAsync,
    DEFAULT_PROMPTS: mod.DEFAULT_PROMPTS || {},
    ROLE_TITLES: mod.ROLE_TITLES || {},
  }
  return _dsh
}

export function ensureDataRoot(root = DATA_ROOT) {
  mkdirSync(root, { recursive: true })
  mkdirSync(join(root, 'engagements'), { recursive: true })
  mkdirSync(join(root, 'reports'), { recursive: true })
  mkdirSync(join(root, 'audit'), { recursive: true })
  return root
}

export function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return fallback }
}

export function writeJson(file, value) {
  mkdirSync(resolve(file, '..'), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(tmp, file)
}

const DEFAULT_TOOLS = {
  nmap: 'D:/Dev/Tools/RedTeam/nmap/nmap-7.92/nmap.exe',
  nuclei: 'D:/Dev/Tools/RedTeam/nuclei/nuclei.exe',
  masscan: 'D:/Dev/Tools/RedTeam/masscan/masscan.exe',
  fscan: 'D:/Dev/Tools/RedTeam/fscan/fscan.exe',
  gogo: 'D:/Dev/Tools/RedTeam/gogo/gogo.exe',
  suo5: 'D:/Dev/Tools/RedTeam/suo5/suo5.exe',
  frpc: 'D:/Dev/Tools/RedTeam/frp/frpc.exe',
  frps: 'D:/Dev/Tools/RedTeam/frp/frps.exe',
  chisel: 'D:/Dev/Tools/RedTeam/chisel/chisel.exe',
  ffuf: 'D:/Dev/Tools/RedTeam/ffuf/ffuf.exe',
  httpx: 'D:/Dev/Tools/RedTeam/httpx/httpx.exe',
  dnsx: 'D:/Dev/Tools/RedTeam/dnsx/dnsx.exe',
  subfinder: 'D:/Dev/Tools/RedTeam/subfinder/subfinder.exe',
  ksubdomain: 'D:/Dev/Tools/RedTeam/ksubdomain/ksubdomain.exe',
  impacket: 'D:/Dev/Tools/RedTeam/bin/impacket-secretsdump.cmd',
  naabu: 'D:/Dev/Tools/RedTeam/naabu/naabu.exe',
  gobuster: 'D:/Dev/Tools/RedTeam/gobuster/gobuster.exe',
  feroxbuster: 'D:/Dev/Tools/RedTeam/feroxbuster/feroxbuster.exe',
  ncat: 'D:/Dev/Tools/RedTeam/nmap/nmap-7.92/ncat.exe',
  sqlmap: 'D:/Dev/Tools/RedTeam/bin/sqlmap.cmd',
}

/** Seed ~/.cursor-purge/config.json from DSH's toolkit config on first run. */
export function ensureConfig(root = DATA_ROOT) {
  ensureDataRoot(root)
  const file = join(root, 'config.json')
  if (existsSync(file)) return readJson(file, {})
  const dshConfig = readJson(join(DSH_HOME, 'redteam', 'config.json'), null)
  const config = {
    version: 1,
    dataRoot: root,
    toolkitDir: (dshConfig && dshConfig.toolkitDir) || 'D:/Dev/Tools/RedTeam',
    nucleiTemplatesDir: (dshConfig && dshConfig.nucleiTemplatesDir) || 'D:/Dev/Tools/RedTeam/nuclei-templates',
    binDirs: (dshConfig && dshConfig.binDirs) || ['D:/Dev/Tools/RedTeam/bin'],
    tools: Object.assign({}, DEFAULT_TOOLS, (dshConfig && dshConfig.tools) || {}),
    env: Object.assign({}, (dshConfig && dshConfig.env) || {}),
    limits: { maxAgents: 3, defaultTimeoutMs: 300000 },
    notes: 'Cursor redteam plugin config. Tool paths are reused from the DSH toolkit; edit here only.',
    updated_at: new Date().toISOString(),
  }
  writeJson(file, config)
  return config
}

/** Normalize a workspace path so Cursor's hook cwd and the MCP server cwd match on Windows. */
export function normCwd(p) {
  return String(p || '')
    .replace(/\//g, '\\')
    .replace(/\\+$/, '')
    .toLowerCase()
}

export function bindingsPath(root = DATA_ROOT) { return join(root, 'bindings.json') }
export function readBindings(root = DATA_ROOT) { return readJson(bindingsPath(root), {}) }
export function writeBinding(root, cwd, engagementId) {
  const all = readBindings(root)
  all[normCwd(cwd)] = engagementId
  writeJson(bindingsPath(root), all)
}
export function clearBinding(root, cwd) {
  const all = readBindings(root)
  delete all[normCwd(cwd)]
  writeJson(bindingsPath(root), all)
}

/** Resolve the engagement for this Cursor workspace. */
export function engagementFor(store, root, cwd, explicit) {
  if (explicit) return String(explicit)
  const bound = readBindings(root)[normCwd(cwd)]
  if (bound) return bound
  return store.activeEngagementId() || ''
}

export function engagementView(store, id) {
  const list = store.listEngagements()
  return list.find((x) => x.id === id) || null
}

export function scopePath(root, id) { return join(root, 'engagements', id, 'scope.json') }

export function readScope(root, id) {
  const saved = readJson(scopePath(root, id), {})
  return {
    cidrs: Array.isArray(saved.cidrs) ? saved.cidrs : [],
    domains: Array.isArray(saved.domains) ? saved.domains : [],
    authorization_ref: saved.authorization_ref || '',
    expires_at: saved.expires_at || '',
    high_risk: saved.high_risk === true,
    notes: saved.notes || '',
    created_at: saved.created_at || '',
  }
}

export function writeScope(root, id, scope) {
  writeJson(scopePath(root, id), Object.assign({ created_at: new Date().toISOString() }, scope))
}

const PRIVATE_RE = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/

export function ipv4ToInt(ip) {
  const m = IPV4_RE.exec(String(ip))
  if (!m) return null
  const octets = m.slice(1, 5).map(Number)
  if (octets.some((n) => n < 0 || n > 255)) return null
  return ((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256 + octets[3]
}

export function cidrContains(cidr, ip) {
  const cm = IPV4_RE.exec(String(cidr))
  if (!cm) return false
  const prefix = cm[5] === undefined ? 32 : Number(cm[5])
  if (prefix < 0 || prefix > 32) return false
  const base = ipv4ToInt(cm[1] + '.' + cm[2] + '.' + cm[3] + '.' + cm[4])
  const target = ipv4ToInt(ip)
  if (base === null || target === null) return false
  if (prefix === 0) return true
  const mask = (0xffffffff << (32 - prefix)) >>> 0
  return (base & mask) === (target & mask)
}

/** Validate/normalize an engagement scope. Returns { cidrs, domains, errors, warnings }. */
export function normalizeScope(cidrs = [], domains = []) {
  const errors = []
  const warnings = []
  const outCidrs = []
  for (const raw of Array.isArray(cidrs) ? cidrs : [cidrs]) {
    const value = String(raw || '').trim()
    if (!value) continue
    if (value === '*' || value === '0.0.0.0/0' || value === '::/0') {
      errors.push(`拒绝无边界范围：${value}`)
      continue
    }
    const m = IPV4_RE.exec(value)
    if (!m) {
      errors.push(`不是合法 IPv4/CIDR：${value}`)
      continue
    }
    const prefix = m[5] === undefined ? 32 : Number(m[5])
    const ip = `${m[1]}.${m[2]}.${m[3]}.${m[4]}`
    const priv = PRIVATE_RE.test(ip)
    if (priv && prefix < 8) errors.push(`私网范围过大（< /8）：${value}`)
    if (!priv && prefix < 24) errors.push(`公网范围过大（< /24）：${value}`)
    outCidrs.push(prefix === 32 ? value : `${ip}/${prefix}`)
  }
  const outDomains = []
  for (const raw of Array.isArray(domains) ? domains : [domains]) {
    const value = String(raw || '').trim().toLowerCase().replace(/^\*\./, '')
    if (!value) continue
    if (value === '*' || !value.includes('.')) {
      errors.push(`拒绝过宽/非法域名：${raw}`)
      continue
    }
    if (IPV4_RE.test(value)) {
      errors.push(`域名位置请填 CIDR：${raw}`)
      continue
    }
    outDomains.push(value)
  }
  if (outCidrs.length === 0 && outDomains.length === 0) warnings.push('scope 为空：网络工具会被 hook 拒绝。')
  return { cidrs: [...new Set(outCidrs)], domains: [...new Set(outDomains)], errors, warnings }
}

export function domainInScope(host, domains) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '')
  if (!h) return false
  return domains.some((d) => h === d || h.endsWith(`.${d}`))
}

export function targetInScope(target, scope) {
  const t = String(target || '').trim()
  if (!t) return true
  if (/^(localhost|127\.0\.0\.1|::1)$/i.test(t)) return true
  const m = IPV4_RE.exec(t)
  if (m) {
    if (/^127\./.test(t)) return true
    return scope.cidrs.some((cidr) => cidrContains(cidr, t.split('/')[0]))
  }
  return domainInScope(t, scope.domains)
}

export function isExpired(scope) {
  if (!scope || !scope.expires_at) return false
  const ts = Date.parse(scope.expires_at)
  return Number.isFinite(ts) && ts < Date.now()
}
