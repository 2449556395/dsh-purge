import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, definitions } from './index.mjs';
import { parseRecords, validateRecords, renderReport, replayRecords } from './records.mjs';
import { listTemplates, getTemplate } from './catalog.mjs';

const row={id:'B-01',title:'合成记录',status:'done',summary:'示例',updatedAt:'2026-11-04T10:00:00Z'};
const make=(...records)=>JSON.stringify({schemaVersion:1,records});
test('validate records and normalize timestamp',()=>{
  assert.deepEqual(validateRecords(make(row)),{ok:true,count:1,counts:{todo:0,doing:0,done:1,blocked:0}});
  assert.equal(parseRecords(make(row)).records[0].updatedAt,'2026-11-04T10:00:00.000Z');
});
test('reject ambiguous roots, schema changes and malformed JSON',()=>{
  for(const input of ['{','[]','{}','{"schemaVersion":2,"records":[]}','{"schemaVersion":1,"records":[],"other":true}']){
    assert.throws(()=>parseRecords(input));
  }
});
test('reject duplicate ids and unknown fields',()=>{
  assert.throws(()=>parseRecords(make(row,{...row,id:'b-01'})),/duplicate id/u);
  assert.throws(()=>parseRecords(make({...row,command:'sample'})),/unknown fields/u);
  assert.throws(()=>parseRecords('{"schemaVersion":1,"records":[{"__proto__":{}}]}'),/unknown fields/u);
});
test('reject invalid dates and states, including normalized rollover',()=>{
  for(const updatedAt of ['2026-11-31T10:00:00Z','2026-11-04T10:00:00+08:00','2026-11-04T24:00:00Z']){
    assert.throws(()=>parseRecords(make({...row,updatedAt})),/invalid UTC/u);
  }
  assert.throws(()=>parseRecords(make({...row,status:'unknown'})),/invalid status/u);
});
test('bounded inputs and forbidden control characters',()=>{
  assert.throws(()=>parseRecords('中'.repeat(50000)),/128 KiB/u);
  assert.throws(()=>parseRecords(make(...Array.from({length:101},(_,n)=>({...row,id:String(n)})))),/100 records/u);
  assert.throws(()=>parseRecords(make({...row,title:'x\u001by'})),/invalid title/u);
  assert.throws(()=>parseRecords(make({...row,summary:'y\u202ex'})),/invalid summary/u);
});
test('markdown makes active syntax literal even when the text contains fences',()=>{
  const md=renderReport(make({...row,title:'<script>example</script>',summary:'first\n~~~~~~\n[example](https://example.invalid)'}),'markdown');
  assert.match(md,/\n~~~~~~~\n标题：<script>example<\/script>/u);
  assert.match(md,/\n~~~~~~\n\[example\]\(https:\/\/example.invalid\)\n~~~~~~~\n/u);
  assert.equal(JSON.parse(renderReport(make(row),'json')).records[0].title,'合成记录');
  assert.throws(()=>renderReport(make(row),'html'),/Format/u);
});
test('replay is deterministic, stable for tied timestamps, and returns data only',()=>{
  const x=replayRecords(make(row,{...row,id:'early',updatedAt:'2026-11-04T09:00:00Z',summary:'echo example'},{...row,id:'tied'}));
  assert.deepEqual(x.map(r=>r.id),['early','B-01','tied']);
  assert.equal(x[0].summary,'echo example');
});
test('catalog returns copies of static templates',()=>{
  const list=listTemplates(); assert.equal(list.length,6);
  const a=getTemplate('patch');a.title='改写';
  assert.equal(getTemplate('patch').title,'最小补丁');
  assert.throws(()=>getTemplate('nonexistent'),/Unknown template/u);
});
function fixture(failAt=Infinity) {
  const entries=new Map(), disposers=[];
  let calls=0;
  const ctx={
    tools:{
      get:k=>entries.get(k),
      register(d){
        if(++calls===failAt)throw new Error('fixture registration failure');
        entries.set(d.name,d);
        return ()=>entries.delete(d.name);
      }
    },
    effect(fn){disposers.push(fn());}
  };
  return {ctx,entries,disposers};
}
test('registers only four tools; lifecycle disposal leaves unrelated tools',()=>{
  const f=fixture();f.entries.set('unrelated',{});
  apply(f.ctx);assert.equal(f.entries.size,5);
  f.disposers[0]();assert.deepEqual([...f.entries.keys()],['unrelated']);
});
test('collision is rejected before any registry change',()=>{
  const f=fixture(), key=definitions()[2].name;f.entries.set(key,{existing:true});
  assert.throws(()=>apply(f.ctx),/already registered/u);
  assert.deepEqual([...f.entries.entries()],[[key,{existing:true}]]);
});
test('registration failure rolls back successful earlier registrations',()=>{
  const f=fixture(3);assert.throws(()=>apply(f.ctx),/fixture registration failure/u);
  assert.equal(f.entries.size,0);
});
