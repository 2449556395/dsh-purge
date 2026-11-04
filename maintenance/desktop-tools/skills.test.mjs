import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, unlinkSync, rmdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localSkillIndex } from './skills.mjs';

test('skill index reads only direct plain SKILL.md metadata', t=>{
  const root=mkdtempSync(join(tmpdir(),'harness-skills-index-'));
  const skill=join(root,'skill-a'),empty=join(root,'not-a-skill'), file=join(skill,'SKILL.md');
  mkdirSync(skill);mkdirSync(empty);writeFileSync(file,'TEST ONLY');
  t.after(()=>{unlinkSync(file);rmdirSync(skill);rmdirSync(empty);rmdirSync(root);});
  assert.deepEqual(localSkillIndex(root),{kind:'local-filesystem-index',skills:[{id:'skill-a',bytes:9}],contentsRead:false});
});
test('invalid root never enumerates cwd or network paths',()=>{
  assert.throws(()=>localSkillIndex('.'),/absolute local/u);
  assert.throws(()=>localSkillIndex('//example.invalid/share'),/absolute local/u);
});
test('junctions are not indexed and a junction root is refused',t=>{
  const root=mkdtempSync(join(tmpdir(),'harness-skills-junction-'));
  const real=join(root,'actual'), link=join(root,'alias'), file=join(real,'SKILL.md');
  mkdirSync(real);writeFileSync(file,'TEST');
  symlinkSync(real,link,process.platform==='win32'?'junction':'dir');
  t.after(()=>{if(process.platform==='win32')rmdirSync(link);else unlinkSync(link);unlinkSync(file);rmdirSync(real);rmdirSync(root);});
  assert.deepEqual(localSkillIndex(root).skills.map(x=>x.id),['actual']);
  assert.throws(()=>localSkillIndex(link),/without links/u);
});
