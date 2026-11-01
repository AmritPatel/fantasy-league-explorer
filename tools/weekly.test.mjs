import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {buildWeeklyData,completedSchedule,metric,validatePublicData} from './weekly-model.mjs';
import {collectWeeklyData} from './espn-read.mjs';
import {publishWeekly,renderWeekly,fingerprint} from './publish-weekly.mjs';
const presentation=JSON.parse(await fs.readFile(new URL('./presentation.json',import.meta.url),'utf8'));
const template=await fs.readFile(new URL('./chart-template.html',import.meta.url),'utf8');
const observedAt='2026-11-01T08:00:00.000Z';
function fixture({officialThrough=7,currentWeek=8}={}){
  const ids=Object.keys(presentation.teams).map(Number),stats=[];
  const records=id=>[
    {seasonId:2025,statSourceId:0,statSplitTypeId:0,scoringPeriodId:0,stats:{210:16,23:160,24:800,53:32,42:320,25:5}},
    ...Array.from({length:18},(_,i)=>({seasonId:2026,statSourceId:0,statSplitTypeId:1,scoringPeriodId:i+1,stats:{210:1,23:12+(id%5),24:60,53:3,42:30,25:0}})),
    ...Array.from({length:18},(_,i)=>({seasonId:2026,statSourceId:1,statSplitTypeId:1,scoringPeriodId:i+1,stats:{24:80+id%10,53:4,42:30}})),
  ];
  const player=(id,pos)=>{const p={id,defaultPositionId:pos,fullName:'Player '+id,injuryStatus:'ACTIVE',stats:records(id)};stats.push(p);return p};
  const league={id:12345,seasonId:2026,scoringPeriodId:currentWeek,teams:ids.map((id,i)=>({id,name:'Team '+id,currentProjectedRank:i+1,roster:{entries:[{lineupSlotId:i===0?21:20,playerPoolEntry:{player:player(100+i,2)}}]}}))};
  const pool={players:[2,3,4].flatMap(pos=>Array.from({length:6},(_,i)=>({status:i===0?'WAIVERS':'FREEAGENT',player:player(pos*1000+i,pos)})))};
  const teams=Array.from({length:32},(_,i)=>({id:i+1,proGamesByScoringPeriod:{}}));
  for(let week=1;week<=18;week++)for(let game=0;game<16;game++){
    const date=week===8?(game===0?Date.parse('2026-10-29T20:00:00Z'):Date.parse('2026-11-01T18:00:00Z')):Date.parse('2026-11-01T18:00:00Z')+(week-8)*7*86400000;
    const g={id:week*100+game,scoringPeriodId:week,homeProTeamId:game*2+1,awayProTeamId:game*2+2,date,statsOfficial:week<=officialThrough};
    for(const index of [game*2,game*2+1])(teams[index].proGamesByScoringPeriod[week]??=[]).push({...g});
  }
  return{league,pool,statistics:stats,schedule:{settings:{proTeams:teams}},presentation,observedAt,expectedLeagueId:'12345'};
}
const build=changes=>buildWeeklyData({...fixture(),...changes});
test('only consecutive official, past games count; an incomplete current week is excluded',()=>{
  const f=fixture();assert.equal(completedSchedule(f.schedule,Date.parse(observedAt)).completedThrough,7);
  const d=buildWeeklyData(f);assert.equal(d.completedThrough,7);assert.deepEqual(d.projectionWeeks,[9,10,11]);
  assert.equal(d.owned[0].current.games,7);assert.equal(d.owned[0].slotId,21);assert.equal(d.owned.length,8);assert.equal(d.freeAgents.length,15);
  assert.equal(d.weekly.completionVerified,true);assert.equal(d.weekly.officialGamesByWeek.length,7);
});
test('completed week can be included before league scoring-period rollover',()=>{
  const f=fixture({officialThrough:8});f.observedAt='2026-11-03T08:00:00.000Z';
  const d=buildWeeklyData(f);assert.equal(d.completedThrough,8);assert.deepEqual(d.projectionWeeks,[9,10,11]);
});
test('a not-yet-started new week is eligible for forecasts',()=>{
  const f=fixture();f.observedAt='2026-10-28T08:00:00.000Z';assert.deepEqual(buildWeeklyData(f).projectionWeeks,[8,9,10]);
});
test('forecast cutoff follows actual schedule even if league scoring period lags',()=>{
  const f=fixture();f.observedAt='2026-11-09T08:00:00.000Z';assert.deepEqual(buildWeeklyData(f).projectionWeeks,[10,11,12]);
});
test('inconsistent completion flags and missing schedule sides hold the cutoff back',()=>{
  const f=fixture();f.schedule.settings.proTeams[0].proGamesByScoringPeriod[7][0].statsOfficial=false;
  assert.equal(buildWeeklyData(f).completedThrough,6);
  const g=fixture();g.schedule.settings.proTeams[0].proGamesByScoringPeriod[7]=[];assert.equal(buildWeeklyData(g).completedThrough,6);
});
test('do not fabricate a completed week before the first official week',()=>{
  assert.throws(()=>buildWeeklyData(fixture({officialThrough:0})),{code:'WEEK_NOT_READY'});
});
test('no historical baseline means excluded coordinates, never zero improvement',()=>{
  const f=fixture();f.statistics[0].stats=f.statistics[0].stats.filter(s=>s.seasonId!==2025);
  const p=buildWeeklyData(f).owned[0];assert.equal(p.plottable,false);assert.equal(p.x,null);assert.equal(p.y,null);
});
test('free agents are ranked within position; missing forecasts are not zero forecasts',()=>{
  const f=fixture();const first=f.pool.players[0].player.id;f.statistics.find(p=>p.id===first).stats=f.statistics.find(p=>p.id===first).stats.filter(s=>!(s.statSourceId===1&&s.scoringPeriodId===9));
  const d=buildWeeklyData(f);assert.ok(!d.freeAgents.some(p=>p.id===first));
  for(const pos of ['RB','WR','TE']){const ps=d.freeAgents.filter(p=>p.position===pos);assert.equal(ps.length,5);assert.ok(ps.every((p,i)=>!i||ps[i-1].forwardTotal>=p.forwardTotal));}
});
test('invalid rank becomes unavailable, not a guessed replacement',()=>{
  const f=fixture();f.league.teams[0].currentProjectedRank=0;assert.equal(buildWeeklyData(f).powerComparison.teams[0].projectedRank,null);
});
test('missing statistics, duplicate entries, missing weekly data and nonfinite stats fail safely',()=>{
  const f=fixture();f.statistics=[];assert.throws(()=>buildWeeklyData(f),{code:'STATS_COVERAGE'});
  const g=fixture();g.league.teams[1].roster.entries=g.league.teams[0].roster.entries;assert.throws(()=>buildWeeklyData(g),{code:'ROSTER_DUPLICATE'});
  const h=fixture();for(const p of h.statistics)p.stats=p.stats.filter(s=>!(s.statSourceId===0&&s.scoringPeriodId===7&&s.seasonId===2026));assert.throws(()=>buildWeeklyData(h),{code:'ACTUAL_WEEK_COVERAGE'});
  assert.throws(()=>metric({23:NaN}),{code:'NONFINITE_STAT'});
});
test('end of regular season has no undefined forecast weeks',()=>{
  const f=fixture({officialThrough:18,currentWeek:19});f.observedAt='2027-01-25T08:00:00.000Z';const d=buildWeeklyData(f);
  assert.equal(d.completedThrough,18);assert.deepEqual(d.projectionWeeks,[]);assert.deepEqual(d.freeAgents,[]);
});
test('private fields and nonfinite public coordinates are rejected',()=>{
  const d=build();d.weekly.cookie='not-allowed';assert.throws(()=>validatePublicData(d),{code:'PRIVATE_FIELD'});
  const p=build();p.owned[0].x=Infinity;assert.throws(()=>validatePublicData(p),{code:'PUBLIC_NUMBER'});
});
test('collector sends credentials only to league endpoints and uses GET requests only',async()=>{
  const f=fixture(),calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url,options});assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');
    const auth=url.includes('/leagues/');assert.equal(Boolean(options.headers.cookie),auth);
    let body;if(url.includes('proTeamSchedules'))body=f.schedule;else if(url.includes('/players?'))body=f.statistics;else if(url.includes('kona_player_info')){body=f.pool;assert.equal(JSON.parse(options.headers['x-fantasy-filter']).players.sortDraftRanks.value,'PPR');}else body=f.league;
    return{ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>body};
  };
  const d=await collectWeeklyData({presentation,env:{ESPN_SESSION_S2:'secret-value-long',ESPN_SESSION_SWID:'another-secret-value',ESPN_LEAGUE_ID:'12345'},fetchImpl,observedAt});
  assert.equal(calls.length,4);assert.equal(d.owned.length,8);assert.ok(!JSON.stringify(d).includes('secret-value'));
});
test('authentication failures do not expose response contents or request URLs',async()=>{
  await assert.rejects(()=>collectWeeklyData({presentation,env:{ESPN_SESSION_S2:'a',ESPN_SESSION_SWID:'b',ESPN_LEAGUE_ID:'12345'},fetchImpl:async()=>({ok:false,status:401})}),{code:'AUTH_REJECTED',message:'AUTH_REJECTED'});
});
test('timestamp-only refresh does not create a new archive',()=>{
  const d=build(),next=structuredClone(d);next.observedAt='2026-11-02T08:00:00.000Z';next.powerComparison.observedAt=next.observedAt;assert.equal(fingerprint(d),fingerprint(next));
});
test('weekly publication preserves previous revisions and never rewrites frozen root',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'league-weekly-test-'));await fs.writeFile(path.join(root,'index.html'),'frozen-original');
  const d=build();const first=await publishWeekly({root,data:d,presentation,template});assert.equal(first.changed,true);
  const originalArchive=await fs.readFile(path.join(root,'weekly','snapshots',first.snapshot+'.html'),'utf8');
  const newer=structuredClone(d);newer.observedAt='2026-11-02T08:00:00.000Z';newer.powerComparison.observedAt=newer.observedAt;newer.owned[0].injuryStatus='QUESTIONABLE';
  const second=await publishWeekly({root,data:newer,presentation,template});assert.equal(second.changed,true);
  const manifest=JSON.parse(await fs.readFile(path.join(root,'weekly','manifest.json'),'utf8'));assert.equal(manifest.entries.length,2);
  assert.equal(await fs.readFile(path.join(root,'weekly','snapshots',first.snapshot+'.html'),'utf8'),originalArchive);
  assert.equal(await fs.readFile(path.join(root,'index.html'),'utf8'),'frozen-original');
  assert.equal((await publishWeekly({root,data:newer,presentation,template})).changed,false);
});
test('regressive or invalid data cannot replace the last good publication',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'league-weekly-hold-')),d=build();await publishWeekly({root,data:d,presentation,template});
  const before=await fs.readFile(path.join(root,'weekly','index.html'),'utf8'),older=structuredClone(d);older.completedThrough=6;
  await assert.rejects(()=>publishWeekly({root,data:older,presentation,template}),{code:'WEEK_REGRESSION'});
  const bad=structuredClone(d);bad.owned[0].x=NaN;await assert.rejects(()=>publishWeekly({root,data:bad,presentation,template}));
  assert.equal(await fs.readFile(path.join(root,'weekly','index.html'),'utf8'),before);
});
test('HTML rendering escapes data and preserves COM default, corner labels and power comparison',()=>{
  const d=build();d.owned[0].name='</script><script>bad()</script>';
  const manifest={entries:[{href:'weekly/snapshots/example.html',observedAt:d.observedAt,completedThrough:d.completedThrough}]};
  const html=renderWeekly({template,data:d,manifest,basePath:presentation.basePath});
  assert.ok(!html.includes('</script><script>bad()'));
  assert.ok(html.includes('<option value="score" selected>COM score gap'));
  for(const value of ['chart-corners-top','chart-corners-bottom','power-ranking','weekly-history','Weekly snapshot','Original frozen snapshot']){
    if(value==='Weekly snapshot')continue;assert.ok(html.includes(value));
  }
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/.test(html));
  assert.ok(!html.includes('/* WEEKLY_DATA */'));assert.ok(!html.includes('<!-- WEEKLY_NAV -->'));
});
