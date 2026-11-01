import {DataCheckError,buildWeeklyData} from './weekly-model.mjs';

export async function collectWeeklyData({presentation,env=process.env,fetchImpl=fetch,observedAt=new Date().toISOString()}){
  const {ESPN_SESSION_S2:s2,ESPN_SESSION_SWID:swid,ESPN_LEAGUE_ID:leagueId}=env;
  if(!s2||!swid||!/^\d+$/.test(leagueId??''))throw new DataCheckError('AUTH_MISSING');
  const base=`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${presentation.season}`;
  async function read(url,{filter,authenticated=false}={}){
    let response;
    try{response=await fetchImpl(url,{method:'GET',redirect:'manual',headers:{accept:'application/json',
      ...(authenticated?{cookie:`espn_s2=${s2}; SWID=${swid}`} : {}),
      ...(filter?{'x-fantasy-filter':JSON.stringify(filter)}:{})},signal:AbortSignal.timeout(45000)});}
    catch{throw new DataCheckError('ESPN_NETWORK');}
    if(response.status===401||response.status===403)throw new DataCheckError('AUTH_REJECTED');
    if(!response.ok)throw new DataCheckError('ESPN_HTTP');
    if(!(response.headers.get('content-type')??'').includes('application/json'))throw new DataCheckError('ESPN_NOT_JSON');
    try{return await response.json();}catch{throw new DataCheckError('ESPN_BAD_JSON');}
  }
  const [league,pool,statistics,schedule]=await Promise.all([
    read(`${base}/segments/0/leagues/${leagueId}?view=mSettings&view=mTeam&view=mRoster`,{authenticated:true}),
    read(`${base}/segments/0/leagues/${leagueId}?view=kona_player_info`,{authenticated:true,filter:{players:{filterStatus:{value:['FREEAGENT','WAIVERS']},limit:20000,sortDraftRanks:{sortPriority:1,sortAsc:true,value:'PPR'}}}}),
    read(`${base}/players?scoringPeriodId=0&view=kona_player_info`,{filter:{players:{limit:20000,filterStatsForSourceIds:{value:[0,1]},filterStatsForSplitTypeIds:{value:[0,1]}}}}),
    read(`${base}?view=proTeamSchedules_wl`),
  ]);
  const data=buildWeeklyData({league,pool,statistics,schedule,presentation,observedAt,expectedLeagueId:leagueId});
  const text=JSON.stringify(data);
  if([s2,swid,leagueId].some(value=>text.includes(value)))throw new DataCheckError('SECRET_IN_OUTPUT');
  return data;
}
