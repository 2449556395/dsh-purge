import { validateRecords, renderReport, replayRecords } from './records.mjs';
import { listTemplates, getTemplate } from './catalog.mjs';

export const name = 'harness-maintenance-tools';
export const inject = ['tools'];
const input = {type:'string',description:'User-supplied schemaVersion 1 JSON record text. Do not use file paths or secrets.'};
const out = {type:'object',additionalProperties:false,required:['text'],properties:{text:{type:'string'}}};
function definition(name,description,properties,required,run) {
  return {
    name,description,parameters:{type:'object',additionalProperties:false,properties,required},
    output:{schema:out,render:(_args, result)=>[{type:'text',text:result.text}]},
    async execute(args) {
      // Use only provided text and the bundled catalog; no workspace or account access.
      const result=run(args);
      return {text:typeof result==='string'?result:JSON.stringify(result,null,2)};
    }
  };
}
export function definitions() {
  return [
    definition('maintenance_validate_records','Validate explicit local maintenance record JSON without reading or writing files.',
      {json:input},['json'],({json})=>validateRecords(json)),
    definition('maintenance_export_report','Render the supplied records as Markdown or JSON text, without writing files.',
      {json:input,format:{type:'string',enum:['markdown','json']}},['json','format'],({json,format})=>renderReport(json,format)),
    definition('maintenance_replay_records','Show supplied historical records in time order. Records are never executed.',
      {json:input},['json'],({json})=>({records:replayRecords(json)})),
    definition('maintenance_template_catalog','List bundled ordinary task templates, or return the text for a selected template id.',
      {id:{type:'string',enum:['patch','schedule','compat','diagnose','review','release']}},[],
      ({id})=>id===undefined?listTemplates():getTemplate(id))
  ];
}
export function apply(ctx) {
  const registry=ctx.tools;
  if(typeof registry?.register!=='function')throw new Error('Harness tool registry unavailable');
  const defs=definitions();
  const disposers=[];
  // Reject collisions before registering any tools. Register/dispose within this plugin scope.
  for(const d of defs)if(typeof registry.get==='function' && registry.get(d.name))throw new Error('Maintenance tool already registered: '+d.name);
  const dispose=()=>{for(const fn of disposers.splice(0).reverse())if(typeof fn==='function')fn();};
  try {
    for(const d of defs)disposers.push(registry.register(d));
    ctx.effect(()=>dispose);
  } catch(err){dispose();throw err;}
}
