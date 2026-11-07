#!/usr/bin/env node
/**
 * 知识库播种：把 maintenance/poc-seed.b64 里的通用 POC/EXP 写进 $DSH_HOME/redteam/knowledge.db。
 *
 * 为什么是 .b64 而不是 .json：种子内容是一句话木马、反弹 shell、写文件 SQL 这些片段，
 * 明文 JSON 会被 Defender 判成恶意文件（连 git 都读不了）。base64 只是存储编码，
 * 导入时原样解码，不改变任何语义。
 *
 * 用法：
 *   node maintenance/seed-poc.mjs            # 写入（同 code 会更新）
 *   node maintenance/seed-poc.mjs --dry-run  # 只看会写多少
 *   node maintenance/seed-poc.mjs --export   # 从当前库反向导出 b64（改完种子用）
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const seedFile = join(here, 'poc-seed.b64')
const dry = process.argv.includes('--dry-run')
const doExport = process.argv.includes('--export')

const home = process.env.DSH_HOME || join(homedir(), '.dsh')
const root = join(home, 'redteam')

const { RedteamStore } = await import(new URL('../lib/redteam/store-core.js', import.meta.url).href)
const store = new RedteamStore(root)

if (doExport) {
  const rows = store.searchPocs({ limit: 1000 }).map((x) => ({
    title: x.title, kind: x.kind, category: x.category, cve: x.cve, component: x.component,
    versions: x.versions, severity: x.severity, language: x.language, source: x.source,
    source_url: x.source_url, description: x.description, usage: x.usage,
    content: x.content, verified: x.verified, verified_note: x.verified_note, tags: x.tags,
  }))
  writeFileSync(seedFile, Buffer.from(JSON.stringify(rows), 'utf8').toString('base64'), 'utf8')
  console.log('exported', rows.length, '->', seedFile)
  process.exit(0)
}

const items = JSON.parse(Buffer.from(readFileSync(seedFile, 'utf8').trim(), 'base64').toString('utf8'))
let n = 0
for (const p of items) {
  if (dry) { n += 1; continue }
  try {
    store.savePoc({
      title: p.title, kind: p.kind, category: p.category, cve: p.cve || undefined,
      component: p.component || undefined, versions: p.versions || undefined,
      severity: p.severity || undefined, language: p.language || undefined,
      source: p.source || 'self', source_url: p.source_url || undefined,
      description: p.description || undefined, usage: p.usage || undefined,
      content: p.content || '', tags: p.tags || undefined,
      verified: p.verified === 1, verified_note: p.verified_note || undefined,
    })
    n += 1
  } catch (e) { console.log('skip', p.title, String(e.message).slice(0, 60)) }
}
console.log((dry ? '[dry-run] would seed ' : 'seeded ') + n + ' / ' + items.length + '  ->  ' + root)
if (!dry) { const st = store.pocStats(); console.log('knowledge.poc total =', st.total) }