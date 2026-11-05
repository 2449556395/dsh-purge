import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { adaptPresetPlugins, detectPresetCompatibility } from '../lib/redteam/preset-compat.js';

const control = { id:'control', name:'@deepseek-ai/dsh-tool-subagent-control', disabled:false };
const list = { id:'list', name:'@deepseek-ai/dsh-tool-subagent-control/list-agents', disabled:false };

test('combined host control removes only the redundant same-scope legacy list row', () => {
  const rows = [{name:'cordis:group',group:true,config:[control,list,{name:'fixture',config:{keep:false}}]}];
  const original = structuredClone(rows);
  const result = adaptPresetPlugins(rows,{combinedSubagentControl:true});
  assert.deepEqual(result[0].config,[control,{name:'fixture',config:{keep:false}}]);
  assert.deepEqual(rows,original);
  assert.deepEqual(adaptPresetPlugins(rows,{combinedSubagentControl:false}),rows);
});

test('standalone discovery and disabled or conditional control rows are never silently removed', () => {
  for (const rows of [[list],[{...control,disabled:true},list],[{...control,disabled:{__jsExpr:'fixture'}},list],[control,{name:'cordis:group',group:true,config:[list]}],[{...control,isolate:{tools:true}},list],[control,{...list,config:{custom:true}}],[control,{...list,isolate:{tools:true}}]]) {
    assert.deepEqual(adaptPresetPlugins(rows,{combinedSubagentControl:true}),rows);
  }
});

test('host metadata detection distinguishes reviewed merged and legacy package exports', (t) => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-preset-compat-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const pkgDir=path.join(root,'node_modules','@deepseek-ai','dsh-tool-subagent-control');
  fs.mkdirSync(pkgDir,{recursive:true});
  const anchor=path.join(root,'package.json');
  const metadata=path.join(pkgDir,'package.json');
  for (const version of ['0.2.1-rc.2','0.2.1-rc.3','0.2.1-rc.4','0.2.1-rc.5','0.2.2-alpha.2','0.2.2-rc.1','0.3.0']) {
    const exports={'.':'./index.js','./package.json':'./package.json'};
    if (version.startsWith('0.2.1')) exports['./list-agents']='./list.js';
    fs.writeFileSync(metadata,JSON.stringify({name:'@deepseek-ai/dsh-tool-subagent-control',version,exports}));
    assert.equal(detectPresetCompatibility([anchor]).combinedSubagentControl,['0.2.2-alpha.2','0.2.2-rc.1'].includes(version));
  }
  assert.equal(detectPresetCompatibility([]).combinedSubagentControl,false);
});
