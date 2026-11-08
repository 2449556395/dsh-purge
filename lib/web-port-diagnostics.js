/**
 * Read-only diagnostics for the dsh web port, adapted from the 1.1.92 backup's
 * web-reclaim utility. This module NEVER terminates a process or changes a port.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

export function parseNetstatListeners(output, port) {
  const wanted = Number(port)
  const entries = []
  for (const line of String(output || '').split(/\r?\n/)) {
    const row = line.match(/^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i)
    if (row && Number(row[2]) === wanted) entries.push(Number(row[3]))
  }
  return [...new Set(entries.filter((id) => Number.isInteger(id) && id > 0))]
}

export function parseLsofPids(output) {
  return [...new Set(String(output || '').split(/\s+/)
    .map(Number).filter((id) => Number.isInteger(id) && id > 0))]
}

export function parseSsListeners(output, port) {
  const wanted = Number(port)
  const result = []
  for (const line of String(output || '').split(/\r?\n/)) {
    if (!line.includes(':' + wanted + ' ') && !line.includes(':' + wanted + '\t')) continue
    for (const hit of line.matchAll(/pid=(\d+)/g)) result.push(Number(hit[1]))
  }
  return [...new Set(result.filter((id) => Number.isInteger(id) && id > 0))]
}

export function looksLikeDshWeb(cmd) {
  const line = String(cmd || '')
  return /@deepseek-ai[\\/]dsh[\\/]lib[\\/]bin\.js/i.test(line)
    && /(?:^|[\s"'])web(?:[\s"']|$)/i.test(line)
}

export function webPortNumber(port) {
  const n = Number(port)
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error('port must be an integer from 1 to 65535')
  return n
}

export function dshHomeDir(env = process.env) {
  return String(env.DSH_HOME || '').trim() || path.join(os.homedir(), '.dsh')
}

export function recordPath(home, port) {
  return path.join(home, 'dsh-purge', 'web-server-' + webPortNumber(port) + '.json')
}

/** Record only a child process that this plugin actually spawned. */
export function writeWebRecord(port, pid, home = dshHomeDir()) {
  const p = webPortNumber(port)
  const id = Number(pid)
  if (!Number.isInteger(id) || id < 1) throw new Error('pid must be a positive integer')
  const file = recordPath(home, p)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ pid: id, port: p, at: new Date().toISOString() }) + '\n')
  return file
}

export function readWebRecord(home, port) {
  try {
    const row = JSON.parse(fs.readFileSync(recordPath(home, port), 'utf8'))
    return Number.isInteger(row.pid) && row.pid > 0 && row.port === webPortNumber(port)
      ? { pid: row.pid, at: String(row.at || '') } : null
  } catch {
    return null
  }
}

function run(cmd, args) {
  try {
    const result = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 5000 })
    return result.status === 0 ? String(result.stdout || '') : ''
  } catch {
    return ''
  }
}

function listenerPids(port) {
  if (process.platform === 'win32') return parseNetstatListeners(run('netstat', ['-ano']), port)
  const pids = parseLsofPids(run('lsof', ['-nP', '-iTCP:' + port, '-sTCP:LISTEN', '-t']))
  return pids.length ? pids : parseSsListeners(run('ss', ['-ltnp']), port)
}

function cmdlineOf(pid) {
  if (process.platform === 'win32') {
    return run('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      '(Get-CimInstance Win32_Process -Filter "ProcessId=' + pid + '" -ErrorAction SilentlyContinue).CommandLine',
    ]).trim()
  }
  return run('ps', ['-p', String(pid), '-o', 'command=']).trim()
}

/**
 * A saved PID is only a hint: the OS can recycle PIDs. The live port and
 * process command line are always checked separately.
 */
export function inspectWebPort(port, home = dshHomeDir()) {
  const p = webPortNumber(port)
  const record = readWebRecord(home, p)
  const listeners = listenerPids(p).map((pid) => {
    const cmd = cmdlineOf(pid)
    return { pid, kind: !cmd ? 'unknown' : looksLikeDshWeb(cmd) ? 'dsh-web' : 'other' }
  })
  const recordedOnPort = !!record && listeners.some((row) => row.pid === record.pid)
  return {
    port: p,
    occupied: listeners.length > 0,
    recorded_pid: record?.pid || null,
    recorded_on_port: recordedOnPort,
    listeners,
    // An unknown owner must never be identified as our orphan from PID alone.
    note: listeners.length
      ? 'Port in use. Review owner before stopping anything; no process was terminated.'
      : 'No listening owner found by installed OS inspection utilities.',
  }
}
