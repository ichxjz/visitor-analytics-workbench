import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { cachedVisitorResult, parseVisitorLogs, redactClientAddresses, visitorAddresses, visitorInsights } from './visitor-insights.js';

const unknownLocation=()=>null;
const dayKey = timestamp => new Date(timestamp + 8 * 3600_000).toISOString().slice(0, 10);
const automated = /bot\b|crawler|spider|headless|curl|wget|python|monitor|uptime|lighthouse|httpclient|go-http|zgrab|masscan/i;
const ranges = {hour:1,day:1,week:7,month:30,year:365,all:3650};
const increment = (map, key) => map.set(key, (map.get(key) || 0) + 1);
const ranked = map => [...map].map(([name, views]) => ({name, views})).sort((a, b) => b.views - a.views).slice(0, 8);
const maskedNetwork = address => {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  const ip = mapped ? mapped[1] : address;
  if (isIP(ip) === 4) return `${ip.split('.').slice(0, 2).join('.')}.0.0/16`;
  if (isIP(ip) === 6) {
    const [left='',right='']=ip.toLowerCase().split('::');
    const before=left?left.split(':'):[],after=right?right.split(':'):[];
    const parts=ip.includes('::')?[...before,...Array(8-before.length-after.length).fill('0'),...after]:before;
    return `${Number.parseInt(parts[0],16).toString(16)}:${Number.parseInt(parts[1],16).toString(16)}::/32`;
  }
  return '未知网络';
};
const operatingSystem = ua => /iPhone|iPad|iPod/i.test(ua) ? 'iOS / iPadOS' : /Android/i.test(ua) ? 'Android' : /Windows/i.test(ua) ? 'Windows' : /Macintosh|Mac OS X/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : '其他 / 未识别';
const browserName = ua => /Edg\//.test(ua) ? 'Edge' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Chrome|CriOS/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : '其他';
const deviceName = ua => /iPad|Tablet|Android(?!.*Mobile)/i.test(ua) ? '平板' : /Mobile|iPhone|Android/i.test(ua) ? '手机' : '电脑';
const deviceModel = ua => {
  // Desktop and Apple user agents normally omit the hardware model. Android
  // sometimes includes it; only show an explicit, bounded model token.
  const android = /Android\s+[\d.]+;\s*([^;)]+?)(?:\s+Build\/[^;)]*)?\)/i.exec(ua);
  const model = android?.[1]?.trim().replace(/^(?:[a-z]{2}(?:[-_][a-z]{2})?;\s*)+/i, '');
  return model?.length >= 3 && !/^(?:wv|mobile|tablet|linux|unknown)$/i.test(model) ? model.slice(0, 64) : '型号未提供';
};
const clientHintModel = tail => {
  if (!tail || tail.length > 160) return '';
  const model=tail.trim().replaceAll('\\x22','"').replace(/^"|"$/g,'').replace(/^"|"$/g,'').trim();
  return model && model !== '-' && model.length <= 64 && /^[\p{L}\p{N} ._()+/-]+$/u.test(model) ? model : '';
};
const makeTrend = (visits, range, now, coverageStart) => {
  const midnight = Date.parse(`${dayKey(now)}T00:00:00+08:00`);
  const date = ms => new Date(ms + 8 * 3600_000).toISOString();
  let intervals;
  if (range === 'hour') intervals = Array.from({length:12}, (_, i) => [now - (12-i)*300000, now - (11-i)*300000]);
  else if (range === 'day') intervals = Array.from({length:24}, (_, i) => [midnight+i*3600000, midnight+(i+1)*3600000]);
  else if (range === 'all' && coverageStart !== null && now - coverageStart > 30*86400000) {
    const first = Math.max(coverageStart, now - 3650*86400000);
    const step = Math.ceil((now + 1 - first) / 12);
    intervals = Array.from({length:12}, (_, i) => [first+i*step, i===11?now+1:first+(i+1)*step]);
  }
  else if (range === 'year') {
    const [year, month] = dayKey(now).split('-').map(Number);
    intervals = Array.from({length:12}, (_, i) => {
      const first = new Date(Date.UTC(year, month-1-11+i, 1));
      const next = new Date(Date.UTC(year, month-11+i, 1));
      return [first.getTime()-8*3600000, next.getTime()-8*3600000];
    });
  } else {
    const count = range === 'month' || range === 'all' ? 30 : 7;
    intervals = Array.from({length:count}, (_, i) => [midnight-(count-1-i)*86400000, midnight-(count-2-i)*86400000]);
  }
  return intervals.map(([start,end]) => {
    const bucket = visits.filter(visit => visit.timestamp >= start && visit.timestamp < end);
    const unique = new Set(bucket.map(visit => createHash('sha256').update(`${visit.ip}\0${visit.ua}`).digest('hex')));
    const label = range === 'hour' || range === 'day' ? date(start).slice(11,16) : range === 'year' ? date(start).slice(0,7) : date(start).slice(5,10);
    return {label,start:new Date(start).toISOString(),end:new Date(end).toISOString(),views:bucket.length,visitors:unique.size,available:coverageStart !== null && end > coverageStart && start <= now};
  });
};
const pagePath = (request,pagePaths) => {
  const match=/^GET (\/[^ ]*) HTTP\//.exec(request);if(!match)return null;
  try{const pathname=new URL(match[1],'https://log.invalid').pathname;for(const configured of pagePaths){const base=configured==='/'?'':configured.replace(/\/$/,'');if([configured,base+'/',base+'/index.html'].includes(pathname))return configured;}}catch{}
  return null;
};
const channelOf = source => source.startsWith('直接访问') ? '直接访问' : source === '站内访问' ? '站内跳转' : /google|bing|baidu|yahoo|duckduckgo|sogou|so\.com/.test(source) ? '搜索引擎' : /douyin|tiktok|xiaohongshu|weibo|facebook|instagram|twitter|x\.com|youtube/.test(source) ? '社交媒体' : '外链引荐';

// Client addresses are reduced to prefixes; exact details use the protected address API.
// A session estimates a 30-minute activity window; its observed span is not dwell time.
export function aggregateVisits(log, { days = 7, range = null, now = Date.now(), siteHosts=[], pagePaths=['/'], geoResolver=unknownLocation } = {}) {
  if (range ? !Object.hasOwn(ranges, range) : ![7,30].includes(days)) throw Object.assign(new Error('不支持的统计时间范围。'), {status:400});
  const today=dayKey(now), count=range?ranges[range]:days;
  const midnight=Date.parse(`${today}T00:00:00+08:00`);
  const start=range==='hour'?now-3600_000:range==='day'?midnight:midnight-(count-1)*86400_000;
  const dayCount=range==='all'?30:Math.min(count,365);
  const daily=Array.from({length:dayCount},(_,index)=>({date:dayKey(midnight-(dayCount-1-index)*86400_000),views:0,visitors:new Set()}));
  const byDay=new Map(daily.map(day=>[day.date,day]));
  const visitors=new Set(),devices=new Map(),browsers=new Map(),sources=new Map(),channels=new Map(),pages=new Map(),networks=new Map(),systems=new Map(),visitTypes=new Map(),hours=new Map(),regions=new Map(),locations=new Map();
  const visits=[],hintModels=new Map();
  const entries=parseVisitorLogs(log,{siteHosts});
  const insightEntries=entries.filter(entry=>entry.timestamp>=start&&entry.timestamp<=now);
  let coverageStart=null,excludedBots=0;
  for(const entry of entries){
    const timestamp=entry.timestamp;
    if(!Number.isFinite(timestamp)||timestamp>now)continue;
    coverageStart=coverageStart===null?timestamp:Math.min(coverageStart,timestamp);
    const ua=entry.ua;
    if(timestamp<start||![200,304].includes(entry.status))continue;
    const page=pagePath(entry.request,pagePaths);
    if(!ua||ua==='-'||automated.test(ua)){if(page)excludedBots++;continue;}
    const hinted=clientHintModel(entry.modelHint);
    if(hinted)hintModels.set(createHash('sha256').update(`${entry.ip}\0${ua}`).digest('hex'),hinted);
    if(!page)continue;
    visits.push({timestamp,page,ip:entry.ip||'',ua,source:entry.source});
  }
  visits.sort((a,b)=>a.timestamp-b.timestamp);
  const sessions=[],active=new Map();
  for(const visit of visits){
    const {timestamp,page,ip,ua,source}=visit;
    const visitor=createHash('sha256').update(`${ip}\0${ua}`).digest('hex');
    increment(visitTypes,visitors.has(visitor)?'重复浏览':'首次出现');visitors.add(visitor);
    const day=byDay.get(dayKey(timestamp));if(day){day.views++;day.visitors.add(visitor);}
    const device=deviceName(ua),browser=browserName(ua),system=operatingSystem(ua),network=maskedNetwork(ip),channel=channelOf(source);
    if(!locations.has(ip)) locations.set(ip,geoResolver(ip));
    const location=locations.get(ip);
    increment(devices,device);increment(browsers,browser);increment(networks,network);increment(systems,system);increment(sources,source);increment(channels,channel);increment(pages,page);increment(regions,location||'未知属地');
    increment(hours,new Date(timestamp+8*3600_000).toISOString().slice(11,13)+':00');
    let session=active.get(visitor);
    if(!session||timestamp-session.last>30*60_000){
      const version=/(?:Edg|Firefox|FxiOS|Chrome|CriOS|Version)\/(\d+)/.exec(ua)?.[1];
      session={id:`S-${String(sessions.length+1).padStart(5,'0')}`,start:timestamp,last:timestamp,views:0,page,source,channel,device,model:hintModels.get(visitor)||deviceModel(ua),system,browser:`${browser}${version?` ${version}`:''}`,network,location};
      sessions.push(session);active.set(visitor,session);
    }
    session.last=timestamp;session.views++;
  }
  const views=visits.length;
  const sessionRows=sessions.slice(-1000).reverse().map(session=>({id:session.id,startedAt:new Date(session.start).toISOString(),views:session.views,share:views?session.views/views:0,page:session.page,source:session.source,channel:session.channel,device:session.device,model:session.model,system:session.system,browser:session.browser,network:session.network,location:session.location,observedSeconds:session.last>session.start?Math.round((session.last-session.start)/1000):null}));
  const insights=visitorInsights(insightEntries,{geoResolver,pagePaths});insights.summary.viewRequests=views;
  return redactClientAddresses({range:range||`${days}d`,days:dayCount,timezone:'Asia/Shanghai',generatedAt:new Date(now).toISOString(),coverageStart:coverageStart===null?null:new Date(coverageStart).toISOString(),
    views,visitors:visitors.size,sessionCount:sessions.length,todayViews:daily.at(-1).views,todayVisitors:daily.at(-1).visitors.size,excludedBots,
    highFrequency:sessions.filter(session=>session.views>=20&&session.last-session.start<=5*60_000).length,
    daily:daily.map(day=>({...day,visitors:day.visitors.size,available:coverageStart!==null&&day.date>=dayKey(coverageStart)})),trend:makeTrend(visits,range||'week',now,coverageStart),hours:ranked(hours).sort((a,b)=>a.name.localeCompare(b.name)),
    devices:ranked(devices),browsers:ranked(browsers),sources:ranked(sources),channels:ranked(channels),pages:ranked(pages),networks:ranked(networks),systems:ranked(systems),visitTypes:ranked(visitTypes),regions:ranked(regions),sessions:sessionRows,sessionLimit:1000,
    insights,sessionMethod:'同一网络地址与浏览器信息在连续 30 分钟内的页面请求估为同一会话；只有一次请求时无法推算访问时长。',locationMethod:'地区由可配置地理解析适配器估算；未配置适配器、VPN或无记录时显示未知。'},insightEntries);
}


// Raw local logs stay in memory; no production transport or disk snapshot is bundled.
export function createVisitorAnalytics({readLogs,clock=Date.now,siteHosts=[],pagePaths=['/'],geoResolver=unknownLocation,source='本机Nginx日志',coverageNote='仅统计已配置且可读取日志的记录；截断与轮转影响覆盖。',cacheMs=15000}={}){
  if(typeof readLogs!=='function')throw new TypeError('readLogs adapter is required');
  let cache=null,inflight=null;
  const refresh=()=>inflight||=(Promise.resolve().then(readLogs).then(log=>{cache={log:String(log),time:clock()};}).finally(()=>{inflight=null;}));
  const validate=range=>{if(!Object.hasOwn(ranges,range))throw Object.assign(new Error('不支持的统计时间范围。'),{status:400});};
  const options={siteHosts,pagePaths,geoResolver};
  const analytics=async(range='week',{fresh=false}={})=>{validate(range);if(fresh||!cache||clock()-cache.time>=cacheMs)await refresh();return {...aggregateVisits(cache.log,{...options,range,now:cache.time}),source,coverageNote,cached:false};};
  analytics.addresses=async(range='week',filters={})=>{validate(range);visitorAddresses([],filters,options);if(!cache||clock()-cache.time>=cacheMs)await refresh();const now=cache.time,midnight=Date.parse(dayKey(now)+'T00:00:00+08:00'),count=ranges[range],start=range==='hour'?now-3600_000:range==='day'?midnight:midnight-(count-1)*86400_000;const events=parseVisitorLogs(cache.log,options).filter(entry=>entry.timestamp>=start&&entry.timestamp<=now);return {...visitorAddresses(events,filters,options),range,generatedAt:new Date(now).toISOString(),privacy:'仅本机受保护接口临时返回，不写入磁盘快照。'};};
  return analytics;
}
