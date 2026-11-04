import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

const root=process.argv[2];
if(!root)throw new Error('Usage: Electron Node-mode Test-OfficialHost.mjs OFFICIAL_PAYLOAD_ROOT [PACKAGED_PLUGIN_ROOT]');
const packageRoot=process.argv[3];
const entry=packageRoot?pathToFileURL(join(packageRoot,'index.mjs')).href:new URL('./index.mjs',import.meta.url).href;
const maintenance=await import(entry);
if(packageRoot) {
  const manifest=JSON.parse(readFileSync(join(packageRoot,'package.json'),'utf8'));
  assert.equal(manifest.name,'harness-maintenance-tools');
  assert.equal(manifest.version,'0.1.2');
  assert.equal(manifest.engines.dsh,'0.2.2-rc.1');
  assert.equal(manifest.scripts,undefined);
  const bundle=readFileSync(join(packageRoot,'cordis.patch.yml'),'utf8');
  assert.match(bundle,/name: harness-maintenance-tools/u);
  assert.doesNotMatch(bundle,/system-prompt|sandbox|approval/u);
}
const req=createRequire(join(root,'resources','app.asar','dsh','package.json'));
const load=name=>import(pathToFileURL(req.resolve(name)).href);
const packageVersion=name=>req(name+'/package.json').version;
assert.equal(packageVersion('@deepseek-ai/dsh-tools'),'0.2.2-rc.1');
assert.equal(packageVersion('@deepseek-ai/dsh-system-prompt'),'0.2.2-rc.1');
const {Context}=await load('@deepseek-ai/cordis');
const tools=await load('@deepseek-ai/dsh-tools');
const prompt=await load('@deepseek-ai/dsh-system-prompt');
const host=new Context();
const names=maintenance.definitions().map(d=>d.name);
const json=JSON.stringify({schemaVersion:1,records:[{
  id:'sample-1',title:'普通记录',status:'done',updatedAt:'2026-11-04T12:00:00Z',summary:'合成测试'
}]});
try {
  await host.plugin(prompt.default);
  await host.plugin(tools.default);
  const installed=host.plugin(maintenance);
  await installed;
  for(const n of names)assert.equal(host.tools.get(n)?.name,n);
  const valid=await host.tools.get(names[0]).execute({json});
  assert.equal(JSON.parse(valid.text).count,1);
  const md=await host.tools.get(names[1]).execute({json,format:'markdown'});
  assert.match(md.text,/普通记录/u);
  const history=await host.tools.get(names[2]).execute({json});
  assert.equal(JSON.parse(history.text).records[0].id,'sample-1');
  const catalog=await host.tools.get(names[3]).execute({});
  assert.equal(JSON.parse(catalog.text).length,6);
  const presentation=prompt.renderPrompt({
    sections:[
      {name:'host-patch-fixture',text:'PATCH_BASE'},
      {name:'host-schedule-fixture',text:'SCHEDULE_BASE'},
      {name:'literal-fixture',text:'{{example}}',interpolate:false}
    ],
    contexts:[],variables:{},tools:[],
  });
  assert.match(presentation,/PATCH_BASE[\s\S]+SCHEDULE_BASE[\s\S]+\{\{example\}\}/u);
  await installed.dispose();
  for(const n of names)assert.equal(host.tools.get(n),undefined);
  console.log(JSON.stringify({host:'0.2.2-rc.1',cordis:packageVersion('@deepseek-ai/cordis'),registered:names,executed:4,cleanupVerified:true,promptRendererVerified:true,desktopStarted:false,modelRequests:0}));
} finally {
  await host.fiber.dispose();
}
