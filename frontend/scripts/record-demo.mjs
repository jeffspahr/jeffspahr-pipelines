import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
assert.equal(process.env.GITHUB_ACTIONS,'true','Record only in hosted CI');
const out=resolve(process.env.KFP_DEMO_OUTPUT); await mkdir(out,{recursive:true});
const sources={legacy:process.env.LEGACY_SHA,modern:process.env.MODERN_SHA};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const children=[];
for(const [i,side] of ['legacy','modern'].entries()){
 children.push(spawn(process.execPath,['--import','tsx','scripts/demo-server.ts'],{env:{...process.env,KFP_BROWSER_BUILD_DIR:process.env[`KFP_DEMO_${side.toUpperCase()}_BUILD`],KFP_BROWSER_FLOOR_PORT:String(4174+i)},stdio:'inherit'}));
 for(let n=0;;n++){try{if((await fetch(`http://127.0.0.1:${4174+i}/__qualification`)).ok)break;}catch{}if(n>60)throw Error(`${side} server failed`);await sleep(1000);}
}
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#101b2b;color:white;font:24px Arial}header{height:90px;padding:14px 28px}h1{font-size:28px;margin:0 0 7px}#chapter{color:#adc7e4;font-size:23px}.labels{height:45px;display:flex;background:#1c2c41}.labels div{width:50%;padding:8px 24px;font-weight:bold}.labels small{font-size:17px;font-weight:normal;color:#bbc9d8}main{display:flex}iframe{width:1280px;height:720px;border:0;background:white}footer{height:45px;padding:11px 28px;font-size:18px;color:#b9cadc}</style></head><body><header><h1>Kubeflow Pipelines · UI modernization</h1><div id="chapter">Loading</div></header><div class="labels"><div>LEGACY <small>${sources.legacy.slice(0,8)} · master</small></div><div>MODERN <small>${sources.modern.slice(0,8)} · PR #14584</small></div></div><main><iframe name="legacy"></iframe><iframe name="modern"></iframe></main><footer>Same sample data · actual browser recording · edited highlights · not a speed benchmark</footer></body></html>`)});await new Promise(r=>server.listen(4176,'127.0.0.1',r));
const run='/runs/details/sample-run-training-failed';const task=run+'?task=sample-run-training-failed-train-model';
const form='/runs/new?pipelineId=sample-taxi-pipeline&pipelineVersionId=sample-taxi-v1.1&experimentId=275ea11d-ac63-4ce3-bc33-ec81981ed56b&recurring=1';
const routes={pipelines:['/pipelines','Pipelines · a consistent, compact starting point'],experiments:['/experiments','Experiments · lightweight run previews'],runs:['/runs','Runs · status, versions and timing'],filter:['/runs','Search, sort and column filters'],graph:[run,'Graph · readable initial scale'],task:[run,'Task inspection · graph adapts to the panel'],timeline:[run+'?tab=timeline','Timeline · task timing and state'],logs:[task,'Logs · driver and task output together'],recurring:['/recurringruns','Recurring runs · readable schedules'],schedule:[form,'Create recurring run · clearer schedule choices'],dark:[task,'Dark appearance · the same workflow'],closing:[task,'A shared foundation for future development']};
let browser,page;const clips=[],errors=[];
try{
 browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:2560,height:900},recordVideo:{dir:out,size:{width:2560,height:900}},locale:'en-US',timezoneId:'UTC',colorScheme:'light'});
 const clock=performance.now();page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(String(e)));await page.goto('http://127.0.0.1:4176');const frames=['legacy','modern'].map(name=>page.frame({name}));
 const scenes=JSON.parse(await readFile('scripts/demo-scenes.json','utf8'));
 for(const scene of scenes){
  const [path,title]=routes[scene.name]; console.log(`SCENE ${scene.name}`);await page.locator('#chapter').evaluate((el,t)=>el.textContent=t,title);
  await Promise.all(frames.map((f,i)=>f.goto(`http://127.0.0.1:${4174+i}/?demo=${scene.name}#${path}`)));
  for(const f of frames){await f.waitForFunction(()=>document.body.innerText.length>150);await f.evaluate(()=>document.fonts.ready);}
  await sleep(2200);
  if(['graph','task','logs','dark','closing'].includes(scene.name))await frames[1].locator('.react-flow__node').first().waitFor();
  if(scene.name==='timeline')await Promise.all(frames.map(f=>f.getByRole('table',{name:'Component timeline timings'}).waitFor()));
  if(scene.name==='logs')await Promise.all(frames.map(f=>f.getByRole('tab',{name:'Logs',exact:true}).or(f.getByRole('button',{name:'Logs',exact:true})).click()));
  if(scene.name==='schedule'){
   await frames[1].getByRole('combobox',{name:'Repeat',exact:true}).waitFor();
   await Promise.all(frames.map(f=>f.locator('input,select').last().scrollIntoViewIfNeeded()));
   await frames[1].getByRole('combobox',{name:'Repeat',exact:true}).scrollIntoViewIfNeeded();
  }
  if(scene.name==='closing')await frames[1].getByRole('switch',{name:'Dark mode',exact:true}).check();
  await sleep(600);const start=(performance.now()-clock)/1000;clips.push({...scene,start:start+.15,title,path});
  await page.screenshot({path:resolve(out,scene.name+'.png')});
  if(scene.name==='pipelines'){await sleep(2000);await frames[1].getByRole('button',{name:/Expand pipeline Python two steps/}).click();}
  if(scene.name==='experiments'){await sleep(1500);await frames[1].getByRole('button',{name:/Expand experiment Default/}).click();}
  if(scene.name==='filter'){
   await sleep(1000);await frames[1].getByRole('button',{name:'Filter status',exact:true}).click();await sleep(2200);await frames[1].getByRole('menuitemradio',{name:'Failed',exact:true}).click();
  }
  if(scene.name==='task'){await sleep(1800);await frames[1].locator('.react-flow__node').filter({hasText:'Train fare model'}).click();await frames[0].locator('.react-flow__node').filter({hasText:'Train fare model'}).click();}
  if(scene.name==='timeline'){await sleep(2500);for(const f of frames){const b=f.locator('.rt-task-label > button');if(await b.count())await b.nth(1).click();}}
  if(scene.name==='logs'){await sleep(2000);await frames[1].getByRole('button',{name:'Driver logs',exact:true}).click();await sleep(1800);await frames[1].getByRole('button',{name:'Task logs',exact:true}).click();await sleep(1200);await frames[1].getByRole('button',{name:'Task logs',exact:true}).click();}
  if(scene.name==='schedule'){await sleep(2000);await frames[1].getByRole('combobox',{name:'Repeat',exact:true}).selectOption('weekly');}
  if(scene.name==='dark'){await sleep(1800);await frames[1].getByRole('switch',{name:'Dark mode',exact:true}).check();}
  await sleep(1300);await page.screenshot({path:resolve(out,scene.name+'-after.png')});
  await sleep(Math.max(0,(start+scene.duration+1-(performance.now()-clock)/1000)*1000));
 }
 await writeFile(resolve(out,'clips.json'),JSON.stringify({sources,clips,errors,viewportPerSide:{width:1280,height:720}},null,2));
 const video=page.video();await context.close();execFileSync('ffmpeg',['-y','-i',await video.path(),'-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart',resolve(out,'recording.mp4')],{stdio:'inherit'});
}catch(e){await page?.screenshot({path:resolve(out,'failure.png')}).catch(()=>{});await writeFile(resolve(out,'failure.txt'),e.stack);await writeFile(resolve(out,'failure-dom.json'),JSON.stringify(await Promise.all((page?.frames()||[]).map(async f=>({url:f.url(),text:await f.locator('body').innerText().catch(()=> '')}))),null,2));throw e}
finally{await browser?.close();server.close();for(const c of children)c.kill('SIGTERM');}
