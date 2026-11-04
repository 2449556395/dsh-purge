#!/usr/bin/env node
import { MAX_INPUT_BYTES, validateRecords, renderReport, replayRecords } from './records.mjs';
import { listTemplates, getTemplate } from './catalog.mjs';
import { localSkillIndex } from './skills.mjs';
async function readInput() {
  let total=0;
  const chunks=[];
  for await(const chunk of process.stdin) {
    total+=chunk.length;
    if(total>MAX_INPUT_BYTES)throw new Error('Input exceeds 128 KiB');
    chunks.push(chunk);
  }
  return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
}
async function main([action, option, ...extra]) {
  if(extra.length)throw new Error('Unexpected arguments');
  if(action==='skills' && option!==undefined)return localSkillIndex(option);
  if(action==='catalog' && option===undefined)return listTemplates();
  if(action==='template' && option!==undefined)return getTemplate(option);
  if(action==='validate' && option===undefined)return validateRecords(await readInput());
  if(action==='replay' && option===undefined)return {records:replayRecords(await readInput())};
  if(action==='report' && (option==='markdown'||option==='json'))return renderReport(await readInput(),option);
  throw new Error('Usage: skills ABSOLUTE_DIR | catalog | template ID | validate | replay | report markdown|json (records via stdin)');
}
try {
  const result=await main(process.argv.slice(2));
  process.stdout.write(typeof result==='string'?result:JSON.stringify(result,null,2)+'\n');
} catch(err) { console.error(err.message);process.exitCode=1; }
