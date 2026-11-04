import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {validatePublicData} from './weekly-model.mjs';
import {renderWeekly,renderHistory,updateArchiveLinks} from './publish-weekly.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out=path.join(root,'_site');
const presentation=JSON.parse(await fs.readFile(path.join(root,'tools','presentation.json'),'utf8'));
const expected=(await fs.readFile(path.join(root,'tools','frozen.sha256'),'utf8')).trim();
assert.equal(createHash('sha256').update(await fs.readFile(path.join(root,'index.html'))).digest('hex'),expected,'The original frozen page must remain unchanged');
await fs.mkdir(out,{recursive:true});
await fs.mkdir(path.join(out,'snapshot'),{recursive:true});
await fs.copyFile(path.join(root,'index.html'),path.join(out,'snapshot','index.html'));
for(const name of ['robots.txt','.nojekyll','LICENSE-Plotly.txt'])await fs.copyFile(path.join(root,name),path.join(out,name));
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
    if(relative.startsWith(path.join('weekly','snapshots')+path.sep)&&relative.endsWith('.html'))await fs.writeFile(target,updateArchiveLinks(text,presentation.basePath));
    else await fs.copyFile(source,target);
  }
}
await copyPublic('assets');await copyPublic('weekly');
// Re-render only the latest view when presentation code changes. Archived HTML
// and its underlying data remain immutable.
const data=JSON.parse(await fs.readFile(path.join(root,'weekly','data','latest.json'),'utf8'));
const manifest=JSON.parse(await fs.readFile(path.join(root,'weekly','manifest.json'),'utf8'));
const template=await fs.readFile(path.join(root,'tools','chart-template.html'),'utf8');
const latestHtml=renderWeekly({template,data,manifest,basePath:presentation.basePath});
assert.ok(!/\/Users\/|browser-profile|espn_s2|\bSWID\b|localhost|127\.0\.0\.1/i.test(latestHtml));
await fs.writeFile(path.join(out,'weekly','index.html'),latestHtml);
await fs.writeFile(path.join(out,'index.html'),latestHtml);
await fs.writeFile(path.join(out,'weekly','history.html'),renderHistory(manifest,presentation.basePath));
assert.equal((await fs.readFile(path.join(out,'snapshot','index.html'))).compare(await fs.readFile(path.join(root,'index.html'))),0);
console.log(JSON.stringify({built:true,output:'_site',mainPage:'latest-weekly-view',weeklyCompatibilityView:true,frozenSnapshot:'snapshot/',originalFrozenPagePreserved:true}));
