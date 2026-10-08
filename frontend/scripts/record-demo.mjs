import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Recording runs in hosted CI only');
const out=resolve(process.env.KFP_DEMO_OUTPUT);await mkdir(out,{recursive:true});
const sources={legacy:process.env.LEGACY_SHA,modern:process.env.MODERN_SHA};
const children=[];const sleep=ms=>new Promise(r=>setTimeout(r,ms));
for (const [i,side] of ['legacy','modern'].entries()) {
 const child=spawn(process.execPath,['--import','tsx','scripts/ui-modernization-native-server.ts'],{env:{...process.env,CI:'true',KFP_BROWSER_BUILD_DIR:process.env[`KFP_DEMO_${side.toUpperCase()}_BUILD`],KFP_BROWSER_FLOOR_PORT:String(4174+i)},stdio:'inherit'});children.push(child);
 for(let n=0;;n++){try{if((await fetch(`http://127.0.0.1:${4174+i}/__qualification`)).ok)break;}catch{}if(n>90)throw Error(`Server ${side} failed`);await sleep(1000);}
}
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#101b2b;color:white;font:24px Arial}header{height:90px;padding:14px 28px}h1{font-size:28px;margin:0 0 7px}#chapter{color:#adc7e4;font-size:23px}.labels{height:45px;display:flex;background:#1c2c41}.labels div{width:50%;padding:8px 24px;font-weight:bold}.labels small{font-size:17px;font-weight:normal;color:#bbc9d8}main{display:flex}iframe{width:1280px;height:720px;border:0;background:white}footer{height:45px;padding:11px 28px;font-size:18px;color:#b9cadc}</style></head><body><header><h1>Kubeflow Pipelines · UI modernization</h1><div id="chapter">Loading</div></header><div class="labels"><div>LEGACY <small>${sources.legacy.slice(0,8)} · current master</small></div><div>MODERN <small>${sources.modern.slice(0,8)} · PR #14584</small></div></div><main><iframe name="legacy"></iframe><iframe name="modern"></iframe></main><footer>Same fixture data · actual browser recording · edited highlights · not a speed benchmark</footer></body></html>`)});await new Promise(r=>server.listen(4176,'127.0.0.1',r));
const run='/runs/details/e0115ac1-0479-4194-a22d-01e65e09a32b';
const pipe='/pipelines/details/8fbe3bd6-a01f-11e8-98d0-529269fb1460/version/8fbe3bd6-a01f-11e8-98d0-529269fb1460';
const form='/runs/new?pipelineId=8fbe3bd6-a01f-11e8-98d0-529269fb1460&pipelineVersionId=8fbe3bd6-a01f-11e8-98d0-529269fb1460&experimentId=275ea11d-ac63-4ce3-bc33-ec81981ed56b';
const routes={pipelines:['/pipelines','Pipelines'],footer:['/pipelines','Compact sidebar · appearance controls'],'pipeline-details':[pipe,'Pipeline graph'],'pipeline-spec':[pipe,'Pipeline specification'],runs:['/runs','Run list'],filter:['/runs','Filter runs'],timeline:[run+'?tab=timeline','Run Timeline · task duration, retries and cache hits'],task:[run+'?task=mock-task-consumer','Inspect task details'],lineage:['/artifacts/mock-artifact-1/explorer','Artifact lineage'],'new-run':[form,'Create a run'],recurring:[form+'&recurring=1','Schedule recurring runs'],transfer:['/export-import','Export and import pipeline metadata'],'dark-timeline':[run+'?tab=timeline','Timeline · modern dark theme (legacy remains light)'],search:['/runs','Quick navigation']};
let browser,page;const clips=[],errors=[];
try{
 browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:2560,height:900},recordVideo:{dir:out,size:{width:2560,height:900}},locale:'en-US',timezoneId:'UTC',colorScheme:'light'});
 await context.addInitScript(()=>{const D=Date;globalThis.Date=class extends D{constructor(...a){super(...(a.length?a:['2026-09-26T12:00:00.000Z']))}static now(){return new D('2026-09-26T12:00:00.000Z').getTime()}}});
 const clock=performance.now();page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(String(e)));await page.goto('http://127.0.0.1:4176');const frames=['legacy','modern'].map(name=>page.frame({name}));
 const scenes=JSON.parse(await readFile('scripts/demo-scenes.json','utf8'));
 for(const scene of scenes.filter(s=>s.name!=='closing')){
  const [path,title]=routes[scene.name];console.log(title);await page.locator('#chapter').evaluate((el,t)=>el.textContent=t,title);
  await Promise.all(frames.map((f,i)=>f.goto(`http://127.0.0.1:${4174+i}/?demo=${scene.name}#${path}`)));
  for(const f of frames){
   await f.waitForFunction(()=>document.body.innerText.length>150);await f.evaluate(()=>document.fonts.ready);
   if(['pipelines','footer'].includes(scene.name))await f.locator(`a[href="#/pipelines/details/8fbe3bd6-a01f-11e8-98d0-529269fb1460"]`).first().waitFor();
   if(['runs','filter','search'].includes(scene.name))await f.locator('[data-run-id="e0115ac1-0479-4194-a22d-01e65e09a32b"]').waitFor();
   if(['timeline','dark-timeline'].includes(scene.name))await f.getByRole('table',{name:'Component timeline timings'}).waitFor();
   if(scene.name==='task')await f.getByText('Task Details',{exact:true}).first().waitFor();
   if(scene.name==='lineage')await f.locator('section[aria-label="Producer Chicago taxi trips dataset"]').waitFor();
   if(['new-run','recurring'].includes(scene.name))await f.locator('#startNewRunBtn').waitFor();
   if(scene.name==='transfer')await f.getByRole('button',{name:'Download archive',exact:true}).waitFor();
   if(scene.name==='pipeline-details')await f.locator('.react-flow__node').first().waitFor();
   if(scene.name==='pipeline-spec'){
    await f.getByRole('button',{name:'Pipeline Spec',exact:true}).or(f.getByRole('tab',{name:'Pipeline Spec',exact:true})).click();
    await f.locator('[data-testid="spec-ir"] .ace_editor').waitFor();
   }
  }
  if(scene.name==='footer'){await frames[1].getByRole('button',{name:/^Theme: /}).click();await frames[1].getByRole('menu',{name:'Appearance'}).waitFor();}
  if(scene.name==='dark-timeline'){await frames[1].getByRole('button',{name:/^Theme: /}).click();await frames[1].getByRole('menuitemradio',{name:'Dark',exact:true}).click();}
  if(scene.name==='search'){
   await frames[1].getByRole('button',{name:/^Theme: /}).click();await frames[1].getByRole('menuitemradio',{name:'Light',exact:true}).click();
   await frames[1].getByRole('button',{name:'Search',exact:true}).click();
  }
  await sleep(1500);const start=(performance.now()-clock)/1000;clips.push({...scene,start:start+.3,title,path});
  await page.screenshot({path:resolve(out,scene.name+'.png')});
  if(scene.name==='filter'){await Promise.all(frames.map(f=>f.locator('input[placeholder="Filter runs by name"], input#tableFilterBox').first().pressSequentially('xgboost',{delay:130})));}
  if(scene.name==='timeline'){
   await sleep(3500);await Promise.all(frames.map(f=>f.locator('.rt-task-label > button').nth(1).click()));await sleep(500);await Promise.all(frames.map(f=>f.getByRole('complementary',{name:'Selected task'}).evaluate(el=>el.scrollTo({top:el.scrollHeight,behavior:'smooth'}))));await sleep(3500);
   await page.screenshot({path:resolve(out,'timeline-task.png')});
   const buttons=frames[1].locator('.rt-task-label > button');if(await buttons.count()>2){await Promise.all(frames.map(f=>f.locator('.rt-task-label > button').nth(2).click()));await sleep(500);await Promise.all(frames.map(f=>f.getByRole('complementary',{name:'Selected task'}).evaluate(el=>el.scrollTo({top:el.scrollHeight,behavior:'smooth'}))));await sleep(2000);await page.screenshot({path:resolve(out,'timeline-cached.png')});}
   await sleep(1500);await Promise.all(frames.map(f=>f.getByRole('button',{name:'Open task in graph',exact:true}).click()));await Promise.all(frames.map(f=>f.locator('[data-testid="DagCanvas"] .react-flow__node').first().waitFor()));
  }
  await sleep(Math.max(0,(start+scene.duration+1-(performance.now()-clock)/1000)*1000));
  if(scene.name==='footer')await page.keyboard.press('Escape');
 }
 assert.deepEqual(errors, [], 'Recorded pages must not have uncaught browser errors');
 await writeFile(resolve(out,'clips.json'),JSON.stringify({sources,clips,errors,viewportPerSide:{width:1280,height:720}},null,2));
 const video=page.video();await context.close();const raw=await video.path();execFileSync('ffmpeg',['-y','-i',raw,'-c:v','libx264','-preset','fast','-crf','22','-pix_fmt','yuv420p','-movflags','+faststart',resolve(out,'recording.mp4')],{stdio:'inherit'});
}catch(e){await page?.screenshot({path:resolve(out,'failure.png')}).catch(()=>{});await writeFile(resolve(out,'failure.txt'),e.stack);await writeFile(resolve(out,'failure-dom.json'),JSON.stringify(await Promise.all((page?.frames()||[]).map(async f=>({url:f.url(),text:await f.locator('body').innerText().catch(()=> '')}))),null,2));throw e}
finally{await browser?.close();server.close();for(const c of children)c.kill('SIGTERM');}
