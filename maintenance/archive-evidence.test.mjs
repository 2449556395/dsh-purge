import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compareArchives, openArchive } from './archive-evidence.mjs';
import { comparePayload } from './payload-evidence.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'harness-maintenance-test-'));
  const dirs=[], files=[];
  t.after(() => {
    for (const file of files.reverse()) unlinkSync(file);
    for (const child of dirs.reverse()) rmdirSync(child);
    rmdirSync(dir);
  });
  return {
    file(relative, data) { const p=join(dir,relative);writeFileSync(p,data);if(!files.includes(p))files.push(p);return p; },
    mkdir(relative) { const p=join(dir,relative);mkdirSync(p);dirs.push(p);return p; },
  };
}
function archive(table, payload) {
  const h=Buffer.from(JSON.stringify({files:table}));
  const pre=Buffer.alloc(16);
  pre.writeUInt32LE(4,0);pre.writeUInt32LE(h.length+8,4);pre.writeUInt32LE(h.length,12);
  return Buffer.concat([pre,h,Buffer.from(payload)]);
}
test('ASAR compares bytes, not only size, and never executes entries',t=>{
  const f=fixture(t);
  const table={lib:{files:{'main.js':{offset:'0',size:3}}}};
  const original=f.file('a.asar',archive(table,'abc'));
  const current=f.file('b.asar',archive(table,'xyz'));
  const r=compareArchives(original,current);
  assert.equal(r.packedPayloadsCompared,1);
  assert.deepEqual(r.changed,['lib/main.js']);
  assert.equal(r.unpackedSidecarBytesCompared,false);
});
test('truncated and out-of-bounds ASAR fail closed',t=>{
  const f=fixture(t);
  assert.throws(()=>openArchive(f.file('short',Buffer.from('x'))),/Unexpected end/);
  assert.throws(()=>openArchive(f.file('bad',archive({x:{offset:'9999',size:4}},'1234'))),/Invalid ASAR member offset/);
});
test('paired payload distinguishes archive difference, missing files and extra companions',t=>{
  const f=fixture(t);
  const official=f.mkdir('official'), live=f.mkdir('live');
  for(const root of ['official','live']){
    f.mkdir(root+'/resources');f.mkdir(root+'/resources/runtime');
    f.file(root+'/exe','same');
  }
  f.file('official/resources/app.asar','source');
  f.file('live/resources/app.asar','changed');
  f.file('official/resources/runtime/native.dll','required');
  f.file('live/resources/runtime/stale.dll','left over');
  const r=comparePayload(official,live);
  assert.equal(r.expectedFiles,3);
  assert.equal(r.matched,1);
  assert.deepEqual(r.changed,['resources/app.asar']);
  assert.deepEqual(r.missing,['resources/runtime/native.dll']);
  assert.deepEqual(r.unexpectedCompanions,['resources/runtime/stale.dll']);
});
