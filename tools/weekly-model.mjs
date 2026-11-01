import {rankTeamCenters} from './team-centers.mjs';

export class DataCheckError extends Error {
  constructor(code){super(code);this.name='DataCheckError';this.code=code;}
}
const check=(value,code)=>{if(!value)throw new DataCheckError(code);};
const position={2:'RB',3:'WR',4:'TE'};
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const safeRank=(value,count)=>Number.isInteger(value)&&value>=1&&value<=count?value:null;

export function completedSchedule(schedule,now=Date.now()){
  const teams=schedule?.settings?.proTeams;
  check(Array.isArray(teams)&&teams.filter(t=>t.id>0).length>=32,'SCHEDULE_COVERAGE');
  const weeks=new Map();
  for(const team of teams)for(const [key,games]of Object.entries(team.proGamesByScoringPeriod??{})){
    const week=Number(key);if(week<1||week>18)continue;
    check(Array.isArray(games),'SCHEDULE_CONTRACT');
    const group=weeks.get(week)??new Map();weeks.set(week,group);
    for(const game of games){
      check(Number.isInteger(game.id)&&game.scoringPeriodId===week&&finite(game.date),'SCHEDULE_CONTRACT');
      const prior=group.get(game.id);
      if(prior)check(prior.date===game.date&&prior.home===game.homeProTeamId&&prior.away===game.awayProTeamId,'SCHEDULE_CONFLICT');
      group.set(game.id,{date:game.date,home:game.homeProTeamId,away:game.awayProTeamId,
        official:game.statsOfficial===true&&(!prior||prior.official),
        seen:new Set([...(prior?.seen??[]),team.id])});
    }
  }
  let completedThrough=0;
  for(let week=1;week<=18;week++){
    const games=[...(weeks.get(week)?.values()??[])];
    if(games.length<8||!games.every(g=>g.official&&g.date<now&&g.seen.has(g.home)&&g.seen.has(g.away)))break;
    completedThrough=week;
  }
  return{completedThrough,weeks};
}

export function metric(stats={}){
  const v=key=>{const value=stats?.[key];check(value===undefined||finite(value),'NONFINITE_STAT');return value??0;};
  const games=v(210),touches=v(23)+v(53);
  const ppr=.1*(v(24)+v(42))+6*(v(25)+v(43))+v(53)+2*(v(26)+v(44))-2*v(72);
  return{games,touches,ppr,touchesPerGame:games?touches/games:null,pprPerGame:games?ppr/games:null,pprPerTouch:touches?ppr/touches:null};
}

export function buildWeeklyData({league,pool,statistics,schedule,presentation,observedAt=new Date().toISOString(),expectedLeagueId}){
  const season=presentation.season;
  check(String(league?.id)===String(expectedLeagueId),'LEAGUE_ID');
  check(league.seasonId===undefined||league.seasonId===season,'SEASON');
  check(Array.isArray(league.teams)&&league.teams.length===presentation.expectedTeams,'TEAM_COVERAGE');
  check(new Set(league.teams.map(t=>t.id)).size===league.teams.length,'TEAM_DUPLICATE');
  check(Number.isInteger(league.scoringPeriodId)&&league.scoringPeriodId>0,'SCORING_PERIOD');
  check(Number.isFinite(Date.parse(observedAt)),'SNAPSHOT_TIME');
  const completed=completedSchedule(schedule,Date.parse(observedAt));
  if(!completed.completedThrough)throw new DataCheckError('WEEK_NOT_READY');
  const completedThrough=completed.completedThrough;
  const startedWeeks=[...completed.weeks].filter(([,games])=>[...games.values()].some(g=>g.date<=Date.parse(observedAt))).map(([week])=>week);
  const firstForecast=Math.max(completedThrough,...startedWeeks)+1;
  const projectionWeeks=Array.from({length:Math.max(0,Math.min(3,19-firstForecast))},(_,i)=>firstForecast+i);
  const teams=league.teams.map(t=>{
    const style=presentation.teams[String(t.id)];
    check(style&&/^#[a-fA-F0-9]{6}$/.test(style.color),'TEAM_PRESENTATION');
    const name=t.name||[t.location,t.nickname].filter(Boolean).join(' ');
    check(typeof name==='string'&&name.length>0&&name.length<=150,'TEAM_NAME');
    return{id:t.id,name,code:style.code,color:style.color};
  });
  const rawRoster=league.teams.flatMap(t=>{
    check(Array.isArray(t.roster?.entries),'ROSTER_COVERAGE');
    return t.roster.entries.map(entry=>({entry,team:teams.find(team=>team.id===t.id)}));
  });
  const ownedIds=new Set(rawRoster.map(({entry})=>entry.playerPoolEntry?.player?.id));
  check(ownedIds.size===rawRoster.length&&!ownedIds.has(undefined),'ROSTER_DUPLICATE');
  const roster=rawRoster.filter(({entry})=>position[entry.playerPoolEntry.player.defaultPositionId]);
  check(roster.length>0,'ROSTER_EMPTY');
  check(Array.isArray(pool?.players)&&pool.players.length<20000,'POOL_TRUNCATED');
  const candidates=pool.players.filter(e=>position[e.player?.defaultPositionId]&&['FREEAGENT','WAIVERS'].includes(e.status)&&!ownedIds.has(e.player.id));
  check(candidates.length>0&&new Set(candidates.map(e=>e.player.id)).size===candidates.length,'POOL_COVERAGE');
  const rows=Array.isArray(statistics)?statistics:statistics?.players;
  check(Array.isArray(rows)&&new Set(rows.map(p=>p.id)).size===rows.length,'STATS_CONTRACT');
  const lookup=new Map(rows.map(p=>[p.id,p]));
  const relevant=[...new Set([...roster.map(({entry})=>entry.playerPoolEntry.player.id),...candidates.map(e=>e.player.id)])];
  const statCoverage=relevant.filter(id=>lookup.has(id)).length;
  check(statCoverage>=relevant.length*.95,'STATS_COVERAGE');
  check(roster.filter(({entry})=>lookup.has(entry.playerPoolEntry.player.id)).length>=roster.length*.95,'ROSTER_STATS_COVERAGE');
  const actualWeeks=new Set(relevant.flatMap(id=>(lookup.get(id)?.stats??[]).filter(s=>s.seasonId===season&&s.statSourceId===0&&s.statSplitTypeId===1&&s.scoringPeriodId>=1&&s.scoringPeriodId<=completedThrough).map(s=>s.scoringPeriodId)));
  check(Array.from({length:completedThrough},(_,i)=>i+1).every(week=>actualWeeks.has(week)),'ACTUAL_WEEK_COVERAGE');
  function player(raw,{team=null,slotId=null,availability='ROSTERED'}={}){
    check(Number.isInteger(raw.id)&&typeof raw.fullName==='string'&&raw.fullName.length<=150,'PLAYER_CONTRACT');
    const source=lookup.get(raw.id),records=source?.stats??[];
    check(Array.isArray(records),'PLAYER_STATS');
    const baseline=records.filter(s=>s.seasonId===season-1&&s.statSourceId===0&&s.statSplitTypeId===0&&s.scoringPeriodId===0);
    check(baseline.length<=1,'BASELINE_DUPLICATE');
    const actual=records.filter(s=>s.seasonId===season&&s.statSourceId===0&&s.statSplitTypeId===1&&s.scoringPeriodId>=1&&s.scoringPeriodId<=completedThrough);
    check(new Set(actual.map(s=>s.scoringPeriodId)).size===actual.length,'ACTUAL_DUPLICATE');
    const total={};for(const record of actual)for(const key of [210,23,53,24,42,25,43,26,44,72]){
      const value=record.stats?.[key];check(value===undefined||finite(value),'NONFINITE_STAT');total[key]=(total[key]??0)+(value??0);
    }
    const previous=baseline.length?metric(baseline[0].stats):null,current=metric(total);
    const forecast=projectionWeeks.map(week=>{
      const matches=records.filter(s=>s.seasonId===season&&s.statSourceId===1&&s.statSplitTypeId===1&&s.scoringPeriodId===week);
      check(matches.length<=1,'FORECAST_DUPLICATE');
      return{week,points:matches.length?metric(matches[0].stats).ppr:null};
    });
    const forwardTotal=forecast.length&&forecast.every(f=>f.points!==null)?forecast.reduce((sum,f)=>sum+f.points,0):null;
    const reason=!source?'ESPN statistics unavailable':!previous?.games||!previous?.touches?`No comparable ${season-1} baseline`:!current.games||!current.touches?`No completed-${season}-week touches`:null;
    return{id:raw.id,name:raw.fullName,position:position[raw.defaultPositionId],injuryStatus:raw.injuryStatus??source?.injuryStatus??'UNKNOWN',availability,
      previous,current,forecast,forwardTotal,forwardAverage:forwardTotal===null?null:forwardTotal/forecast.length,
      plottable:reason===null,reason,x:reason?null:current.touchesPerGame-previous.touchesPerGame,y:reason?null:current.pprPerTouch-previous.pprPerTouch,
      smallSample:!!previous&&(previous.games<5||current.games<5),teamId:team?.id??null,teamCode:team?.code??'FA',teamName:team?.name??'Available in your league',color:team?.color??'#263742',slotId,
      percentOwned:finite(raw.ownership?.percentOwned)?raw.ownership.percentOwned:null};
  }
  const owned=roster.map(({entry,team})=>player(entry.playerPoolEntry.player,{team,slotId:entry.lineupSlotId}));
  const available=candidates.map(e=>player(e.player,{availability:e.status}));
  const freeAgents=['RB','WR','TE'].flatMap(pos=>available.filter(p=>p.position===pos&&p.forwardTotal!==null&&p.forwardTotal>0)
    .sort((a,b)=>b.forwardTotal-a.forwardTotal||a.name.localeCompare(b.name)).slice(0,5).map((p,i)=>({...p,faRank:i+1})));
  if(projectionWeeks.length)check(['RB','WR','TE'].every(pos=>freeAgents.filter(p=>p.position===pos).length===5),'FORECAST_COVERAGE');
  const centers=rankTeamCenters(teams,owned);
  check(centers.reference.count>0,'COMPARABLE_PLAYERS_EMPTY');
  const data={schemaVersion:1,observedAt,season,completedThrough,projectionWeeks,teams,owned,freeAgents,
    centerOfMass:{reference:centers.reference,teams:centers.teams},
    powerComparison:{observedAt,teams:league.teams.map(t=>({teamId:t.id,projectedRank:safeRank(t.currentProjectedRank,teams.length)}))},
    weekly:{completionVerified:true,currentScoringPeriod:league.scoringPeriodId,officialGamesByWeek:Array.from({length:completedThrough},(_,i)=>({week:i+1,games:completed.weeks.get(i+1).size})),statCoverage,requiredStatPlayers:relevant.length}};
  validatePublicData(data);return data;
}

export function validatePublicData(data){
  const allowed=['schemaVersion','observedAt','season','completedThrough','projectionWeeks','teams','owned','freeAgents','centerOfMass','powerComparison','weekly'];
  check(Object.keys(data).every(key=>allowed.includes(key)),'PUBLIC_FIELDS');
  check(data.completedThrough>=1&&data.completedThrough<=18,'PUBLIC_WEEK');
  function walk(value){
    if(typeof value==='number')check(Number.isFinite(value),'PUBLIC_NUMBER');
    if(value&&typeof value==='object')for(const [key,item]of Object.entries(value)){
      check(!/cookie|credential|espn_s2|swid|members|owners|leagueId|token|password|email|authorization/i.test(key),'PRIVATE_FIELD');walk(item);
    }
  }
  walk(data);
  check(data.owned.every(p=>p.plottable?(finite(p.x)&&finite(p.y)):(p.x===null&&p.y===null)),'PUBLIC_COORDINATES');
  check(new Set([...data.owned,...data.freeAgents].map(p=>p.id)).size===data.owned.length+data.freeAgents.length,'PUBLIC_PLAYER_DUPLICATE');
  const text=JSON.stringify(data);
  check(!/\/Users\/|browser-profile|localhost|127\.0\.0\.1/i.test(text),'PRIVATE_PATH');
  return data;
}
