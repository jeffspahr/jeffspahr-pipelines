import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Recording runs in hosted CI only');
const out=resolve(process.env.KFP_DEMO_OUTPUT);
await mkdir(out,{recursive:true});
const sources={legacy:'02cbc725ac9ddcd950f4400d8355dd78bfcd6c57',modern:'56e1fe3e69e8271c65917869546e51c9e18bc416'};
const children=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
for (const [i,side] of ['legacy','modern'].entries()) {
 const child=spawn(process.execPath,['--import','tsx','scripts/ui-modernization-native-server.ts'],{env:{...process.env,CI:'true',KFP_BROWSER_BUILD_DIR:process.env[`KFP_DEMO_${side.toUpperCase()}_BUILD`],KFP_BROWSER_FLOOR_PORT:String(4174+i)},stdio:'inherit'}); children.push(child);
 for(let n=0;;n++){try{if((await fetch(`http://127.0.0.1:${4174+i}/__qualification`)).ok)break;}catch{} if(n>90)throw Error(`Server ${side} failed`); await sleep(1000);}
}
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#101b2b;color:#fff;font:24px Arial}header{height:90px;padding:14px 28px}h1{font-size:28px;margin:0 0 7px}#chapter{color:#adc7e4;font-size:23px}.labels{height:45px;display:flex;background:#1c2c41}.labels div{width:50%;padding:8px 24px;font-weight:bold}.labels small{font-size:17px;font-weight:normal;color:#bbc9d8}main{display:flex}iframe{width:1280px;height:720px;border:0;background:white}footer{height:45px;padding:11px 28px;font-size:18px;color:#b9cadc}</style></head><body><header><h1>Kubeflow Pipelines · UI modernization</h1><div id="chapter">Loading the walkthrough</div></header><div class="labels"><div>LEGACY <small>02cbc725 · before modernization</small></div><div>MODERN <small>56e1fe3e · PR #14584</small></div></div><main><iframe name="legacy" src="http://127.0.0.1:4174/#/pipelines"></iframe><iframe name="modern" src="http://127.0.0.1:4175/#/pipelines"></iframe></main><footer>Same fixture data · synchronized navigation · light theme · actual browser recording · not a speed benchmark</footer></body></html>`)});
await new Promise(r=>server.listen(4176,'127.0.0.1',r));
let browser, page;const chapters=[];const errors=[];
try{
 browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width:2560,height:900},recordVideo:{dir:out,size:{width:2560,height:900}},locale:'en-US',timezoneId:'UTC',colorScheme:'light'});
 await context.addInitScript(()=>{const NativeDate=Date;globalThis.Date=class extends NativeDate{constructor(...a){super(...(a.length?a:['2026-09-26T12:00:00.000Z']))}static now(){return new NativeDate('2026-09-26T12:00:00.000Z').getTime()}}});
 page=await context.newPage();page.setDefaultTimeout(20000);
 page.on('pageerror',e=>errors.push(String(e)));
 await page.goto('http://127.0.0.1:4176');
 await Promise.all(['legacy','modern'].map(async side=>{while(!page.frame({name:side}))await sleep(100)}));
 const frames=['legacy','modern'].map(name=>page.frame({name}));
 const start=Date.now();
 async function title(text){console.log(text);chapters.push({title:text,seconds:(Date.now()-start)/1000});await page.locator('#chapter').evaluate((el,t)=>el.textContent=t,text)}
 async function shot(name){await page.screenshot({path:resolve(out,`${String(chapters.length).padStart(2,'0')}-${name}.png`)});}
 const routes=JSON.parse(await readFile('scripts/demo-routes.json','utf8'));
 const order=['pipelines','pipeline-details','pipeline-loops','experiments','experiment-details','experiment-empty','runs','run-details','run-task','compare','recurring-runs','recurring-run-details','artifacts','artifact-details','artifact-related-tasks','artifact-lineage','new-experiment','upload-pipeline','new-run','new-run-configured','new-recurring-run','archived-runs-empty','archived-experiments','frontend-features','getting-started'];
 for(const name of order){
  const route=routes.find(r=>r.name===name);await title(name.replaceAll('-',' ').replace(/^./,s=>s.toUpperCase()));
  await Promise.all(frames.map((frame,i)=>frame.goto(`http://127.0.0.1:${4174+i}/?demo=${name}#${route.path}`)));
  await Promise.all(frames.map(async frame=>{
   await frame.waitForFunction(()=>document.body.innerText.length>150);
   if(route.waitForSelector)await frame.locator(route.waitForSelector).first().waitFor({state:'attached'});
   await frame.evaluate(()=>document.fonts.ready);
   if(route.fitGraph){const fit=frame.locator('.react-flow__controls-fitview');if(await fit.count())await fit.first().click();}
   for(const field of route.fillFields||[])await frame.getByRole('textbox',{name:field.label,exact:true}).fill(field.value);
  }));
  await sleep(1800);await shot(name);await sleep(4200);
  if(name==='pipelines'){
   await title('Compact sidebar footer · appearance menu');
   const theme=frames[1].getByRole('button',{name:/^Theme: /});await theme.focus();await page.keyboard.press('Enter');
   await frames[1].getByRole('menu',{name:'Appearance'}).waitFor();await sleep(1500);await shot('compact-footer-theme-menu');await sleep(4000);
   await page.keyboard.press('Escape');await frames[1].getByRole('menu').waitFor({state:'hidden'});assert.equal(await theme.evaluate(el=>document.activeElement===el),true);
   await title('Compact sidebar footer · named utility links');await frames[1].getByRole('link',{name:'Documentation',exact:true}).hover();await frames[1].getByRole('tooltip').waitFor();await shot('compact-footer-tooltip');await sleep(3500);await page.mouse.move(1500,200);
  }
  if(name==='pipeline-details'){
   await title('Pipeline specification · read-only YAML editor');
   await Promise.all(frames.map((f,i)=>f.getByRole(i===0?'button':'tab',{name:'Pipeline Spec',exact:true}).click()));
   await Promise.all(frames.map(f=>f.locator('[data-testid="spec-ir"] .ace_editor').waitFor()));await Promise.all(frames.map(f=>f.waitForFunction(()=>document.querySelector('[data-testid="spec-ir"] .ace_editor')?.env?.editor?.getValue()?.length>100)));await sleep(2500);await shot('pipeline-editor');await sleep(4500);
  }
  if(name==='runs'){
   await title('Runs · filter by name');
   await Promise.all(frames.map(f=>f.locator('input[placeholder="Filter runs by name"], input#tableFilterBox').first().pressSequentially('xgboost',{delay:160})));
   await sleep(2500);await shot('runs-filter');await sleep(4000);
   await Promise.all(frames.map(f=>f.locator('input[placeholder="Filter runs by name"], input#tableFilterBox').first().fill('')));await sleep(1000);
  }
  if(['new-run-configured','new-recurring-run','artifact-details','recurring-run-details','getting-started'].includes(name)){
   await title(name.replaceAll('-',' ')+' · more details');
   await Promise.all(frames.map(f=>f.evaluate(()=>{for(const e of [document.scrollingElement,...document.querySelectorAll('main,section,div')]){if(e && e.scrollHeight>e.clientHeight+150 && e.clientHeight>180 && ['auto','scroll'].includes(getComputedStyle(e).overflowY))e.scrollTo({top:e.scrollHeight,behavior:'smooth'});}})));await sleep(2000);await shot(name+'-details');await sleep(4000);
  }
  if(name==='new-experiment'){
   await title('Create experiment · name and description');
   await Promise.all(frames.map(f=>f.locator('#experimentName').fill('Customer churn experiment')));await Promise.all(frames.map(f=>f.locator('#experimentDescription').fill('Compare training pipelines with the same reproducible inputs.')));await sleep(1200);await shot('experiment-form');await sleep(3500);
  }
 }
 await title('Modern shell · dark theme (legacy remains unchanged)');
 await Promise.all(frames.map((f,i)=>f.goto(`http://127.0.0.1:${4174+i}/?demo=shell#/runs`)));
 await Promise.all(frames.map(f=>f.locator('[data-run-id="e0115ac1-0479-4194-a22d-01e65e09a32b"]').waitFor()));
 await frames[1].getByRole('button',{name:/^Theme: /}).click();await frames[1].getByRole('menuitemradio',{name:'Dark',exact:true}).click();await sleep(1800);await shot('modern-dark');await sleep(4500);
 await title('Modern shell · quick navigation');await frames[1].getByRole('button',{name:/^Theme: /}).click();await frames[1].getByRole('menuitemradio',{name:'Light',exact:true}).click();
 await frames[1].getByRole('button',{name:'Search',exact:true}).click();await sleep(1500);await shot('modern-search');await sleep(4500);await page.keyboard.press('Escape');
 await title('Modern shell · compact navigation');await frames[1].getByRole('button',{name:'Collapse navigation',exact:true}).click();await sleep(1500);await shot('modern-compact');await sleep(4500);
 await title('End of walkthrough · 25 pages and key interactions');await sleep(4000);
 await writeFile(resolve(out,'chapters.json'),JSON.stringify({sources,chapters,errors,viewportPerSide:{width:1280,height:720},fixture:'modern native fixed mock API for both builds',fixedTime:'2026-09-26T12:00:00.000Z'},null,2));
 const video=page.video();await context.close();const raw=await video.path();
 execFileSync('ffmpeg',['-y','-i',raw,'-c:v','libx264','-preset','fast','-crf','24','-pix_fmt','yuv420p','-movflags','+faststart',resolve(out,'kfp-legacy-modern-demo.mp4')],{stdio:'inherit'});
 execFileSync('ffprobe',['-v','error','-show_format','-show_streams','-of','json',resolve(out,'kfp-legacy-modern-demo.mp4')],{stdio:['ignore',await import('node:fs').then(m=>m.openSync(resolve(out,'video-metadata.json'),'w')),'inherit']});
}catch(e){await page?.screenshot({path:resolve(out,'failure.png')}).catch(()=>{});await writeFile(resolve(out,'failure-dom.json'),JSON.stringify(await Promise.all((page?.frames()||[]).map(async f=>({url:f.url(),text:await f.locator('body').innerText().catch(()=> '')}))),null,2));await writeFile(resolve(out,'failure.txt'),e.stack);throw e}finally{await browser?.close();server.close();for(const child of children)child.kill('SIGTERM')}
