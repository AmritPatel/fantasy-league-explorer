import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {validatePublicData} from './weekly-model.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out=path.join(root,'_site');
const expected=(await fs.readFile(path.join(root,'tools','frozen.sha256'),'utf8')).trim();
assert.equal(createHash('sha256').update(await fs.readFile(path.join(root,'index.html'))).digest('hex'),expected,'The original frozen page must remain unchanged');
await fs.mkdir(out,{recursive:true});
for(const name of ['index.html','robots.txt','.nojekyll','LICENSE-Plotly.txt'])await fs.copyFile(path.join(root,name),path.join(out,name));
async function copyPublic(relative){
  const source=path.join(root,relative),target=path.join(out,relative),info=await fs.lstat(source);
  assert.ok(!info.isSymbolicLink(),'Public output must not contain symlinks');
  if(info.isDirectory()){
    await fs.mkdir(target,{recursive:true});for(const name of await fs.readdir(source)){assert.ok(!name.startsWith('.')&&!name.endsWith('.pending'));await copyPublic(path.join(relative,name));}
  }else{
    assert.ok(/\.(?:html|json|js)$/.test(relative));
    if(relative.endsWith('.json')&&!relative.endsWith('manifest.json'))validatePublicData(JSON.parse(await fs.readFile(source,'utf8')));
    const text=await fs.readFile(source,'utf8');
    assert.ok(!/\/Users\/|browser-profile|espn_s2|\bSWID\b|localhost|127\.0\.0\.1/i.test(text),'Private context must not enter the public artifact');
    await fs.copyFile(source,target);
  }
}
await copyPublic('assets');await copyPublic('weekly');
assert.equal((await fs.readFile(path.join(out,'index.html'))).compare(await fs.readFile(path.join(root,'index.html'))),0);
console.log(JSON.stringify({built:true,output:'_site',originalFrozenPagePreserved:true,weeklyView:true}));
