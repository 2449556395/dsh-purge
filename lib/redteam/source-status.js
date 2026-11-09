import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** GitHub tree entries contain Git blob SHA-1, not plain-file SHA-1. */
export function gitBlobSha(bytes) {
  const content = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  return createHash('sha1').update('blob ' + content.length + '\0').update(content).digest('hex')
}

/** Compare installed package bytes with the named upstream tree, without requiring a local .git directory. */
export function compareInstalledSources(installRoot, tree, paths = ['client.js', 'lib/redteam/ui.js', 'lib/redteam/client.js']) {
  if (!Array.isArray(tree)) return { state: 'unknown', compared: 0, different: [], unavailable: paths.slice() }
  const entries = new Map(tree.filter((x) => x && x.type === 'blob').map((x) => [x.path, x.sha]))
  const different = []
  const unavailable = []
  let compared = 0
  for (const file of paths) {
    const expected = entries.get(file)
    if (!expected) { unavailable.push(file); continue }
    try {
      const actual = gitBlobSha(readFileSync(join(installRoot, ...file.split('/'))))
      compared += 1
      if (actual !== expected) different.push(file)
    } catch {
      unavailable.push(file)
    }
  }
  return {
    state: unavailable.length ? 'unknown' : (different.length ? 'different' : 'match'),
    compared, different, unavailable,
  }
}
