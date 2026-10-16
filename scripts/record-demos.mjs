import {chromium} from 'playwright-core';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

const base=process.env.DEMO_URL||'http://127.0.0.1:5187';
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Record a local sanitized demo only.');
const output='output/demo-recordings',destination='docs/demos';
await mkdir(output,{recursive:true});await mkdir(destination,{recursive:true});
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true});
const reports=[],errors=[];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const primary=(page,label)=>page.getByRole('navigation',{name:'访客统计导航'}).getByRole('button',{name:label,exact:true});
const secondary=(page,label)=>page.getByRole('navigation',{name:'流量分析子页面'}).getByRole('button',{name:label,exact:true});
const clips=[
 ['dashboard','仪表盘',null,async page=>{
   await delay(2400);
   await page.locator('.visitor-scroll-content').evaluate(node=>node.scrollTo({top:260,behavior:'smooth'}));
   await delay(2000);
   await page.locator('.visitor-scroll-content').evaluate(node=>node.scrollTo({top:0,behavior:'smooth'}));
   await delay(2300);
 }],
 ['monitor','访客监测',null,async page=>{
   await delay(1500);
   await page.getByRole('button',{name:'按终端设备',exact:true}).click();
   await page.mouse.move(5,5);await delay(2400);
   await page.getByRole('button',{name:'按浏览器',exact:true}).click();
   await page.mouse.move(5,5);await delay(2600);
 }],
 ['regions','流量分析','地区详情',async page=>{
   await page.locator('.vi-region-globe-stage canvas').waitFor();
   await delay(1800);
   const box=await page.locator('.vi-region-globe-stage canvas').boundingBox();
   await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.mouse.down();
   for(let step=1;step<=38;step++){await page.mouse.move(box.x+box.width*(.5+step/180),box.y+box.height*(.5-step/380));await delay(16);}
   await page.mouse.up();await page.mouse.move(5,5);await delay(1400);
   await page.locator('.vi-region-data .vrt-scroll').evaluate(node=>node.scrollTo({top:180,behavior:'smooth'}));
   await delay(2600);
 }],
 ['flows','流量分析','规则链路',async page=>{
   await delay(2200);
   const nodes=page.locator('.vfg-node');await nodes.nth(1).hover();await delay(1100);
   await nodes.nth(1).click();await page.mouse.move(5,5);await delay(1600);
   await page.getByRole('button',{name:'清除节点选择',exact:true}).click();
   await page.mouse.move(5,5);await delay(1800);
 }],
 ['associations','流量分析','域名 / IP 关联',async page=>{
   await delay(1400);
   await page.locator('.vi-association-panel .vrt-scroll').evaluate(node=>node.scrollTo({top:220,behavior:'smooth'}));
   await delay(2000);
   await page.locator('.vi-association-panel').getByRole('button',{name:'下一页',exact:true}).click();
   await page.mouse.move(5,5);await delay(2800);
 }],
 ['domains','流量分析','热门域名',async page=>{
   await delay(1400);await page.locator('.vi-rank-row').first().hover();await delay(1700);
   await page.getByRole('button',{name:'来源域名',exact:true}).click();await page.mouse.move(5,5);await delay(1700);
   await page.locator('.vi-rank-row').nth(1).hover();await delay(1800);
 }],
];
try{
 for(const [name,view,subview,actions] of clips){
   const context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1});
   const page=await context.newPage();page.on('pageerror',error=>errors.push({name,message:error.message}));
   await page.goto(base);await page.locator('.visitor-sessions').waitFor();
   await page.waitForFunction(()=>document.querySelector('.visitor-command-actions')?.textContent.includes('738'));
   if(view!=='仪表盘')await primary(page,view).click();
   if(subview)await secondary(page,subview).click();
   await page.mouse.move(5,5);await delay(500);
   const frames=path.join(output,`frames-${name}`);await mkdir(frames,{recursive:true});
   const samples=[];let capturing=true;const start=Date.now();
   const capture=(async()=>{while(capturing){const tick=Date.now(),file=`frame-${String(samples.length).padStart(4,'0')}.png`;await page.screenshot({path:path.join(frames,file)});samples.push({file,time:Date.now()});await delay(Math.max(0,100-(Date.now()-tick)));}})();
   // Record actual browser pixels; no DOM values, clocks or animation rates are changed.
   try{await actions(page);}finally{capturing=false;await capture;}
   const end=Date.now();await page.screenshot({path:`${output}/${name}.png`});await context.close();
   const list=samples.flatMap((sample,index)=>[`file '${sample.file}'`,`duration ${Math.max(.01,((samples[index+1]?.time||end)-sample.time)/1000)}`]).join('\n')+'\n';
   await writeFile(path.join(frames,'frames.txt'),list);
   const gif=path.join(destination,name+'.gif');
   const command=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',path.join(frames,'frames.txt'),'-filter_complex','fps=10,scale=1080:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=diff[p];[s1][p]paletteuse=dither=none:diff_mode=rectangle','-loop','0',gif],{encoding:'utf8'});
   if(command.status!==0)throw Error(command.stderr||'GIF encoding failed');
   const probe=spawnSync('ffprobe',['-v','error','-count_frames','-show_entries','stream=nb_read_frames','-of','default=noprint_wrappers=1:nokey=1',gif],{encoding:'utf8'});
   if(probe.status!==0||Number(probe.stdout)<20)throw Error('GIF frame verification failed');
   reports.push({name,view,subview,gif,source:'public/demo/report-week.json',views:738,visitors:430,requests:69357,width:1080,height:750,fps:10,recordedSeconds:(end-start)/1000,frames:Number(probe.stdout)});
   // Raw PNG frames are only an encoding intermediate; keep final GIF plus QA still.
   await rm(frames,{recursive:true,force:true});
   console.log('Recorded actual interface:',name);
 }
 if(errors.length)throw Error(JSON.stringify(errors));
 await writeFile(destination+'/recordings.json',JSON.stringify({recordedOn:'2026-10-16',kind:'actual-browser-screen-recordings',data:'anonymized-real-nginx-aggregates',noSyntheticMetrics:true,clips:reports,errors},null,2)+'\n');
}finally{await browser.close();}
