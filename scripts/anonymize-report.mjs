import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const publicHosts=new Set(['ichxjz.com','www.ichxjz.com','google.com','www.google.com','bing.com','www.bing.com','baidu.com','www.baidu.com']);
const missing=new Set(['未记录','未提供','未知','未记录访问域名','直接访问 / 来源未提供','直接访问','站内访问','未知网络','未知属地']);
const aliases={path:new Map(),domain:new Map(),network:new Map(),upstream:new Map(),flow:new Map()};
const alias=(kind,value)=>{const map=aliases[kind];if(!map.has(value))map.set(value,map.size+1);return map.get(value);};
const day=value=>value ? `${value.slice(0,10)}T00:00:00.000Z` : value;
const publicPath=value=>{
  if(['/', '/index.html','/KK-Tiong_Pavelio','/KK-Tiong_Pavelio/','/solar/'].includes(value))return value;
  if(!value||value==='未记录')return value;
  const extension=/\.([a-z0-9]{1,8})$/i.exec(value)?.[1]?.toLowerCase();
  const group=value.startsWith('/assets/')?'assets':value.startsWith('/uploads/')?'media':value.startsWith('/api/')?'api':'route';
  return `/${group}/resource-${alias('path',value)}${extension?'.'+extension:''}`;
};
const domain=value=>{
  if(!value||missing.has(value)||publicHosts.has(value))return value;
  return `source-${alias('domain',value)}.example`;
};
const network=value=>{
  if(!value||missing.has(value))return value;
  // Documentation-only IPv6 aliases. This preserves group membership, not an address.
  // Opaque export-local IDs; hashing low-entropy IPv4 prefixes permits enumeration.
  return `2001:db8:${alias('network',value).toString(16)}::/64`;
};
const upstream=value=>!value||value==='-'?value:`upstream-${alias('upstream',value)}.example:443`;

export function anonymizeReport(input){
  const r=structuredClone(input);
  r.cached=false;
  r.source='ichxjz.com · 脱敏真实快照';
  r.coverageNote='演示为 2026-10-16 真实 Nginx 日志的固定聚合快照；计数与流量保留，身份字段已脱敏，不连接原站日志。';
  r.locationMethod='地区聚合来自原站离线 IPv4 估算；公开演示没有地理数据库。国家高亮不代表访客精确位置。';
  for(const row of r.sources||[]) row.name=domain(row.name);
  for(const row of r.networks||[]) row.name=network(row.name);
  for(const row of r.pages||[]) row.name=publicPath(row.name);
  for(const row of r.sessions||[]){
    row.source=domain(row.source);row.network=network(row.network);row.model='型号未提供';
    row.startedAt=day(row.startedAt);row.location=row.location?.split(' · ')[0]||'未知属地';
    row.page=publicPath(row.page);
  }
  for(const row of r.insights?.domains||[]){row.name=domain(row.name);row.lastSeen=day(row.lastSeen);}
  for(const row of r.insights?.referrerDomains||[]){row.name=domain(row.name);row.lastSeen=day(row.lastSeen);}
  for(const row of r.insights?.regions||[])row.lastSeen=day(row.lastSeen);
  for(const row of r.insights?.associations||[]){
    row.domain=domain(row.domain);row.source=domain(row.source);row.network=network(row.network);row.lastSeen=day(row.lastSeen);
  }
  for(const row of r.insights?.flows||[]){
    row.id=`flow-${alias('flow',row.id)}`;row.domain=domain(row.domain);row.source=domain(row.source);
    row.path=publicPath(row.path);row.upstreams=(row.upstreams||[]).map(upstream);row.lastSeen=day(row.lastSeen);
  }
  if(r.insights?.capabilities?.clientAddresses)r.insights.capabilities.clientAddresses.note='原站已记录；公开演示不包含、也不提供原始客户端地址。';
  const removePrivate=value=>{
    if(!value||typeof value!=='object')return;
    for(const key of Object.keys(value)){
      if(['ip','address','clientAddress','clientAddresses','rawIp','remote_addr','ua','userAgent','token'].includes(key)&&!(key==='clientAddresses'&&value[key]?.status))delete value[key];
      else removePrivate(value[key]);
    }
  };
  removePrivate(r);
  return r;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const source=process.argv[2];if(!source)throw Error('Usage: node scripts/anonymize-report.mjs PRIVATE_REPORTS.json [OUTPUT_DIRECTORY]');
  const output=process.argv[3]||'public/demo';await mkdir(output,{recursive:true});
  const reports=JSON.parse(await readFile(source,'utf8'));
  const manifest={type:'anonymized-real-log-aggregates',source:'https://ichxjz.com',snapshotDate:'2026-10-16',description:'Numbers are unchanged from real aggregates. Network identifiers, unknown domains, resource paths and upstreams are stable aliases; session timestamps are day-bucketed and hardware models removed. Raw logs and mapping keys are not distributed.',reports:{}};
  for(const [range,raw] of Object.entries(reports)){
    const safe=anonymizeReport(raw),encoded=JSON.stringify(safe)+'\n';
    await writeFile(path.join(output,`report-${range}.json`),encoded);
    manifest.reports[range]={generatedAt:raw.generatedAt,views:raw.views,visitors:raw.visitors,requests:raw.insights.summary.requests,bytesSent:raw.insights.summary.bytesSent,sessionRows:raw.sessions.length,sha256:createHash('sha256').update(encoded).digest('hex')};
  }
  await writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log('Wrote six sanitized reports and provenance manifest. No raw values printed.');
}
