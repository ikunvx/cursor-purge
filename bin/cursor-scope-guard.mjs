#!/usr/bin/env node
/**
 * Cursor beforeShellExecution scope guard.
 *
 * Cursor passes { command, cwd } on stdin. We allow/deny network/exploit tools
 * against the active engagement's CIDR/domain allowlist and emit Cursor's
 * permission JSON: { permission: "allow" | "deny", user_message, agent_message }.
 *
 * Only the store's scope files are read; no dsh-purge code is imported here.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  DATA_ROOT, readBindings, readScope, isExpired, cidrContains, ipv4ToInt, domainInScope, normCwd,
} from '../runtime/dsh-bridge.mjs'

const TOOL_RE = /\b(nmap|masscan|nuclei|httpx|subfinder|dnsx|naabu|ffuf|feroxbuster|gobuster|fscan|gogo|sqlmap|ncat|chisel|frpc|frps|suo5|curl|wget|ssh|scp|impacket-[a-z0-9_-]+)\b/i
const SAFE_FLAG_RE = /(^|\s)(--help|-h|-version|--version|-update-templates|-ut|-duc|-silent-update)(\s|$)/i
const EXT_RE = /\.(exe|dll|so|dylib|txt|yaml|yml|json|md|log|py|js|mjs|cjs|sh|ps1|cmd|bat|conf|config|xml|csv|zip|tar|gz|7z|rar|bin|img|iso|db|sqlite|pcap|html|htm|css|php|jsp|aspx)$/i
const TARGET_FILE_FLAG_RE = /(?:^|\s)(?:-l|--list|--targets|-iL)\s+("[^"]+"|'[^']+'|\S+)/i
const ATTACK_CURL_RE = /(?:^|\s)(?:-d|--data|--data-raw|--data-binary|-X|--request|-T|--upload-file|--socks5|--socks5-hostname|-x|--proxy)\b/i

let PROJECT_DIR = process.env.CURSOR_PROJECT_DIR || process.cwd()

function parseCidr(s) {
  const m = /^(\d{1,3}(?:\.\d{1,3}){3})(?:\/(\d{1,2}))?$/.exec(String(s || '').trim())
  if (!m) return null
  const ip = ipv4ToInt(m[1])
  if (ip === null) return null
  const prefix = m[2] === undefined ? 32 : Number(m[2])
  if (prefix < 0 || prefix > 32) return null
  return { ip, prefix }
}

function cidrWithin(inner, outer) {
  const a = parseCidr(inner)
  const b = parseCidr(outer)
  if (!a || !b || a.prefix < b.prefix) return false
  const mask = b.prefix === 0 ? 0 : (0xffffffff << (32 - b.prefix)) >>> 0
  return (a.ip & mask) === (b.ip & mask)
}

function readCurrent() {
  try { return readFileSync(join(DATA_ROOT, 'current'), 'utf8').trim() } catch { return '' }
}

function activeEngagement() {
  const bound = readBindings(DATA_ROOT)[normCwd(PROJECT_DIR)]
  return bound || readCurrent() || ''
}

function extractHostFromUrl(raw) {
  try {
    const u = new URL(raw)
    return u.hostname.replace(/^\[|\]$/g, '')
  } catch {
    const m = /^[a-z]+:\/\/([^/?#]+)/i.exec(raw)
    if (!m) return ''
    return m[1].replace(/^.*@/, '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
  }
}

function extractTargets(command, tool) {
  const targets = new Set()
  const notes = []

  for (const m of command.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
    const host = extractHostFromUrl(m[0])
    if (host) targets.add(host)
  }
  for (const m of command.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?\b/g)) {
    targets.add(m[0])
  }
  if (!['curl', 'wget', 'ssh', 'scp'].includes(tool)) {
    for (const m of command.matchAll(/\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\b/gi)) {
      const value = m[0]
      if (EXT_RE.test(value)) continue
      if (/^(localhost)$/i.test(value)) continue
      targets.add(value)
    }
  }
  // ssh/scp user@host
  if (['ssh', 'scp'].includes(tool)) {
    for (const m of command.matchAll(/(?:^|\s)(?:[^\s@]+@)?([a-z0-9.-]+\.[a-z]{2,63})(?=\s|$)/gi)) {
      targets.add(m[1])
    }
  }

  const fileMatch = TARGET_FILE_FLAG_RE.exec(command)
  if (fileMatch) {
    const raw = fileMatch[1].replace(/^["']|["']$/g, '')
    const file = resolve(PROJECT_DIR, raw)
    if (existsSync(file)) {
      try {
        const lines = readFileSync(file, 'utf8').split(/\r?\n/).map((x) => x.trim()).filter(Boolean)
        for (const line of lines) {
          if (line.startsWith('#')) continue
          const host = line.includes('://') ? extractHostFromUrl(line) : line.split(/\s+/)[0]
          if (host) targets.add(host.replace(/:\d+$/, ''))
        }
        notes.push(`target list: ${file}`)
      } catch { notes.push(`target list unreadable: ${file}`) }
    } else {
      notes.push(`target list missing: ${file}`)
    }
  }

  if (tool === 'sqlmap' && /(?:^|\s)-r\s+/i.test(command) && !/(?:^|\s)-u\s+/i.test(command)) {
    notes.push('sqlmap -r without -u: target is inside the request file and cannot be scope-checked')
  }
  return { targets: [...targets], notes }
}

function audit(entry) {
  try {
    mkdirSync(join(DATA_ROOT, 'audit'), { recursive: true })
    appendFileSync(join(DATA_ROOT, 'audit', 'scope.ndjson'), JSON.stringify(entry) + '\n', 'utf8')
  } catch { /* best-effort */ }
}

function emit(permission, reason, extra = {}) {
  audit(Object.assign({ at: new Date().toISOString(), decision: permission, reason, cwd: PROJECT_DIR }, extra))
  const payload = { permission }
  if (permission === 'deny') {
    payload.user_message = `[redteam scope] ${reason}`
    payload.agent_message = `[redteam scope] ${reason}`
  }
  process.stdout.write(JSON.stringify(payload) + '\n')
  process.exit(0)
}

function main(input) {
  const command = String(input && input.command || '')
  PROJECT_DIR = (input && input.cwd) || process.env.CURSOR_PROJECT_DIR || process.cwd()
  if (!command.trim()) return emit('allow', 'empty command')

  const m = TOOL_RE.exec(command)
  if (!m) return emit('allow', 'no gated network tool')
  const tool = m[1].toLowerCase()
  if (SAFE_FLAG_RE.test(command)) return emit('allow', 'safe/version/help flag', { tool })

  const engagement = activeEngagement()
  if (!engagement) return emit('allow', 'no active engagement', { tool })

  const scope = readScope(DATA_ROOT, engagement)
  if (isExpired(scope)) {
    return emit('deny', `授权已过期（${scope.expires_at}）。请先更新 redteam_scope_update expires_at 再发包。`, { tool, engagement })
  }

  if (['curl', 'wget'].includes(tool)) {
    const hasIp = /\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(command)
    if (!hasIp && !ATTACK_CURL_RE.test(command)) return emit('allow', 'curl/wget without attack flags', { tool, engagement })
  }

  const { targets, notes } = extractTargets(command, tool)
  if (tool === 'sqlmap' && notes.some((n) => n.includes('cannot be scope-checked'))) {
    return emit('deny', 'sqlmap -r 的请求文件内目标无法校验；请改用 -u <范围内URL>，或把请求文件放到已授权目标上。', { tool, engagement, command })
  }
  if (targets.length === 0) {
    return emit('allow', 'no explicit target', { tool, engagement, notes })
  }
  if (scope.cidrs.length === 0 && scope.domains.length === 0) {
    return emit('deny', `当前靶标 ${engagement} 的授权范围为空。请先 redteam_scope_update 添加 CIDR/域名。`, { tool, engagement, targets })
  }

  if (tool === 'masscan') {
    const rate = /(?:^|\s)--rate[=\s]+(\d+)/i.exec(command)
    if (rate && Number(rate[1]) > 2000) {
      return emit('deny', `masscan --rate=${rate[1]} 过高（上限 2000），请降速。`, { tool, engagement })
    }
  }

  const outside = []
  for (const target of targets) {
    if (/^(localhost|127\.0\.0\.1|::1)$/i.test(target)) continue
    if (target.includes('/')) {
      if (!scope.cidrs.some((cidr) => cidrWithin(target, cidr))) outside.push(target)
      continue
    }
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(target)) {
      if (!scope.cidrs.some((cidr) => cidrContains(cidr, target))) outside.push(target)
      continue
    }
    if (!domainInScope(target, scope.domains)) outside.push(target)
  }

  if (outside.length > 0) {
    const scopeText = [
      ...scope.cidrs.map((x) => `CIDR ${x}`),
      ...scope.domains.map((x) => `域名 ${x}`),
    ].join(', ') || '(空)'
    return emit(
      'deny',
      `目标不在授权范围：${[...new Set(outside)].join(', ')}。当前范围：${scopeText}。请改用范围内目标，或先 redteam_scope_update 更新授权。`,
      { tool, engagement, targets: [...new Set(targets)], outside: [...new Set(outside)] },
    )
  }
  return emit('allow', 'targets in scope', { tool, engagement, targets: [...new Set(targets)], notes })
}

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { raw += chunk })
process.stdin.on('end', () => {
  let input = null
  try { input = JSON.parse(raw || '{}') } catch {
    return emit('deny', 'hook input is not JSON')
  }
  try {
    main(input)
  } catch (error) {
    return emit('deny', `scope guard error: ${error && error.message ? error.message : String(error)}`)
  }
})
