import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {anonymizeReport} from '../scripts/anonymize-report.mjs';

test('published snapshot integrity and expected real aggregate totals',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../public/demo/manifest.json',import.meta.url)));
 assert.equal(manifest.type,'anonymized-real-log-aggregates');
 for(const [range,entry] of Object.entries(manifest.reports)){
  const bytes=await readFile(new URL(`../public/demo/report-${range}.json`,import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);
  const r=JSON.parse(bytes);
  assert.equal(r.range,range);assert.equal(r.views,entry.views);assert.equal(r.visitors,entry.visitors);
  assert.equal(r.insights.summary.requests,entry.requests);assert.equal(r.insights.summary.bytesSent,entry.bytesSent);
  assert.doesNotMatch(bytes.toString(),/\b(?:\d{1,3}\.){3}\d{1,3}\b|remote_addr|rawIp|userAgent|\/Users\/|-----BEGIN/);
  for(const row of r.insights.associations)assert.match(row.network,/^(?:2001:db8:[a-f\d:]+::\/64|未知网络|未提供)$/);
 }
 assert.equal(manifest.reports.week.views,738);assert.equal(manifest.reports.week.visitors,430);
 assert.equal(manifest.reports.week.requests,69357);
});

test('export strips sensitive identity without changing numeric measurements',()=>{
 const raw={views:2,visitors:1,source:'private-site',pages:[{name:'/private/name.pdf',views:2}],sessions:[{views:2,network:'23.41.0.0/16',model:'Personal Phone',startedAt:'2026-10-16T01:02:03Z',source:'secret.internal',location:'中国 · 某城市',ip:'23.41.1.2',page:'/private/name.pdf',observedSeconds:19}],insights:{summary:{requests:3,bytesSent:300,requestBytes:12},domains:[{name:'secret.internal',requests:3,lastSeen:'2026-10-16T01:02:03Z'}],associations:[{domain:'secret.internal',source:'secret.internal',network:'23.41.0.0/16',requests:3,bytesSent:300}],flows:[{id:'private-id',domain:'secret.internal',source:'secret.internal',path:'/private/name.pdf',upstreams:['10.0.0.1:8080'],rules:['proxy:app'],requests:3,bytesSent:300}]}};
 const safe=anonymizeReport(raw),text=JSON.stringify(safe);
 for(const secret of ['23.41','Personal Phone','secret.internal','private/name','private-id','10.0.0.1'])assert.ok(!text.includes(secret));
 assert.equal(safe.views,2);assert.equal(safe.sessions[0].observedSeconds,19);assert.deepEqual(safe.insights.summary,raw.insights.summary);
 assert.equal(safe.sessions[0].network,safe.insights.associations[0].network);
 assert.equal(safe.insights.domains[0].name,safe.insights.flows[0].domain);
 assert.equal(raw.sessions[0].ip,'23.41.1.2');
});
