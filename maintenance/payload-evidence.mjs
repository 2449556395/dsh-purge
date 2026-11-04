import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

function checkedFile(root, relative) {
  let p = root;
  for (const part of relative.split('/')) {
    p = path.join(p, part);
    let st;
    try { st = fs.lstatSync(p); }
    catch (err) { if (err.code === 'ENOENT') return null; throw err; }
    if (st.isSymbolicLink()) throw new Error('Reparse/symlink in installed payload: ' + relative);
  }
  const st = fs.lstatSync(p);
  return st.isFile() ? { p, size: st.size } : null;
}
function list(root, relative = '') {
  const out = [];
  if (fs.lstatSync(path.join(root, relative)).isSymbolicLink()) throw new Error('Reparse directory: ' + relative);
  for (const item of fs.readdirSync(path.join(root, relative), {withFileTypes:true})) {
    const rel = relative ? relative + '/' + item.name : item.name;
    if (item.isSymbolicLink()) throw new Error('Reparse/symlink in official payload: ' + rel);
    if (item.isDirectory()) out.push(...list(root, rel));
    else if (item.isFile()) out.push(rel);
    else throw new Error('Unsupported official payload entry: ' + rel);
  }
  return out;
}
export function sha256(file) {
  const fd = fs.openSync(file,'r');
  try {
    const buf = Buffer.allocUnsafe(1024 ** 2), hash = createHash('sha256');
    let n;
    while ((n=fs.readSync(fd, buf, 0, buf.length, null))) hash.update(buf.subarray(0,n));
    return hash.digest('hex');
  } finally { fs.closeSync(fd); }
}
export function comparePayload(expected, live) {
  if (fs.lstatSync(expected).isSymbolicLink() || fs.lstatSync(live).isSymbolicLink())
    throw new Error('Reparse/symlink root is not supported');
  const changed=[], missing=[], unexpectedCompanions=[];
  const entries=list(expected).sort();
  const seen = new Set(entries.map(x=>x.toLowerCase()));
  let matched=0;
  for (const rel of entries) {
    const a=checkedFile(expected,rel), b=checkedFile(live,rel);
    if (!a) throw new Error('Staged payload changed during inspection');
    if (!b) { missing.push(rel); continue; }
    if (a.size !== b.size || sha256(a.p) !== sha256(b.p)) changed.push(rel);
    else matched++;
  }
  // Extra files in unpacked payload/runtime can affect startup despite matching bundled files.
  for (const sub of ['resources/app.asar.unpacked','resources/runtime']) {
    if (!fs.existsSync(path.join(live,sub))) continue;
    for (const rel of list(live,sub)) if (!seen.has(rel.toLowerCase())) unexpectedCompanions.push(rel);
  }
  return {expectedFiles:entries.length,matched,changed,missing,unexpectedCompanions};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if(process.argv.length!==4)throw new Error('Usage: node payload-evidence.mjs OFFICIAL_DIR INSTALL_DIR');
    console.log(JSON.stringify(comparePayload(process.argv[2],process.argv[3]),null,2));
  } catch(err) { console.error(err.message); process.exitCode=1; }
}
