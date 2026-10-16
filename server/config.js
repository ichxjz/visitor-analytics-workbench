import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {domainOf} from './visitor-insights.js';
const list=(value,fallback)=>{if(!value)return fallback;let parsed;try{parsed=JSON.parse(value);}catch{throw new Error('List settings must be JSON arrays.');}if(!Array.isArray(parsed)||parsed.some(item=>typeof item!=='string'||!item.trim()))throw new Error('List settings must contain non-empty strings.');return parsed;};
export async function loadVisitorConfig(env={},root=process.cwd()){
  const mode=env.VISITOR_MODE||'demo';if(!['demo','live'].includes(mode))throw new Error('VISITOR_MODE must be demo or live.');
  const siteHosts=list(env.VISITOR_SITE_HOSTS,[]).map(host=>{const value=domainOf(host);if(!value)throw new Error('VISITOR_SITE_HOSTS contains an invalid domain.');return value;});
  const pagePaths=list(env.VISITOR_PAGE_PATHS,['/']);
  if(pagePaths.length>100||pagePaths.some(value=>!value.startsWith('/')||value.startsWith('//')||/[?#\s\x00-\x1f]/.test(value)))throw new Error('VISITOR_PAGE_PATHS requires absolute pathname values without queries.');
  let origin=null;if(env.VISITOR_SITE_URL){const url=new URL(env.VISITOR_SITE_URL);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('VISITOR_SITE_URL must be a public HTTP(S) site URL.');origin=url.origin;}
  let geoResolver=()=>null;
  if(mode==='live'&&env.VISITOR_GEO_ADAPTER){const imported=await import(pathToFileURL(path.resolve(root,env.VISITOR_GEO_ADAPTER)).href);const resolver=imported.lookupLocation||imported.default;if(typeof resolver!=='function')throw new Error('Geographic adapter must export lookupLocation(ip).');geoResolver=ip=>{const area=resolver(ip);return typeof area==='string'&&area.length<=256&&!/[\x00-\x1f]/.test(area)?area:null;};}
  const files=mode==='live'?list(env.VISITOR_LOG_FILES,[]).map(file=>path.resolve(root,file)):[];
  if(mode==='live'&&!files.length)throw new Error('Live mode needs VISITOR_LOG_FILES; demo never reads local logs.');
  const maxBytes=env.VISITOR_MAX_LOG_BYTES?Number(env.VISITOR_MAX_LOG_BYTES):32*1024*1024;
  return {mode,siteHosts,pagePaths,files,maxBytes,geoResolver,allowAddressDetails:mode==='live'&&env.VISITOR_ALLOW_ADDRESSES==='true',siteLabel:env.VISITOR_SITE_LABEL?.slice(0,80)||'Visitor Analytics',siteLinks:origin?pagePaths.map(value=>({label:value,href:new URL(value,origin).href})):[],demoDirectory:path.join(root,'public/demo')};
}
