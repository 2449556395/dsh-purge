/**
 * Read-only runtime and bundled Skill placement diagnostics.
 * Disk presence is not evidence of registration in the live DSH skills scope.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BUNDLED_DIR = fileURLToPath(new URL('../../skills/redteam/', import.meta.url))

function listMd(dir) {
  try { return readdirSync(dir).filter(name => name.endsWith('.md')).sort() }
  catch { return [] }
}

function skillMetadata(text) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
  if (!frontmatter) return { valid: false, reason: 'missing frontmatter' }
  const field = name => new RegExp('^' + name + ':\\s*(.*?)\\s*$', 'm').exec(frontmatter[1])?.[1] || ''
  const name = field('name').replace(/^['"]|['"]$/g, '')
  const description = field('description')
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) return { valid: false, reason: 'invalid name' }
  if (!description.trim()) return { valid: false, reason: 'missing description' }
  return { valid: true, name }
}

export async function inspectRuntime(options = {}) {
  const home = options.home ?? (process.env.DSH_HOME || join(homedir(), '.dsh'))
  const bundledDir = options.bundledDir ?? BUNDLED_DIR
  const installedDir = join(home, 'redteam', 'skills')
  const presetFile = join(home, '.agent-presets', 'redteam', 'agent.cordis.yml')
  const bundled = listMd(bundledDir)
  const installed = listMd(installedDir)
  const missing = []
  const different = []
  const invalid = []

  for (const filename of bundled) {
    try {
      const source = readFileSync(join(bundledDir, filename))
      const parsed = skillMetadata(source.toString('utf8'))
      if (!parsed.valid || parsed.name + '.md' !== filename) {
        invalid.push({ file: filename, reason: parsed.valid ? 'name/filename mismatch' : parsed.reason })
      }
      const disk = join(installedDir, filename)
      if (!existsSync(disk)) missing.push(filename)
      else if (!readFileSync(disk).equals(source)) different.push(filename)
    } catch {
      invalid.push({ file: filename, reason: 'file read failed' })
    }
  }

  let presetText = ''
  try { presetText = readFileSync(presetFile, 'utf8') } catch { /* absent */ }
  const presetFound = presetText !== ''
  const activeYaml = presetText.split(/\r?\n/).filter(line => !/^\s*#/.test(line))
  const hasRoot = root => activeYaml.some(line =>
    /^\s*-\s*!!js\s+dshHomePath\(['"]([^'"]+)['"]\)\s*(?:#.*)?$/.exec(line)?.[1] === root)
  const presetPointsToBundle = hasRoot('redteam/skills')
  const presetPointsToUser = hasRoot('skills')

  let sqliteAvailable = false
  let sqliteError = null
  try {
    const sqlite = options.sqliteProbe ? await options.sqliteProbe() : await import('node:sqlite')
    sqliteAvailable = typeof sqlite?.DatabaseSync === 'function'
    if (!sqliteAvailable) sqliteError = 'DatabaseSync not exported by this Node runtime'
  } catch (error) {
    sqliteError = error?.code || error?.message || String(error)
  }

  const fileReady = bundled.length > 0 && invalid.length === 0
    && missing.length === 0 && different.length === 0
    && presetFound && presetPointsToBundle
  return {
    readOnly: true,
    runtime: { node: process.version, sqliteAvailable, ...(sqliteError ? { sqliteError } : {}) },
    skills: {
      bundledDir, installedDir, presetFile,
      bundledCount: bundled.length, installedCount: installed.length,
      invalid, missing, different,
      presetFound, presetPointsToBundle, presetPointsToUser,
      filesReady: fileReady,
      hostRegistryChecked: false,
      hostInvocable: null,
      note: 'Files and preset only. Confirm real host listing in the redteam Skill panel (skillCatalog); file presence does not prove model invocation.',
    },
  }
}
