import { randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'

/**
 * Replace a JSON/config file only after the replacement has been fully written.
 * A failed write or rename leaves the previous file intact. Temporary config
 * files use mode 0600 too, because platform/proxy settings may contain secrets.
 */
export function atomicWriteFileSync(file, contents) {
  const tmp = file + '.tmp-' + process.pid + '-' + randomUUID()
  let fd
  try {
    fd = openSync(tmp, 'wx', 0o600)
    writeFileSync(fd, contents, 'utf8')
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    renameSync(tmp, file)
  } catch (error) {
    if (fd !== undefined) {
      try { closeSync(fd) } catch { /* preserve the original error */ }
    }
    try { unlinkSync(tmp) } catch { /* best effort cleanup */ }
    throw error
  }
}
