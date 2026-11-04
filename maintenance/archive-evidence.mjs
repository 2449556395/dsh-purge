import { openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

function read(fd, buffer, offset, count, position) {
  for (let done = 0; done < count;) {
    const n = readSync(fd, buffer, offset + done, count - done, position + done);
    if (!n) throw new Error('Unexpected end of ASAR');
    done += n;
  }
}

export function openArchive(path) {
  const fd = openSync(path, 'r');
  try {
    const { size } = fstatSync(fd);
    const prefix = Buffer.alloc(16);
    read(fd, prefix, 0, 16, 0);
    const header = prefix.readUInt32LE(4);
    const json = prefix.readUInt32LE(12);
    const origin = 8 + header;
    if (prefix.readUInt32LE(0) !== 4 || json < 2 || json > 64 * 1024 ** 2 ||
        origin < 16 + json || origin > size) throw new Error('Invalid ASAR header bounds');
    const bytes = Buffer.alloc(json);
    read(fd, bytes, 0, json, 16);
    const parsed = JSON.parse(bytes.toString('utf8'));
    const files = new Map();
    function visit(tree, parent, depth) {
      if (!tree || typeof tree !== 'object' || Array.isArray(tree) || depth > 80)
        throw new Error('Invalid ASAR file tree');
      for (const [name, data] of Object.entries(tree)) {
        if (!name || name === '.' || name === '..' || /[/\\\0]/u.test(name) || !data || typeof data !== 'object')
          throw new Error('Invalid ASAR member');
        const key = parent ? parent + '/' + name : name;
        if (data.files) { visit(data.files, key, depth + 1); continue; }
        if (typeof data.link === 'string') { files.set(key, { kind: 'link', link: data.link }); continue; }
        if (!Number.isSafeInteger(data.size) || data.size < 0) throw new Error('Invalid ASAR member size');
        if (data.unpacked) { files.set(key, { kind: 'unpacked', size: data.size }); continue; }
        const off = Number(data.offset);
        if (!/^\d+$/.test(String(data.offset)) || !Number.isSafeInteger(off) ||
            off < 0 || off > size - origin || data.size > size - origin - off)
          throw new Error('Invalid ASAR member offset');
        files.set(key, { kind: 'packed', size: data.size, off: origin + off });
      }
    }
    visit(parsed.files, '', 0);
    const scratch = Buffer.alloc(1024 ** 2);
    function fingerprint(entry) {
      if (entry.kind !== 'packed') return JSON.stringify(entry);
      const hash = createHash('sha256');
      for (let at = 0; at < entry.size;) {
        const len = Math.min(scratch.length, entry.size - at);
        read(fd, scratch, 0, len, entry.off + at);
        hash.update(scratch.subarray(0, len));
        at += len;
      }
      return hash.digest('hex');
    }
    return { files, fingerprint, close: () => closeSync(fd) };
  } catch (err) { closeSync(fd); throw err; }
}

export function compareArchives(official, installed) {
  const a = openArchive(official);
  try {
    const b = openArchive(installed);
    try {
      const added = [], removed = [], changed = [];
      for (const [key, x] of a.files) {
        const y = b.files.get(key);
        if (!y) removed.push(key);
        else if (x.kind !== y.kind || x.size !== y.size || a.fingerprint(x) !== b.fingerprint(y)) changed.push(key);
      }
      for (const key of b.files.keys()) if (!a.files.has(key)) added.push(key);
      const cli = 'dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js';
      return {
        officialEntries: a.files.size, installedEntries: b.files.size,
        packedPayloadsCompared: [...a.files.values()].filter(x => x.kind === 'packed').length,
        unpackedSidecarBytesCompared: false, added, removed, changed,
        officialCliKind: a.files.get(cli)?.kind ?? null,
        installedCliKind: b.files.get(cli)?.kind ?? null
      };
    } finally { b.close(); }
  } finally { a.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4) throw new Error('Usage: node archive-evidence.mjs OFFICIAL INSTALLED');
    console.log(JSON.stringify(compareArchives(process.argv[2], process.argv[3]), null, 2));
  } catch (err) { console.error(err.message); process.exitCode = 1; }
}
