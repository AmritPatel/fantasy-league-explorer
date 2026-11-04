import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';

export function chartData(html){
  const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)?.[1]??'';
  const marker='  const data=',start=script.indexOf(marker),end=script.indexOf(';\n  const dark=',start);
  assert.ok(start>=0&&end>start,'Rendered chart data must be present');
  return JSON.parse(script.slice(start+marker.length,end));
}
export async function checkRoutes({read,basePath,expectedFrozen,expectedLatest,manifest}){
  const [home,alias,frozen,history]=await Promise.all(['index.html','weekly/index.html','snapshot/index.html','weekly/history.html'].map(read));
  assert.equal(home,alias,'The main page and old weekly URL must show the same latest view');
  assert.ok(home.includes('id="weekly-history"'),'The main page must be the weekly explorer');
  assert.deepEqual(chartData(home),expectedLatest,'The main page must contain the latest validated data');
  assert.ok(expectedLatest.owned.every(p=>['RB','WR','TE'].includes(p.position)),'QB comparisons are intentionally excluded');
  assert.equal(createHash('sha256').update(frozen).digest('hex'),expectedFrozen,'The original snapshot must be preserved exactly');
  const frozenLink=`<a href="${basePath}snapshot/">Original frozen snapshot</a>`;
  const latestLink=`<a href="${basePath}">Latest weekly view</a>`;
  for(const page of [home,history]){assert.ok(page.includes(frozenLink));assert.ok(page.includes(latestLink));}
  for(const entry of manifest.entries){
    const archive=await read(entry.href);
    assert.ok(archive.includes(frozenLink)&&archive.includes(latestLink),'Archive links must point to the new home and snapshot locations');
    assert.equal(chartData(archive).observedAt,entry.observedAt,'Archive data must remain unchanged');
  }
  return{passed:true,mainPageWeek:expectedLatest.completedThrough,weeklyCompatibilityView:true,frozenSnapshotPreserved:true,archivesChecked:manifest.entries.length};
}
async function main(){
  const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const presentation=JSON.parse(await fs.readFile(path.join(root,'tools','presentation.json'),'utf8'));
  const expectedFrozen=(await fs.readFile(path.join(root,'tools','frozen.sha256'),'utf8')).trim();
  const expectedLatest=JSON.parse(await fs.readFile(path.join(root,'weekly','data','latest.json'),'utf8'));
  const manifest=JSON.parse(await fs.readFile(path.join(root,'weekly','manifest.json'),'utf8'));
  const live=process.argv.includes('--live');
  const base=new URL(process.env.PUBLIC_SITE_URL??`https://amritpatel.github.io${presentation.basePath}`);
  assert.equal(base.protocol,'https:');
  const read=live?async relative=>{
    const response=await fetch(new URL(relative,base),{headers:{'cache-control':'no-cache'},signal:AbortSignal.timeout(30000)});
    assert.equal(response.status,200,'Every published route must be reachable');return response.text();
  }:relative=>fs.readFile(path.join(root,'_site',relative),'utf8');
  for(let attempt=1;attempt<=(live?6:1);attempt++){
    try{console.log(JSON.stringify({mode:live?'live':'build',...await checkRoutes({read,basePath:presentation.basePath,expectedFrozen,expectedLatest,manifest})}));return;}
    catch(error){
      if(!live||attempt===6)throw error;
      console.log(JSON.stringify({mode:'live',waitingForDeployment:true,attempt}));await new Promise(resolve=>setTimeout(resolve,10000));
    }
  }
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  main().catch(()=>{console.error(JSON.stringify({siteChecksPassed:false,message:'Main-page, compatibility, or preserved-snapshot validation failed.'}));process.exitCode=1;});
}
