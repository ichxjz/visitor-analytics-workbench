import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createVisitorAnalytics} from './visitor-analytics.js';
import {createLocalLogReader} from './local-logs.js';
const ranges=new Set(['hour','day','week','month','year','all']);
const loopback=address=>address==='127.0.0.1'||address==='::1'||address==='::ffff:127.0.0.1';
function sameLocalOrigin(req){
  if(!loopback(req.socket.remoteAddress))return false;
  let host;try{if(typeof req.headers.host!=='string'||/[\s\\/@?#]/.test(req.headers.host))return false;host=new URL(`http://${req.headers.host}`).hostname;}catch{return false;}
  if(!['127.0.0.1','localhost','[::1]'].includes(host))return false;
  const expected=`${req.socket.encrypted?'https':'http'}://${req.headers.host}`;
  if(req.headers.origin&&req.headers.origin!==expected)return false;
  if(req.headers['sec-fetch-site']==='cross-site')return false;
  return true;
}
function tokenMatches(actual,expected){return typeof actual==='string'&&Buffer.byteLength(actual)===Buffer.byteLength(expected)&&timingSafeEqual(Buffer.from(actual),Buffer.from(expected));}
export function createVisitorMiddleware(config,{readLogs,clock=Date.now,token=randomBytes(32).toString('hex')}={}){
  const analytics=config.mode==='live'?createVisitorAnalytics({...config,clock,source:config.siteLabel||'本机Nginx日志',readLogs:readLogs||createLocalLogReader(config)}):null;
  const send=(res,status,data)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cross-Origin-Resource-Policy','same-origin');res.end(JSON.stringify(data));};
  return async(req,res,next)=>{
    if(!req.url?.startsWith('/__admin/'))return next?.();
    if(!sameLocalOrigin(req))return send(res,403,{error:'只允许本机同源访问。'});
    if(req.method!=='GET')return send(res,405,{error:'日志接口只支持只读GET。'});
    let url;try{url=new URL(req.url,'http://localhost');}catch{return send(res,400,{error:'请求地址无效。'});}
    if(url.pathname==='/__admin/session'){
      if(req.headers['x-visitor-app']!=='1')return send(res,403,{error:'需要同源应用请求。'});
      return send(res,200,{token,mode:config.mode,siteLabel:config.siteLabel,siteLinks:config.siteLinks||[],allowAddressDetails:!!config.allowAddressDetails&&config.mode==='live'});
    }
    if(!tokenMatches(req.headers['x-admin-token'],token))return send(res,401,{error:'本机访问授权已失效，请重新载入页面。'});
    if(!['/__admin/analytics','/__admin/analytics/addresses'].includes(url.pathname))return send(res,404,{error:'接口不存在。'});
    const range=url.searchParams.get('range')||'week';if(!ranges.has(range))return send(res,400,{error:'不支持的统计时间范围。'});
    if(url.pathname.endsWith('/addresses')&&(config.mode!=='live'||!config.allowAddressDetails))return send(res,403,{error:'当前模式禁用精确IP。仅本机日志模式显式开启后可临时查看。'});
    try{
      if(url.pathname.endsWith('/addresses')){const filters=Object.fromEntries(['domain','source','region','network','limit'].filter(key=>url.searchParams.has(key)).map(key=>[key,url.searchParams.get(key)]));return send(res,200,await analytics.addresses(range,filters));}
      if(config.mode==='demo'){
        const report=JSON.parse(await readFile(path.join(config.demoDirectory,`report-${range}.json`),'utf8'));
        if(report.range!==range||!Array.isArray(report.sessions)||!report.insights)throw Object.assign(new Error('脱敏快照格式不完整。'),{status:503});
        return send(res,200,{...report,cached:false});
      }
      return send(res,200,await analytics(range,{fresh:url.searchParams.get('fresh')==='1'}));
    }catch(error){return send(res,[400,503].includes(error.status)?error.status:503,{error:error.status===400?error.message:config.mode==='demo'?'脱敏快照尚不可用，请检查public/demo中的六个范围报表。':'本机日志暂不可读，请核对已配置文件及权限后重试。'});}
  };
}
