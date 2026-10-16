import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
const unknownLocation=()=>null;

const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const direct='直接访问 / 来源未提供';

const text=(value,max=256)=>typeof value==='string'&&!/[\x00-\x1f\x7f]/.test(value)?value.trim().slice(0,max):'';
const number=value=>['number','string'].includes(typeof value)&&String(value).trim()!==''&&value!=='-'&&Number.isSafeInteger(Number(value))&&Number(value)>=0?Number(value):null;
export function normalizedAddress(value){const candidate=text(value,80).replace(/^::ffff:/i,'');if(!isIP(candidate))return null;try{return isIP(candidate)===6?new URL(`http://[${candidate}]/`).hostname.slice(1,-1):candidate;}catch{return null;}}
export function networkOf(address){
  const ip=normalizedAddress(address);if(!ip)return '未知网络';
  if(isIP(ip)===4)return `${ip.split('.').slice(0,2).join('.')}.0.0/16`;
  const [left='',right='']=ip.split('::'),a=left?left.split(':'):[],b=right?right.split(':'):[];
  const parts=ip.includes('::')?[...a,...Array(8-a.length-b.length).fill('0'),...b]:a;
  return `${parseInt(parts[0],16).toString(16)}:${parseInt(parts[1],16).toString(16)}::/32`;
}
export function domainOf(value){
  const candidate=text(value,300);if(!candidate||/[\s\\/@?#<>"']/.test(candidate))return null;
  try{const host=new URL(`https://${candidate}`).hostname.toLowerCase().replace(/\.$/,'');if(isIP(host.replace(/^\[|\]$/g,''))||host.length>253||!host.includes('.')||!host.split('.').every(part=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part)))return null;return host;}catch{return null;}
}
function referral(value){try{const url=new URL(text(value,4096));if(!['http:','https:'].includes(url.protocol))return null;return domainOf(url.host);}catch{return null;}}
function locationTime(value){const m=/^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}:\d{2}:\d{2}) ([+-]\d{4})$/.exec(value||'');if(!m||!months.includes(m[2]))return NaN;return Date.parse(`${m[3]}-${String(months.indexOf(m[2])+1).padStart(2,'0')}-${m[1]}T${m[4]}${m[5].slice(0,3)}:${m[5].slice(3)}`);}
function sequence(value){
  if(value===undefined||value===null||value==='-'||value==='')return null;
  if(Array.isArray(value))return value.slice(0,20).map(item=>text(typeof item==='object'?item?.id||item?.name:item,160)).filter(Boolean);
  const item=text(value,512);return item?[item]:null;
}
export function parseVisitorLog(line,{siteHosts=[]}={}){
  const knownHosts=new Set(siteHosts);
  if(typeof line!=='string'||line.length>32768)return null;
  let value,format;
  if(line.trimStart().startsWith('{')){try{value=JSON.parse(line);if(!value||Array.isArray(value)||typeof value!=='object')return null;format='json';}catch{return null;}}
  else{
    const m=/^(\S+) \S+ \S+ \[([^\]]+)\] "([^"\n]*)" (\d{3}) (\d+|-) "([^"\n]*)" "([^"\n]*)"(?: "([^"\n]*)")?\s*$/.exec(line);
    if(!m)return null;value={remote_addr:m[1],time_local:m[2],request:m[3],status:m[4],body_bytes_sent:m[5],http_referer:m[6],http_user_agent:m[7],http_sec_ch_ua_model:m[8]};format='combined';
  }
  let timestamp;
  if(value.time_iso8601||value.timestamp)timestamp=typeof (value.time_iso8601||value.timestamp)==='number'?Number(value.time_iso8601||value.timestamp):Date.parse(value.time_iso8601||value.timestamp);
  else if(value.msec!==undefined)timestamp=Number(value.msec)*1000;
  else timestamp=locationTime(value.time_local);
  if(!Number.isFinite(timestamp))return null;
  const request=text(value.request,8192),requestParts=/^([A-Z]+) (\S+) HTTP\/[\d.]+$/.exec(request);
  const method=text(value.request_method||value.method||requestParts?.[1],16),target=text(value.request_uri||value.uri||value.path||requestParts?.[2],8192);
  let pathname='路径未记录',absoluteHost=null;
  try{const url=new URL(target,'https://log.invalid');if(!target.startsWith('/')&&!/^https?:\/\//i.test(target))throw Error();pathname=url.pathname.slice(0,512);if(/^https?:\/\//i.test(target))absoluteHost=domainOf(url.host);}catch{}
  const referrerDomain=referral(value.http_referer||value.referer||value.referrer);
  const host=domainOf(value.host||value.http_host||value.request_host)||absoluteHost;
  const status=number(value.status),ip=normalizedAddress(value.remote_addr||value.client_ip||value.clientIp||value.ip);
  const rules=sequence(value.rule_chain??value.rules??value.rule??value.rule_id??value.waf_rule_id);
  const upstreams=sequence(value.upstream_addr??value.upstreams??value.upstream);
  return {timestamp,ip,method,path:pathname,request:`${method} ${pathname} HTTP/1.1`,status:status>=100&&status<=599?status:null,bytesSent:number(value.body_bytes_sent??value.bodyBytesSent),requestBytes:number(value.request_length??value.requestLength),host,referrerDomain,source:referrerDomain?(knownHosts.has(referrerDomain)?'站内访问':referrerDomain):direct,ua:text(value.http_user_agent||value.user_agent||value.ua,4096),modelHint:text(value.http_sec_ch_ua_model||value.sec_ch_ua_model,160),rules:rules||[],ruleSource:rules?'logged':'not-recorded',upstreams:upstreams||[],upstreamRecorded:!!upstreams,format};
}
export const parseVisitorLogs=(log,options={})=>String(log).split('\n').map(line=>parseVisitorLog(line,options)).filter(Boolean);
const hash=value=>createHash('sha256').update(value).digest('hex').slice(0,20);
function accumulator(fields){return {...fields,requests:0,bytesSent:null,requestBytes:null,lastSeen:null,visitors:new Set()};}
function add(item,event){item.requests++;if(event.bytesSent!==null)item.bytesSent=(item.bytesSent??0)+event.bytesSent;if(event.requestBytes!==null)item.requestBytes=(item.requestBytes??0)+event.requestBytes;const seen=new Date(event.timestamp).toISOString();if(!item.lastSeen||seen>item.lastSeen)item.lastSeen=seen;if(event.ip)item.visitors.add(hash(`${event.ip}\0${event.ua}`));}
function ranked(map,limit,byBytes=false){return [...map.values()].sort((a,b)=>(byBytes?(b.bytesSent??-1)-(a.bytesSent??-1):0)||b.requests-a.requests||String(a.name||a.id||a.domain||'').localeCompare(String(b.name||b.id||b.domain||''))).slice(0,limit).map(item=>({...item,visitors:item.visitors.size}));}
const capability=(count,total,note)=>({status:count===0?'missing':count===total?'available':'partial',observedRequests:count,totalRequests:total,note});
export function visitorInsights(events,{geoResolver=unknownLocation,pagePaths=['/']}={}){
  const domains=new Map(),referrers=new Map(),regions=new Map(),associations=new Map(),flows=new Map(),locations=new Map();
  const summary={requests:events.length,bytesSent:events.length?null:0,requestBytes:null,viewRequests:0,unknownHostRequests:0,ruleObservedRequests:0};
  let hostCount=0,referrerCount=0,byteCount=0,requestByteCount=0,regionCount=0,upstreamCount=0,addressCount=0;
  for(const event of events){
    if(!locations.has(event.ip))locations.set(event.ip,event.ip?geoResolver(event.ip):null);
    const region=locations.get(event.ip)||'未知属地',network=networkOf(event.ip),domain=event.host||'未记录访问域名',source=event.referrerDomain||event.source;
    if(event.bytesSent!==null)summary.bytesSent=(summary.bytesSent??0)+event.bytesSent;if(event.requestBytes!==null)summary.requestBytes=(summary.requestBytes??0)+event.requestBytes;
    hostCount+=!!event.host;referrerCount+=!!event.referrerDomain;byteCount+=event.bytesSent!==null;requestByteCount+=event.requestBytes!==null;regionCount+=!!locations.get(event.ip);upstreamCount+=event.upstreamRecorded;addressCount+=!!event.ip;
    if(event.ruleSource==='logged')summary.ruleObservedRequests++;
    if(!event.host)summary.unknownHostRequests++;
    if(event.method==='GET'&&[200,304].includes(event.status)&&pagePaths.includes(event.path))summary.viewRequests++;
    if(event.host){if(!domains.has(event.host))domains.set(event.host,accumulator({name:event.host}));add(domains.get(event.host),event);}
    if(event.referrerDomain){if(!referrers.has(event.referrerDomain))referrers.set(event.referrerDomain,accumulator({name:event.referrerDomain}));add(referrers.get(event.referrerDomain),event);}
    if(!regions.has(region))regions.set(region,accumulator({name:region}));add(regions.get(region),event);
    const key=JSON.stringify([domain,network,region,source]);if(!associations.has(key))associations.set(key,accumulator({domain,network,region,source}));add(associations.get(key),event);
    const flowKey=JSON.stringify([region,source,domain,event.path,event.status,event.rules,event.upstreams,event.ruleSource]);
    if(!flows.has(flowKey))flows.set(flowKey,accumulator({id:hash(flowKey),region,source,domain,path:event.path,status:event.status,rules:event.rules,ruleSource:event.ruleSource,upstreams:event.upstreams}));add(flows.get(flowKey),event);
  }
  const limits={domains:100,referrerDomains:100,regions:100,associations:200,flows:300};
  limits.omitted=Object.fromEntries(Object.entries({domains,referrerDomains:referrers,regions,associations,flows}).map(([key,map])=>[key,Math.max(0,map.size-limits[key])]));
  return {version:1,summary,capabilities:{requestHost:capability(hostCount,events.length,'仅请求Host或绝对请求目标，不使用Referer代替。'),referrer:capability(referrerCount,events.length,'来源域名来自Referer；仅将同一请求的响应正文流量归因到该来源，不是向来源站的流量。'),responseBytes:capability(byteCount,events.length,'body_bytes_sent：服务器响应正文发出字节，不含响应头，不是双向流量；部分记录缺失时显示已记录小计，不估算缺失流量。'),requestBytes:capability(requestByteCount,events.length,'request_length：请求行、请求头与正文的总长度，缺失时不估算。'),region:capability(regionCount,events.length,'地区由配置的本机地理解析适配器提供；未配置或无法解析时为未知，不包含第三方IP数据库。'),rules:capability(summary.ruleObservedRequests,events.length,'只显示实际日志规则/最终执行位置标记，不由状态码推测WAF或补造完整规则历史。'),upstreams:capability(upstreamCount,events.length,'仅upstream_addr等实际日志证据，保留日志原始重试顺序，不查询DNS。'),clientAddresses:capability(addressCount,events.length,'精确客户端地址仅由本机受保护详情接口临时读取，不进入脱敏快照。')},domains:ranked(domains,limits.domains,true),referrerDomains:ranked(referrers,limits.referrerDomains,true),regions:ranked(regions,limits.regions),associations:ranked(associations,limits.associations,true),flows:ranked(flows,limits.flows,true),limits};
}

export function redactClientAddresses(value,events){
  const addresses=new Set(events.flatMap(event=>event.ip?[event.ip]:[]));
  const clean=item=>typeof item==='string'?item.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g,(ip,offset)=>addresses.has(ip)&&!/^\/(16|32)\b/.test(item.slice(offset+ip.length))?'[客户端地址已隐藏]':ip).replace(/[a-f0-9]*:[a-f0-9:.]+/gi,(ip,offset)=>{try{return addresses.has(normalizedAddress(ip))&&!/^\/(16|32)\b/.test(item.slice(offset+ip.length))?'[客户端地址已隐藏]':ip;}catch{return ip;}}):Array.isArray(item)?item.map(clean):item&&typeof item==='object'?Object.fromEntries(Object.entries(item).map(([key,nested])=>[key,clean(nested)])):item;
  return clean(value);
}
export function cachedVisitorResult(result){
  if(!result.insights)return result;
  return {...result,insights:{...result.insights,flows:result.insights.flows.map(flow=>({...flow,upstreams:[]})),capabilities:{...result.insights.capabilities,upstreams:{...result.insights.capabilities.upstreams,status:'missing',observedRequests:0,note:'精确上游地址不保存在脱敏快照中；刷新线上记录后显示。'}}}};
}

export function visitorAddresses(events,{domain='',region='',network='',source='',limit=100}={},{geoResolver=unknownLocation}={}){
  const unknownHost=domain==='未记录访问域名',normalizedDomain=domainOf(domain);
  if(domain&&!unknownHost&&!normalizedDomain)throw Object.assign(new Error('访问域名筛选无效。'),{status:400});
  if([region,network,source].some(value=>typeof value!=='string'||value.length>256||/[\x00-\x1f\x7f]/.test(value)))throw Object.assign(new Error('关联筛选无效。'),{status:400});
  if(!Number.isInteger(Number(limit))||Number(limit)<1||Number(limit)>100)throw Object.assign(new Error('地址详情每次最多读取100项。'),{status:400});
  const items=new Map(),locations=new Map();let matchedRequests=0;
  for(const event of events){
    if(!event.ip)continue;if(!locations.has(event.ip))locations.set(event.ip,geoResolver(event.ip)||'未知属地');
    const area=locations.get(event.ip),prefix=networkOf(event.ip);
    if(unknownHost?!!event.host:domain&&event.host!==normalizedDomain)continue;
    if(region&&area!==region||network&&prefix!==network||source&&event.source!==source&&event.referrerDomain!==source)continue;
    matchedRequests++;if(!items.has(event.ip))items.set(event.ip,accumulator({ip:event.ip,network:prefix,region:area,domains:new Set()}));const item=items.get(event.ip);add(item,event);if(event.host)item.domains.add(event.host);
  }
  return {items:ranked(items,Number(limit),true).map(({visitors,...item})=>({...item,domains:[...item.domains].slice(0,100)})),matchedRequests,totalAddresses:items.size,truncated:Math.max(0,items.size-Number(limit))};
}
