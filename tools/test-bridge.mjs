#!/usr/bin/env node
/** End-to-end smoke test for the MCP bridge + scope guard. */
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(process.env.TEST_ROOT || 'E:/System/Temp/cursor-purge-test')
const WORK = join(ROOT, 'work')
rmSync(ROOT, { recursive: true, force: true })
mkdirSync(WORK, { recursive: true })

const child = spawn(process.execPath, [join(import.meta.dirname, '..', 'runtime', 'server.mjs')], {
  cwd: WORK,
  env: { ...process.env, CURSOR_PURGE_HOME: ROOT, CURSOR_PROJECT_DIR: WORK },
  stdio: ['pipe', 'pipe', 'pipe'],
})

let buf = ''
const pending = new Map()
let nextId = 1
child.stdout.setEncoding('utf8')
child.stdout.on('data', (chunk) => {
  buf += chunk
  for (;;) {
    const i = buf.indexOf('\n')
    if (i < 0) break
    const line = buf.slice(0, i).trim()
    buf = buf.slice(i + 1)
    if (!line) continue
    let msg
    try { msg = JSON.parse(line) } catch { console.error('bad line', line); continue }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    } else {
      console.error('unsolicited', msg)
    }
  }
})
child.stderr.setEncoding('utf8')
child.stderr.on('data', (d) => process.stderr.write('[server] ' + d))

function rpc(method, params) {
  const id = nextId++
  return new Promise((resolveP, rejectP) => {
    pending.set(id, resolveP)
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rejectP(new Error(`timeout ${method}`)) } }, 30000)
  })
}

async function call(name, args = {}) {
  const res = await rpc('tools/call', { name, arguments: args })
  if (res.error) throw new Error(`${name}: ${res.error.message}`)
  const text = res.result?.content?.[0]?.text || ''
  let parsed
  try { parsed = JSON.parse(text) } catch { parsed = text }
  console.log(`\n### ${name} ${res.result?.isError ? '(isError)' : ''}`)
  console.log(typeof parsed === 'string' ? parsed.slice(0, 1200) : JSON.stringify(parsed, null, 2).slice(0, 1600))
  return parsed
}

function runGuard(command, projectDir = WORK, nullInput = false) {
  return new Promise((resolveP) => {
    const p = spawn(process.execPath, [join(import.meta.dirname, '..', 'bin', 'cursor-scope-guard.mjs')], {
      cwd: projectDir,
      env: { ...process.env, CURSOR_PURGE_HOME: ROOT, CURSOR_PROJECT_DIR: projectDir },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { err += d })
    p.on('exit', (code) => {
      let json = null
      try { json = JSON.parse(out.trim()) } catch { /* leave null */ }
      resolveP({ code, out: out.trim(), err: err.trim(), json })
    })
    p.stdin.end(nullInput ? '{}' : JSON.stringify({ command, cwd: projectDir }))
  })
}

await rpc('initialize', { protocolVersion: '2024-11-05' })
const list = await rpc('tools/list', {})
console.log('tools:', list.result.tools.length, list.result.tools.map((t) => t.name).slice(0, 8), '...')

await call('redteam_engagement_open', {
  name: 'smoke-lab',
  scope: ['10.0.0.0/24'],
  domains: ['example.test'],
  authorization_ref: 'TEST-001',
  high_risk: true,
})
await call('redteam_preflight')
await call('redteam_asset_add', {
  ip: '10.0.0.5', provenance: 'active', tool: 'nmap',
  ports: [{ port: 80, service: 'http', product: 'nginx', version: '1.24', url: 'http://10.0.0.5/', title: 'lab' }],
})
await call('redteam_asset_query', { q: '10.0.0.5' })
await call('redteam_asset_assess', { asset_id: 1, priority: 'high', potential: 'web', reason: 'smoke' })
await call('redteam_vuln_add', { target: 'http://10.0.0.5/', title: 'smoke vuln', severity: 'high', status: 'confirmed', evidence: 'test', gained: 'web' })
await call('redteam_http_evidence_add', { target: 'http://10.0.0.5/', request: 'GET / HTTP/1.1\r\nHost: 10.0.0.5\r\n\r\n', response: 'HTTP/1.1 200 OK' })
await call('redteam_score_hit', { code: 'server-host', target: '10.0.0.5', evidence: 'smoke' })
await call('redteam_score_list')
await call('redteam_chain_add', { stage_code: 'recon', action: 'smoke', tool: 'nmap -sV 10.0.0.5', result: '80/open', target: '10.0.0.5' })
await call('redteam_attack_chain')
await call('redteam_report_save', { format: 'score' })
await call('redteam_session_info')

const cases = [
  ['nmap -sV 10.0.0.5', 'allow'],
  ['nmap -sV 8.8.8.8', 'deny'],
  ['nmap 10.0.0.0/16', 'deny'],
  ['nuclei -u https://example.test', 'allow'],
  ['nuclei -u https://evil.test', 'deny'],
  ['masscan 10.0.0.0/24 --rate 10000', 'deny'],
  ['rm -rf build', 'allow'],
  ['curl https://example.test/api', 'allow'],
]
console.log('\n### beforeShellExecution scope guard')
for (const [command, expected] of cases) {
  const r = await runGuard(command)
  const actual = r.json && r.json.permission
  const ok = r.code === 0 && actual === expected
  const msg = r.json && (r.json.agent_message || '')
  console.log(`${ok ? 'PASS' : 'FAIL'} permission=${actual} expected=${expected} :: ${command}${msg ? ' :: ' + msg.split('\n')[0] : ''}`)
  if (!ok) process.exitCode = 1
}

child.kill()
console.log('\ndone')
