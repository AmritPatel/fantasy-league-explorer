import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {collectWeeklyData} from './espn-read.mjs';
import {publishWeekly} from './publish-weekly.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const digest=value=>createHash('sha256').update(value).digest('hex');
try{
  const frozen=await fs.readFile(path.join(root,'index.html'));
  const presentation=JSON.parse(await fs.readFile(path.join(root,'tools','presentation.json'),'utf8'));
  const template=await fs.readFile(path.join(root,'tools','chart-template.html'),'utf8');
  const data=await collectWeeklyData({presentation});
  const result=await publishWeekly({root,data,presentation,template});
  if(digest(await fs.readFile(path.join(root,'index.html')))!==digest(frozen))throw new Error('Frozen page changed');
  console.log(JSON.stringify({refresh:'validated',...result}));
}catch(error){
  if(error.code==='WEEK_NOT_READY')console.log(JSON.stringify({refresh:'waiting',changed:false,reason:'No fully official week is available yet.'}));
  else{
    const safeCodes=new Set(['AUTH_MISSING','AUTH_REJECTED','ESPN_NETWORK','ESPN_HTTP','ESPN_NOT_JSON','ESPN_BAD_JSON','SCHEDULE_COVERAGE','SCHEDULE_CONTRACT','SCHEDULE_CONFLICT','STATS_COVERAGE','ROSTER_STATS_COVERAGE','FORECAST_COVERAGE','WEEK_REGRESSION']);
    console.error(JSON.stringify({refresh:'failed',code:safeCodes.has(error.code)?error.code:'VALIDATION_FAILED',message:'The last published version is retained. Check the protected session secrets or the source data contract.'}));
    process.exitCode=1;
  }
}
