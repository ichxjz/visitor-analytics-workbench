import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregateVisits,createVisitorAnalytics} from '../server/visitor-analytics.js';
import {parseVisitorLog,visitorInsights,visitorAddresses} from '../server/visitor-insights.js';
const now=Date.parse('2026-10-16T10:00:00+08:00');
const json=(patch={})=>JSON.stringify({time_iso8601:'2026-10-16T09:30:00+08:00',remote_addr:'203.0.113.9',request_method:'GET',request_uri:'/',host:'example.org',status:'200',body_bytes_sent:'100',request_length:'80',http_referer:'-',http_user_agent:'Mozilla/5.0 Chrome/130.0',rule_chain:'-',upstream_addr:'-',...patch});
const options={range:'week',now,siteHosts:['example.org'],pagePaths:['/','/docs/']};
test('configurable site paths share visitors/sessions and include each resource only once in traffic',()=>{
  const report=aggregateVisits([json(),json({request_uri:'/docs/index.html'}),json({request_uri:'/docs/assets/main.js',body_bytes_sent:'9000'}),json({request_uri:'/unconfigured'}),json({http_user_agent:'curl/8.0'})].join('\n'),options);
  assert.equal(report.views,2);assert.equal(report.visitors,1);assert.equal(report.sessionCount,1);assert.equal(report.excludedBots,1);
  assert.equal(report.insights.summary.requests,5);assert.equal(report.insights.summary.bytesSent,9400);assert.equal(report.insights.summary.viewRequests,2);
  assert.deepEqual(report.pages,[{name:'/',views:1},{name:'/docs/',views:1}]);
  assert(!JSON.stringify(report).includes('203.0.113.9'));
});
test('combined and enhanced JSON logs mix without inventing host, rules, bytes or geography',()=>{
  const combined='203.0.113.9 - - [16/Oct/2026:09:30:00 +0800] "GET / HTTP/1.1" 404 - "https://ref.example.com/private?token=secret" "Mozilla/5.0"';
  const report=aggregateVisits([combined,json({rule_chain:['server:https','static:site-files'],body_bytes_sent:'0'})].join('\n'),options);
  assert.equal(report.insights.summary.requests,2);assert.equal(report.insights.summary.bytesSent,0);assert.equal(report.insights.capabilities.responseBytes.status,'partial');
  assert.equal(report.insights.capabilities.requestHost.status,'partial');assert.equal(report.insights.capabilities.rules.status,'partial');assert.equal(report.insights.capabilities.region.status,'missing');
  assert.equal(report.insights.referrerDomains[0].name,'ref.example.com');assert(!report.insights.domains.some(item=>item.name==='ref.example.com'));
  const flow=report.insights.flows.find(item=>item.status===404);assert.deepEqual(flow.rules,[]);assert.equal(flow.domain,'未记录访问域名');
  assert(!JSON.stringify(report).includes('secret'));assert(!JSON.stringify(report).includes('/private'));
});
test('missing bytes remain null, recorded zero remains zero, malformed records skipped',()=>{
  const report=aggregateVisits(json({body_bytes_sent:'-'}),options);assert.equal(report.insights.summary.bytesSent,null);assert.equal(report.insights.domains[0].bytesSent,null);assert.equal(report.insights.flows[0].bytesSent,null);
  assert.equal(aggregateVisits(json({body_bytes_sent:'0'}),options).insights.summary.bytesSent,0);
  assert.equal(aggregateVisits('',options).insights.summary.bytesSent,0);
  for(const line of ['{bad','x'.repeat(32769)])assert.equal(parseVisitorLog(line),null);
  assert.equal(parseVisitorLog(json({host:'evil.example/@victim.example',body_bytes_sent:'-1'})).host,null);
});
test('optional local geo resolver is consistent through regions, associations and temporary details',()=>{
  const geoResolver=ip=>ip==='203.0.113.9'?'示例国家 · 示例地区':null;
  const report=aggregateVisits(json({http_referer:'https://example.org/'}),{...options,geoResolver});
  assert.equal(report.regions[0].name,'示例国家 · 示例地区');assert.equal(report.sources[0].name,'站内访问');assert.equal(report.insights.associations[0].source,'example.org');
  const event=parseVisitorLog(json({http_referer:'https://example.org/'}),options);
  assert.equal(visitorAddresses([event],{source:'example.org',region:'示例国家 · 示例地区'},{geoResolver}).items[0].ip,'203.0.113.9');
  assert.equal(visitorAddresses([event],{source:'other.example'},{geoResolver}).items.length,0);
});
test('six ranges validate and never infer document views from assets',()=>{
  for(const range of ['hour','day','week','month','year','all']){const report=aggregateVisits(json({request_uri:'/assets/a.js'}),{...options,range});assert.equal(report.range,range);assert.equal(report.views,0);assert.equal(report.insights.summary.requests,1);}
  assert.throws(()=>aggregateVisits('',{range:'bad'}),error=>error.status===400);
});
test('fresh reads coalesce and real new records change totals with no disk snapshot',async()=>{
  let version=1,calls=0;const reader=createVisitorAnalytics({...options,clock:()=>now,readLogs:async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,5));return Array(version).fill(json()).join('\n');}});
  const [a,b]=await Promise.all([reader('week'),reader('week')]);assert.equal(calls,1);assert.equal(a.views,1);assert.equal(b.views,1);
  version=2;assert.equal((await reader('week',{fresh:true})).views,2);assert.equal(calls,2);
  assert.equal((await reader.addresses('week')).items[0].requests,2);
});
