import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {DataCheckError,validatePublicData} from './weekly-model.mjs';

const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function fingerprint(data){
  const {observedAt,powerComparison,...rest}=data;
  return createHash('sha256').update(JSON.stringify({...rest,powerComparison:{teams:powerComparison.teams}})).digest('hex');
}
export function renderWeekly({template,data,manifest,basePath,archive=false}){
  validatePublicData(data);
  if(!/^\/[A-Za-z0-9/_-]+\/$/.test(basePath))throw new DataCheckError('BASE_PATH');
  const options=manifest.entries.map(entry=>`<option value="${escape(basePath+entry.href)}"${entry.observedAt===data.observedAt?' selected':''}>Through Week ${entry.completedThrough} · ${escape(entry.observedAt.slice(0,10))} ${escape(entry.observedAt.slice(11,16))} UTC</option>`).join('');
  const nav=`<section class="weekly-nav" aria-label="Weekly publication status">
    <strong>${archive?'Archived snapshot':'Latest weekly view'} · ${data.season} through Week ${data.completedThrough}</strong>
    <p id="weekly-freshness" class="meta">Validated ${escape(data.observedAt)}. Checks run Tuesday–Thursday at 06:37 UTC (12:22 PM Nepal time). Refresh this page to see a newer publication.</p>
    <p class="meta">Only fully official game weeks are included. Rosters and available players reflect the refresh time—not historical ownership during those games. ${data.projectionWeeks.length?'':'The regular season is complete; there are no remaining regular-season forecasts.'}</p>
    <label for="weekly-history">Explore published snapshots</label><select id="weekly-history">${options}</select>
    <div class="weekly-links"><a href="${basePath}weekly/">Latest weekly view</a><a href="${basePath}weekly/history.html">All weekly snapshots</a><a href="${basePath}">Original frozen snapshot</a></div>
  </section>`;
  let html=template.replace('/* WEEKLY_DATA */',()=>JSON.stringify(data).replaceAll('<','\\u003c')).replace('<!-- WEEKLY_NAV -->',()=>nav);
  html=html.replace("  const rosterMissing=",`  document.getElementById('weekly-history').addEventListener('change',event=>{if(event.target.value.startsWith(${JSON.stringify(basePath+'weekly/snapshots/')}))location.assign(event.target.value)});
  const rosterMissing=`);
  if(archive)html=html.replace("if(data.completedThrough<18&&(Date.now()", "if(false&&data.completedThrough<18&&(Date.now()");
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if(scripts.length!==1)throw new DataCheckError('TEMPLATE_SCRIPTS');new vm.Script(scripts[0][1]);
  if(html.includes('/* WEEKLY_DATA */')||html.includes('<!-- WEEKLY_NAV -->'))throw new DataCheckError('TEMPLATE_PLACEHOLDER');
  return html;
}
export function renderHistory(manifest,basePath){
  const groups=manifest.entries.map(entry=>`<li><a href="${escape(basePath+entry.href)}">${manifest.season} · through Week ${entry.completedThrough}</a> — published ${escape(entry.observedAt)} · ${entry.rosteredPlayers} rostered RB/WR/TE</li>`).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>Weekly archive · Fantasy League Explorer</title><style>:root{color-scheme:light dark}body{font:16px/1.6 system-ui,sans-serif;max-width:850px;margin:40px auto;padding:0 20px}li{margin:14px 0}a{color:light-dark(#006680,#74d2e0)}</style></head><body><h1>Weekly snapshot archive</h1><p>Each publication preserves the validated data available at that refresh. Multiple snapshots for one week may reflect stat corrections, roster moves or updated forecasts. They do not reconstruct historical ownership.</p><p><a href="${basePath}weekly/">Latest weekly view</a> · <a href="${basePath}">Original frozen snapshot</a></p><ol>${groups}</ol></body></html>`;
}
async function writeAtomic(filename,contents){
  await fs.mkdir(path.dirname(filename),{recursive:true});
  const temporary=filename+'.pending';await fs.writeFile(temporary,contents);await fs.rename(temporary,filename);
}
export async function publishWeekly({root,data,presentation,template}){
  validatePublicData(data);
  let manifest;
  try{manifest=JSON.parse(await fs.readFile(path.join(root,'weekly','manifest.json'),'utf8'));}
  catch(error){if(error.code!=='ENOENT')throw error;manifest={schemaVersion:1,season:data.season,entries:[]};}
  if(manifest.season!==data.season)throw new DataCheckError('ARCHIVE_SEASON');
  const latest=manifest.entries[0];
  if(latest&&data.completedThrough<latest.completedThrough)throw new DataCheckError('WEEK_REGRESSION');
  const hash=fingerprint(data);if(latest?.fingerprint===hash)return{changed:false,completedThrough:data.completedThrough};
  const stamp=data.observedAt.replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
  const key=`${data.season}-week-${String(data.completedThrough).padStart(2,'0')}-${stamp}`;
  if(!/^\d{4}-week-\d{2}-\d{8}T\d{6}Z$/.test(key))throw new DataCheckError('SNAPSHOT_KEY');
  if(manifest.entries.some(e=>e.key===key))throw new DataCheckError('SNAPSHOT_COLLISION');
  const entry={key,completedThrough:data.completedThrough,observedAt:data.observedAt,href:`weekly/snapshots/${key}.html`,dataHref:`weekly/data/${key}.json`,fingerprint:hash,rosteredPlayers:data.owned.length};
  manifest.entries.unshift(entry);
  const latestHtml=renderWeekly({template,data,manifest,basePath:presentation.basePath});
  const archivedHtml=renderWeekly({template,data,manifest,basePath:presentation.basePath,archive:true});
  const json=JSON.stringify(data);
  // Everything is validated and rendered before any publication files change.
  await writeAtomic(path.join(root,entry.dataHref),json);
  await writeAtomic(path.join(root,entry.href),archivedHtml);
  await writeAtomic(path.join(root,'weekly','data','latest.json'),json);
  await writeAtomic(path.join(root,'weekly','index.html'),latestHtml);
  await writeAtomic(path.join(root,'weekly','history.html'),renderHistory(manifest,presentation.basePath));
  await writeAtomic(path.join(root,'weekly','manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  return{changed:true,completedThrough:data.completedThrough,snapshot:key,rosteredPlayers:data.owned.length,comparablePlayers:data.centerOfMass.reference.count};
}
