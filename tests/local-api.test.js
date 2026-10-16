import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,writeFile,symlink,rm,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createVisitorMiddleware} from '../server/local-api.js';
import {createLocalLogReader} from '../server/local-logs.js';
import {loadVisitorConfig} from '../server/config.js';
const row=()=>JSON.stringify({time_iso8601:new Date(Date.now()-1000).toISOString(),remote_addr:'203.0.113.9',request_method:'GET',request_uri:'/',host:'example.org',status:'200',body_bytes_sent:'42',http_user_agent:'Mozilla/5.0 Chrome/130.0'});
async function withServer(config,run){const middleware=createVisitorMiddleware(config,{token:'test-session-token',readLogs:async()=>row()});const server=http.createServer((req,res)=>middleware(req,res,()=>{res.statusCode=404;res.end();}));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;try{await run(base);}finally{await new Promise(resolve=>server.close(resolve));}}
const auth={'x-admin-token':'test-session-token'};
test('loopback same-origin runtime token, no cross-origin/session leakage, GET only',async()=>withServer({mode:'live',siteHosts:['example.org'],pagePaths:['/'],allowAddressDetails:true},async base=>{
  assert.equal((await fetch(base+'/__admin/session')).status,403);
  const session=await fetch(base+'/__admin/session',{headers:{'x-visitor-app':'1'}});assert.equal(session.status,200);assert.equal((await session.json()).token,'test-session-token');assert.equal(session.headers.get('cache-control'),'no-store');
  assert.equal((await fetch(base+'/__admin/analytics')).status,401);
  assert.equal((await fetch(base+'/__admin/analytics',{headers:{...auth,origin:'https://malicious.example'}})).status,403);
  assert.equal(await new Promise((resolve,reject)=>{const request=http.get(base+'/__admin/analytics',{headers:{...auth,Host:'malicious.example'}},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);}),403);
  assert.equal((await fetch(base+'/__admin/session',{headers:{'x-visitor-app':'1','sec-fetch-site':'cross-site'}})).status,403);
  assert.equal((await fetch(base+'/__admin/analytics',{method:'POST',headers:auth})).status,405);
  assert.equal((await fetch(base+'/__admin/analytics?range=invalid',{headers:auth})).status,400);
  for(const Host of ['127.0.0.1/evil','evil@127.0.0.1'])assert.equal(await new Promise((resolve,reject)=>{const request=http.get(base+'/__admin/analytics',{headers:{...auth,Host}},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);}),403);
  const result=await fetch(base+'/__admin/analytics?range=week',{headers:auth});assert.equal(result.status,200);const report=await result.json();assert.equal(report.views,1);assert(!JSON.stringify(report).includes('203.0.113.9'));
  const detail=await fetch(base+'/__admin/analytics/addresses?domain=example.org',{headers:auth});assert.equal(detail.headers.get('cache-control'),'no-store');assert.equal((await detail.json()).items[0].ip,'203.0.113.9');
}));
test('demo and default live mode deny exact IP even with a valid token',async()=>{for(const mode of ['live','demo'])await withServer({mode,demoDirectory:'/not-used',siteHosts:[],pagePaths:['/'],allowAddressDetails:false},async base=>{const response=await fetch(base+'/__admin/analytics/addresses',{headers:auth});assert.equal(response.status,403);assert((await response.json()).error.includes('禁用精确IP'));});});
test('static demo API reads exact range snapshot and never silently fabricates an absent snapshot',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'visitor-demo-'));try{await writeFile(path.join(root,'report-week.json'),JSON.stringify({range:'week',views:23,sessions:[],insights:{summary:{requests:29}}}));await withServer({mode:'demo',demoDirectory:root},async base=>{assert.equal((await(await fetch(base+'/__admin/analytics?range=week',{headers:auth})).json()).views,23);assert.equal((await fetch(base+'/__admin/analytics?range=day',{headers:auth})).status,503);assert.equal((await fetch(base+'/__admin/analytics?range=../../etc/passwd',{headers:auth})).status,400);});}finally{await rm(root,{recursive:true,force:true});}
});
test('bounded local tails discard incomplete rows and deduplicate same inode aliases',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'visitor-logs-'));try{const file=path.join(root,'access.log'),alias=path.join(root,'alias.log'),first='x'.repeat(1100);await writeFile(file,first+'\n'+row()+'\n'+row()+'\n');await symlink(file,alias);const read=createLocalLogReader({files:[file,alias],maxBytes:1024});const lines=(await read()).trim().split('\n');assert.equal(lines.length,2);assert(lines.every(line=>JSON.parse(line).host==='example.org'));await assert.rejects(createLocalLogReader({files:[root]}),error=>error.status===503);await assert.rejects(createLocalLogReader({files:[path.join(root,'missing')]}),error=>!error.message.includes(root));}finally{await rm(root,{recursive:true,force:true});}
});
test('config defaults demo and unknown geography; live needs explicit files and opt-in addresses',async()=>{
  const demo=await loadVisitorConfig({});assert.equal(demo.mode,'demo');assert.equal(demo.allowAddressDetails,false);assert.equal(demo.geoResolver('203.0.113.9'),null);
  await assert.rejects(loadVisitorConfig({VISITOR_MODE:'live'}));await assert.rejects(loadVisitorConfig({VISITOR_PAGE_PATHS:'["https://evil.example"]'}));await assert.rejects(loadVisitorConfig({VISITOR_SITE_HOSTS:'["evil.example/@x"]'}));
  const live=await loadVisitorConfig({VISITOR_MODE:'live',VISITOR_LOG_FILES:'["test.log"]',VISITOR_SITE_HOSTS:'["EXAMPLE.ORG"]',VISITOR_PAGE_PATHS:'["/","/docs/"]',VISITOR_ALLOW_ADDRESSES:'true'});assert.equal(live.mode,'live');assert.deepEqual(live.siteHosts,['example.org']);assert.equal(live.allowAddressDetails,true);
});
