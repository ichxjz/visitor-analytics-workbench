import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {readFile,writeFile,mkdir,mkdtemp,rm,stat} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
const root=process.cwd(),out=path.join(root,'output/previews/standalone');await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={passed:false,checks:[],errors:[],requests:[]};let liveProcess,staticServer,temp;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',error=>report.errors.push(error.message));page.on('request',request=>{if(new URL(request.url()).hostname!=='127.0.0.1')report.requests.push(request.url());});
 await page.goto(process.env.VISITOR_TEST_URL||'http://127.0.0.1:5187/');
 await page.locator('.visitor-overview-cards').waitFor();await page.waitForTimeout(1000);
 const snapshot=JSON.parse(await readFile('public/demo/report-week.json','utf8'));
 assert.deepEqual((await page.locator('.visitor-top-kpi strong').allTextContents()).map(value=>Number(value.replaceAll(',',''))),[snapshot.views,snapshot.visitors]);
 const menu=page.getByRole('navigation',{name:'访客统计导航'});
 for(const name of ['仪表盘','访客监测','访问风控','设置']){await menu.getByRole('button',{name,exact:true}).click();assert((await menu.getByRole('button',{name,exact:true}).getAttribute('class')).includes('active'));}
 assert(await page.getByRole('checkbox').isDisabled());assert(!(await page.getByRole('checkbox').isChecked()));
 await menu.getByRole('button',{name:'流量分析',exact:true}).click();await page.locator('.vi-region-globe[data-globe-state=ready]').waitFor({timeout:20000});
 for(const name of ['规则链路','域名 / IP 关联','热门域名','地区详情']){await page.getByRole('navigation',{name:'流量分析子页面'}).getByRole('button',{name,exact:true}).click();if(name==='域名 / IP 关联')assert(await page.getByRole('button',{name:'当前模式禁用精确IP'}).isDisabled());}
 await page.getByRole('button',{name:'切换深色主题'}).click();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
 await page.screenshot({path:path.join(out,'desktop-dark.png')});await page.getByRole('button',{name:'切换浅色主题'}).click();
 for(const viewport of [{width:1440,height:1000},{width:768,height:1024},{width:390,height:844},{width:320,height:740},{width:844,height:390}]){await page.setViewportSize(viewport);await page.waitForTimeout(150);const frame=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth,bottom:document.querySelector('.visitor-workspace').getBoundingClientRect().bottom,height:innerHeight}));assert(frame.width<=frame.viewport+1);assert(frame.bottom<=frame.height+1);}
 await page.screenshot({path:path.join(out,'phone-landscape.png')});report.checks.push('demo: five main menus/four insight pages, fixed real totals, explicit IP denial, disabled auto-refresh, two themes and five viewport bounds');
 // Serve dist without any API: verify the public demo is a real static build.
 staticServer=http.createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;const file=path.join(root,'dist',pathname==='/'?'index.html':pathname);if(!file.startsWith(path.join(root,'dist')+path.sep))throw Error();const data=await readFile(file);res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html');res.end(data);}catch{res.statusCode=404;res.end();}});await new Promise(resolve=>staticServer.listen(0,'127.0.0.1',resolve));
 await page.setViewportSize({width:1440,height:1000});await page.goto(`http://127.0.0.1:${staticServer.address().port}/`);await page.locator('.visitor-overview-cards').waitFor();assert.equal(await page.locator('.visitor-signal').getByText('固定脱敏快照',{exact:false}).count(),1);report.checks.push('production dist works on a plain static server with no local API');
 temp=await mkdtemp(path.join(tmpdir(),'visitor-live-browser-'));const log=path.join(temp,'access.log');const row=(address='203.0.113.9')=>JSON.stringify({time_iso8601:new Date(Date.now()-1000).toISOString(),remote_addr:address,request_method:'GET',request_uri:'/',host:'example.org',status:'200',body_bytes_sent:'100',http_user_agent:'Mozilla/5.0 Chrome/130.0'});await writeFile(log,row()+'\n');
 const portProbe=http.createServer();await new Promise(resolve=>portProbe.listen(0,'127.0.0.1',resolve));const livePort=portProbe.address().port;await new Promise(resolve=>portProbe.close(resolve));
 liveProcess=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(livePort)],{cwd:root,env:{...process.env,VISITOR_MODE:'live',VISITOR_LOG_FILES:JSON.stringify([log]),VISITOR_SITE_HOSTS:'["example.org"]',VISITOR_PAGE_PATHS:'["/"]',VISITOR_ALLOW_ADDRESSES:'true',VISITOR_SITE_LABEL:'Isolated local log fixture'},stdio:'pipe'});
 let output='';liveProcess.stderr.on('data',chunk=>output+=chunk);liveProcess.stdout.on('data',chunk=>output+=chunk);
 for(let index=0;index<50;index++){if(output.includes('Local:'))break;if(liveProcess.exitCode!==null)throw Error('Isolated live server failed to start: '+output);await wait(100);}
 await page.goto(`http://127.0.0.1:${livePort}/`);await page.locator('.visitor-overview-cards').waitFor();await page.waitForTimeout(1000);assert.deepEqual(await page.locator('.visitor-top-kpi strong').allTextContents(),['1','1']);
 await menu.getByRole('button',{name:'流量分析',exact:true}).click();await page.getByRole('navigation',{name:'流量分析子页面'}).getByRole('button',{name:'域名 / IP 关联',exact:true}).click();await page.getByRole('button',{name:'读取客户端地址',exact:true}).click();await page.getByRole('table',{name:'客户端地址列表',exact:true}).waitFor();
 assert((await page.locator('.vi-association-panel').innerText()).includes('203.0.113.9'));
 await writeFile(log,row()+'\n'+row('203.0.113.10')+'\n');await menu.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'立即刷新日志',exact:true}).click();await page.waitForTimeout(1200);assert.deepEqual(await page.locator('.visitor-top-kpi strong').allTextContents(),['2','2']);assert(!(await page.locator('body').innerText()).includes('203.0.113.9'));report.checks.push('live: real temporary Nginx file reads, explicit protected IP details, navigation clears details, fresh update changes PV/UV 1→2');
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.requests,[]);report.passed=true;
}catch(error){report.failure=error.stack;process.exitCode=1;}
finally{await browser.close();if(liveProcess){liveProcess.kill('SIGTERM');await Promise.race([new Promise(resolve=>liveProcess.once('exit',resolve)),wait(2000)]);}if(staticServer)await new Promise(resolve=>staticServer.close(resolve));if(temp)await rm(temp,{recursive:true,force:true});await writeFile(path.join(out,'browser-report.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report));
