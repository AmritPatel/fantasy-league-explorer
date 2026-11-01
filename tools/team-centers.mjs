// Equal-mass centers of the actual plotted roster coordinates. Free agents are
// excluded even if a caller includes them in the input.
export function rankTeamCenters(teams,players){
  const ids=new Set(teams.map(t=>t.id));
  const owned=players.filter(p=>ids.has(p.teamId));
  const plotted=owned.filter(p=>p.plottable);
  if(plotted.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))throw new Error('Plotted players need finite coordinates');
  if(new Set(owned.map(p=>p.id)).size!==owned.length)throw new Error('Rostered players must be unique');
  const mean=(rows,key)=>rows.reduce((sum,p)=>sum+p[key],0)/rows.length;
  const meanX=plotted.length?mean(plotted,'x'):null,meanY=plotted.length?mean(plotted,'y'):null;
  const sdX=plotted.length?Math.sqrt(plotted.reduce((sum,p)=>sum+(p.x-meanX)**2,0)/plotted.length):null;
  const sdY=plotted.length?Math.sqrt(plotted.reduce((sum,p)=>sum+(p.y-meanY)**2,0)/plotted.length):null;
  const rows=teams.map(team=>{
    const roster=owned.filter(p=>p.teamId===team.id),points=roster.filter(p=>p.plottable);
    const centerX=points.length?mean(points,'x'):null,centerY=points.length?mean(points,'y'):null;
    const usageZ=centerX===null?null:sdX>1e-12?(centerX-meanX)/sdX:0;
    const efficiencyZ=centerY===null?null:sdY>1e-12?(centerY-meanY)/sdY:0;
    return{teamId:team.id,teamCode:team.code,teamName:team.name,color:team.color,
      centerX,centerY,usageZ,efficiencyZ,score:points.length?.5*(usageZ+efficiencyZ):null,
      plotted:points.length,total:roster.length,coverage:roster.length?points.length/roster.length:null,
      excluded:roster.filter(p=>!p.plottable).map(p=>({id:p.id,name:p.name,reason:p.reason})),
      smallSamples:points.filter(p=>p.smallSample).length,memberIds:points.map(p=>p.id),
      rank:null,usageRank:null,efficiencyRank:null,aboveTeamId:null,aboveTeamName:null,aboveTeamCode:null,aboveRank:null,distanceAbove:null,scoreGapAbove:null};
  });
  const ranked=rows.filter(r=>r.score!==null);
  const rankBy=(key,rankKey)=>{
    const sorted=[...ranked].sort((a,b)=>b[key]-a[key]||a.teamName.localeCompare(b.teamName));
    sorted.forEach((row,i)=>row[rankKey]=i&&Math.abs(row[key]-sorted[i-1][key])<1e-12?sorted[i-1][rankKey]:i+1);
    return sorted;
  };
  rankBy('centerX','usageRank');rankBy('centerY','efficiencyRank');
  const ordered=rankBy('score','rank');
  ordered.forEach((row,i)=>{
    const above=ordered.slice(0,i).reverse().find(other=>other.rank<row.rank);
    if(!above)return;
    row.aboveTeamId=above.teamId;row.aboveTeamName=above.teamName;row.aboveTeamCode=above.teamCode;row.aboveRank=above.rank;
    const dx=sdX>1e-12?(row.centerX-above.centerX)/sdX:0;
    const dy=sdY>1e-12?(row.centerY-above.centerY)/sdY:0;
    row.distanceAbove=Math.hypot(dx,dy);
    row.scoreGapAbove=Math.max(0,above.score-row.score);
  });
  return{
    method:'Equal player mass; mean X and mean Y over comparable rostered RB/WR/TE, including bench and IR. Rank by 0.5 × [(centerX − league-player mean X) / league-player SD X + (centerY − league-player mean Y) / league-player SD Y]. Population SDs; a constant axis contributes zero. Ties share a rank.',
    interpretation:'Historical usage/efficiency improvement relative to the league’s plotted players, not current team strength, projected wins or a forecast.',
    mass:'One unit per plotted player',axisWeights:{usage:.5,efficiency:.5},
    distanceMethod:'Distance to the preceding strictly higher-ranked team = sqrt[((centerX − aboveCenterX) / league-player SD X)^2 + ((centerY − aboveCenterY) / league-player SD Y)^2]. Constant axes contribute zero. Score gap = aboveScore − teamScore. Geometric separation is not the amount needed to overtake; these are descriptive distances, not statistical significance or confidence measures. Co-leaders have no higher-ranked team.',
    reference:{count:plotted.length,meanX,meanY,sdX,sdY},
    teams:[...ordered,...rows.filter(r=>r.score===null)],
  };
}
