import {useEffect,useState} from 'react';
import VisitorStats from './admin/VisitorStats.jsx';
const demoSession={mode:'demo',siteLabel:'Visitor Analytics',siteLinks:[],allowAddressDetails:false,token:''};
export default function App(){
  const [session,setSession]=useState(null),[error,setError]=useState('');
  const [theme,setTheme]=useState(()=>{try{return localStorage.getItem('visitor-theme')||'light';}catch{return 'light';}});
  useEffect(()=>{document.documentElement.dataset.theme=theme;try{localStorage.setItem('visitor-theme',theme);}catch{}},[theme]);
  useEffect(()=>{if(import.meta.env.VISITOR_MODE==='demo'){setSession(demoSession);return;}const controller=new AbortController();fetch(`${import.meta.env.BASE_URL}__admin/session`,{headers:{'x-visitor-app':'1'},credentials:'same-origin',cache:'no-store',signal:controller.signal}).then(async response=>{if(response.status===404)throw new Error('本机日志接口不可用，请使用本模块的dev或preview服务器启动。');const data=await response.json();if(!response.ok)throw new Error(data.error||'本机访问授权失败');return data;}).then(setSession).catch(cause=>{if(cause.name==='AbortError')return;setError(cause.message);});return()=>controller.abort();},[]);
  return <div className="demo-shell"><header className="admin-topbar"><div><strong className="demo-brand-title">KK-Tiong_Pavelio · Visitor Analytics</strong><span>{session?.mode==='live'?'本机日志 · 只读':'真实日志 · 脱敏快照 / 2026-10-16'}</span></div><button type="button" onClick={()=>setTheme(value=>value==='dark'?'light':'dark')} aria-label={theme==='dark'?'切换浅色主题':'切换深色主题'}>{theme==='dark'?'☀ 浅色':'◐ 深色'}</button></header><main>{error?<p role="alert" className="demo-message">{error}</p>:session?<VisitorStats token={session.token} siteLabel={session.siteLabel} siteLinks={session.siteLinks} allowAddressDetails={session.allowAddressDetails} demo={session.mode==='demo'}/>:<p className="demo-message" role="status">正在载入统计模块…</p>}</main></div>;
}
