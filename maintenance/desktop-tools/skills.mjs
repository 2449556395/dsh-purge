import { lstatSync, opendirSync } from 'node:fs';
import path from 'node:path';

const validName = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,63}$/u;
function directoryWithoutLinks(directory) {
  if(typeof directory!=='string' || !path.isAbsolute(directory) || /^[\\/]{2}/u.test(directory))
    throw new Error('Use an explicit absolute local skills directory');
  const resolved=path.resolve(directory);
  for(let at=resolved;;at=path.dirname(at)) {
    const st=lstatSync(at);
    if(st.isSymbolicLink() || !st.isDirectory())throw new Error('Skill root must be a plain directory without links');
    if(at===path.dirname(at))break;
  }
  return resolved;
}
export function localSkillIndex(directory) {
  const root=directoryWithoutLinks(directory);
  const opened=opendirSync(root);
  const skills=[];
  let examined=0;
  try {
    for(let e; (e=opened.readSync())!==null;) {
      if(++examined>2000)throw new Error('Skill directory exceeds 2000 direct entries');
      if(!validName.test(e.name)||!e.isDirectory()||e.isSymbolicLink())continue;
      const folder=path.join(root,e.name);
      const dir=lstatSync(folder);
      if(!dir.isDirectory()||dir.isSymbolicLink())continue;
      let skill;
      try { skill=lstatSync(path.join(folder,'SKILL.md')); }
      catch(err) {if(err.code==='ENOENT')continue;throw err;}
      if(skill.isFile()&&!skill.isSymbolicLink())skills.push({id:e.name,bytes:skill.size});
    }
  } finally {opened.closeSync();}
  skills.sort((a,b)=>a.id.localeCompare(b.id,'en'));
  return {kind:'local-filesystem-index',skills,contentsRead:false};
}
