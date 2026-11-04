import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {checkRoutes,chartData} from './check-site.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
test('build deploys the latest explorer at home and weekly, and preserves the frozen snapshot and archives',async()=>{
  await promisify(execFile)(process.execPath,['tools/build-site.mjs'],{cwd:root});
  const basePath=JSON.parse(await fs.readFile(path.join(root,'tools','presentation.json'),'utf8')).basePath;
  const expectedLatest=JSON.parse(await fs.readFile(path.join(root,'weekly','data','latest.json'),'utf8'));
  const expectedFrozen=(await fs.readFile(path.join(root,'tools','frozen.sha256'),'utf8')).trim();
  const manifest=JSON.parse(await fs.readFile(path.join(root,'weekly','manifest.json'),'utf8'));
  const read=relative=>fs.readFile(path.join(root,'_site',relative),'utf8');
  const result=await checkRoutes({read,basePath,expectedLatest,expectedFrozen,manifest});assert.equal(result.passed,true);
  const home=await read('index.html');assert.ok(home.includes(`<option value="${basePath}" selected>Latest weekly view`));
  for(const entry of manifest.entries){
    const original=await fs.readFile(path.join(root,entry.href),'utf8');
    assert.deepEqual(chartData(await read(entry.href)),chartData(original),'Only archive navigation may change, not its chart data');
  }
  await assert.rejects(()=>checkRoutes({read:relative=>relative==='index.html'?read('snapshot/index.html'):read(relative),basePath,expectedLatest,expectedFrozen,manifest}),/same latest view/);
});
