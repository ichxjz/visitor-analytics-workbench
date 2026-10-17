import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import './VisitorStats.css';
import VisitorTrend from './VisitorTrend.jsx';
import VisitorDimensionLine from './VisitorDimensionLine.jsx';
import AnimatedVisitorNumber from './AnimatedVisitorNumber.jsx';
import FloatingPanel from './FloatingPanel.jsx';
import VisitorInsights from './VisitorInsights.jsx';

const periods=[['hour','小时'],['day','天'],['week','周'],['month','月'],['year','年'],['all','全部']];
const dimensions=[['pages','按页面','page'],['channels','按来源渠道','channel'],['devices','按终端设备','device'],['regions','按国家 / 地区','location'],['browsers','按浏览器','browser'],['networks','按 IP 网段','network']];
const nav=[['overview','◫','仪表盘'],['monitor','◉','访客监测'],['traffic','↗','流量分析'],['risk','⬡','访问风控'],['settings','⚙','设置']];
const sessionPageDurationMs=50_000;
const statsDescription='基于访问日志查看页面浏览、来源、流量及会话估算；无需向站点植入跟踪脚本。';
const number=value=>Math.round(value||0).toLocaleString('zh-CN');
const dateTime=value=>value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'—';
const percent=(part,total)=>total?`${(part/total*100).toFixed(1)}%`:'0%';
const csvCell=value=>`"${String(value??'').replaceAll('"','""')}"`;
const downloadCsv=(rows,filename)=>{
  const csv='\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=filename;link.click();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
};

function MiniRanking({title,items,onSelect}){
  const maximum=Math.max(1,...items.map(item=>item.views));
  return <section className="visitor-panel visitor-ranking"><h3>{title}</h3>{items.length?items.slice(0,5).map(item=><button key={item.name} type="button" onClick={()=>onSelect?.(item)}><span>{item.name}</span><strong>{number(item.views)}</strong><i style={{width:`${item.views/maximum*100}%`}}/></button>):<p>当前日志没有可统计记录。</p>}</section>;
}

function SessionTable({sessions,total,onOpen,autoPlay=false}){
  const [page,setPage]=useState(1);
  const scrollRef=useRef(null);
  const pausedRef=useRef(false);
  const elapsedRef=useRef(0);
  const pageCount=Math.max(1,Math.ceil(sessions.length/50));
  const current=Math.min(page,pageCount);
  const visible=sessions.slice((current-1)*50,current*50);
  const first=Math.max(1,Math.min(current-3,pageCount-6));
  const pages=Array.from({length:Math.min(7,pageCount)},(_,index)=>first+index);
  useEffect(()=>{
    const node=scrollRef.current;
    if(node)node.scrollTop=0;
    elapsedRef.current=0;
  },[current]);
  useEffect(()=>{
    if(!autoPlay||!sessions.length||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return undefined;
    let frame,last=0;
    const tick=now=>{
      if(last&&!pausedRef.current&&!document.hidden){
        elapsedRef.current+=Math.min(now-last,100);
        const node=scrollRef.current;
        if(node)node.scrollTop=(node.scrollHeight-node.clientHeight)*Math.min(elapsedRef.current/sessionPageDurationMs,1);
        if(elapsedRef.current>=sessionPageDurationMs){
          elapsedRef.current=0;
          setPage(value=>value>=pageCount?1:value+1);
        }
      }
      last=now;
      frame=requestAnimationFrame(tick);
    };
    frame=requestAnimationFrame(tick);
    return ()=>cancelAnimationFrame(frame);
  },[autoPlay,pageCount,sessions.length]);
  const goToPage=value=>{elapsedRef.current=0;setPage(value);scrollRef.current?.scrollTo({top:0});};
  return <><div ref={scrollRef} className="visitor-table-scroll" onMouseEnter={()=>{pausedRef.current=true;}} onMouseLeave={()=>{pausedRef.current=false;}} onFocusCapture={()=>{pausedRef.current=true;}} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget))pausedRef.current=false;}}><table><thead><tr><th>会话 ID</th><th>来源域名</th><th>访问页面</th><th>PV</th><th>占比</th><th>设备信息</th><th>观测跨度</th><th>IP 网络段</th><th>IP 属地（估算）</th><th>访问时间</th></tr></thead><tbody>{visible.length?visible.map(row=><tr key={row.id} onClick={()=>onOpen(row)}><td><button type="button">{row.id}</button></td><td title={row.source}>{row.source}</td><td>{row.page}</td><td>{row.views}</td><td>{percent(row.views,total)}</td><td>{row.model&&row.model!=='型号未提供'?`${row.model} · `:''}{row.system} · {row.browser}{row.model==='型号未提供'?' · 型号未提供':''}</td><td>{row.observedSeconds===null?'无法判定':`${row.observedSeconds} 秒`}</td><td>{row.network||'未提供'}</td><td>{row.location||'城市未提供'}</td><td>{dateTime(row.startedAt)}</td></tr>):<tr><td colSpan="10">当前筛选范围没有可显示的会话。</td></tr>}</tbody></table></div><div className="visitor-pagination"><span>每页 50 条 · 第 {current}/{pageCount} 页 · 共 {sessions.length} 条{autoPlay?` · 自动浏览约 ${sessionPageDurationMs/1000} 秒/页，移入列表暂停`:''}</span><nav aria-label="会话分页"><button type="button" disabled={current===1} onClick={()=>goToPage(current-1)}>上一页</button>{pages.map(value=><button key={value} type="button" className={value===current?'active':''} aria-current={value===current?'page':undefined} onClick={()=>goToPage(value)}>{value}</button>)}<button type="button" disabled={current===pageCount} onClick={()=>goToPage(current+1)}>下一页</button></nav></div></>;
}

export default function VisitorStats({token,siteLabel='Visitor Analytics',siteLinks=[],allowAddressDetails=false,demo=false}){
  const [range,setRange]=useState('week'),[view,setView]=useState('overview'),[dimension,setDimension]=useState('pages');
  const [selected,setSelected]=useState(null),[detail,setDetail]=useState(null),[refresh,setRefresh]=useState(0);
  const [selectedTrend,setSelectedTrend]=useState(null),[showDimensionDrawer,setShowDimensionDrawer]=useState(false),[fullscreen,setFullscreen]=useState(false);
  const workspaceRef=useRef(null);
  useLayoutEffect(()=>{
    const element=workspaceRef.current;
    const update=()=>{
      const top=element.getBoundingClientRect().top;
      const adminHeader=document.querySelector('.admin-topbar');
      const pinnedTop=adminHeader?parseFloat(getComputedStyle(adminHeader).top)||0:0;
      const clearance=pinnedTop+(adminHeader?.getBoundingClientRect().height||0)+12;
      const availableTop=window.innerWidth<=850?clearance:Math.max(clearance,top);
      element.style.setProperty('--visitor-header-clearance',clearance+'px');
      element.style.setProperty('--visitor-frame-height',Math.max(220,Math.min(920,window.innerHeight-Math.max(12,availableTop)-18))+'px');
    };
    const headerObserver=new ResizeObserver(update);
    const adminHeader=document.querySelector('.admin-topbar');if(adminHeader)headerObserver.observe(adminHeader);
    update();window.addEventListener('resize',update);
    return()=>{window.removeEventListener('resize',update);headerObserver.disconnect();};
  },[]);
  const [storedResult,setResult]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  const result=storedResult?.range===range?storedResult:null;
  const [autoRefresh,setAutoRefresh]=useState(()=>{if(demo)return false;try{return localStorage.getItem('visitor-auto-refresh')!=='off';}catch{return true;}});
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');
    fetch(demo?`${import.meta.env.BASE_URL}demo/report-${range}.json`:`/__admin/analytics?range=${range}${refresh?'&fresh=1':''}`,{headers:{'x-admin-token':token},signal:controller.signal})
      .then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error);return data;})
      .then(data=>{
        setResult(data);
        if(data.cached)return fetch(demo?`${import.meta.env.BASE_URL}demo/report-${range}.json`:`/__admin/analytics?range=${range}&fresh=1`,{headers:{'x-admin-token':token},signal:controller.signal})
          .then(async response=>{const updated=await response.json();if(!response.ok)throw new Error(updated.error);return updated;})
          .then(updated=>{setResult(updated);setError('');})
          .catch(cause=>{if(cause.name!=='AbortError')setError(`当前显示上次成功读取的数据；线上更新失败：${cause.message}`);});
      })
      .catch(cause=>{if(cause.name!=='AbortError')setError(cause.message);})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[range,refresh,token,demo]);
  useEffect(()=>{
    setSelected(null);setSelectedTrend(null);setShowDimensionDrawer(false);setDetail(null);
    setView(current=>current==='trend'?'overview':current);
  },[range]);
  useEffect(()=>{
    if(!autoRefresh||loading)return undefined;
    let timer;
    const update=()=>{clearTimeout(timer);if(!document.hidden)setRefresh(value=>value+1);};
    if(!document.hidden)timer=window.setTimeout(update,15000);
    document.addEventListener('visibilitychange',update);
    return ()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',update);};
  },[autoRefresh,loading,range]);
  useEffect(()=>{
    const update=()=>setFullscreen(document.fullscreenElement===workspaceRef.current);
    document.addEventListener('fullscreenchange',update);
    const onKey=event=>{if(event.key==='Escape'&&!document.fullscreenElement)setFullscreen(false);};
    document.addEventListener('keydown',onKey);
    return ()=>{document.removeEventListener('fullscreenchange',update);document.removeEventListener('keydown',onKey);};
  },[]);
  useEffect(()=>{
    if(view!=='overview'||!selected)return;
    const frame=requestAnimationFrame(()=>workspaceRef.current?.querySelector('.visitor-sessions')?.scrollIntoView({behavior:'smooth',block:'nearest'}));
    return ()=>cancelAnimationFrame(frame);
  },[view,selected,showDimensionDrawer]);

  const descriptor=dimensions.find(item=>item[0]===dimension);
  const bars=result?.[dimension]||[];
  const sessions=useMemo(()=>result?.sessions||[],[result]);
  const filtered=sessions.filter(row=>(!selected||row[descriptor[2]]===selected)&&(!selectedTrend||(Date.parse(row.startedAt)>=Date.parse(selectedTrend.start)&&Date.parse(row.startedAt)<Date.parse(selectedTrend.end))));
  const observed=sessions.filter(row=>row.observedSeconds!==null);
  const averageObserved=observed.length?Math.round(observed.reduce((sum,row)=>sum+row.observedSeconds,0)/observed.length):null;
  const reset=()=>{setRange('week');setDimension('pages');setSelected(null);setSelectedTrend(null);setShowDimensionDrawer(false);setDetail(null);setView('overview');};
  const openTrend=row=>{setSelectedTrend(row);setSelected(null);setShowDimensionDrawer(false);setDetail(null);setView('trend');};
  const openRank=(dimensionId,item)=>{setView('overview');setDimension(dimensionId);setSelected(item.name);setShowDimensionDrawer(false);setDetail(null);};
  const openSession=row=>{setDetail(row);if(window.innerWidth<990)setShowDimensionDrawer(false);};
  const toggleFullscreen=async()=>{
    if(document.fullscreenElement===workspaceRef.current){await document.exitFullscreen();return;}
    if(workspaceRef.current?.requestFullscreen){try{await workspaceRef.current.requestFullscreen();return;}catch{/* In-app browser can deny fullscreen. */}}
    setFullscreen(value=>!value);
  };
  const exportRows=()=>{
    if(!result)return;
    downloadCsv([['会话 ID','来源域名','页面路径','PV','会话占比','设备','型号','观测跨度（秒）','IP 网络段','IP 属地','开始时间'],...sessions.map(row=>[row.id,row.source,row.page,row.views,percent(row.views,result.views),`${row.system} ${row.browser}`,row.model||'型号未提供',row.observedSeconds??'',row.network,row.location||'城市未提供',dateTime(row.startedAt)])],`visitor-sessions-${range}.csv`);
  };

  return <div ref={workspaceRef} className={`visitor-workspace${fullscreen?' is-fullscreen':''}`} aria-busy={loading}>
    <aside className="visitor-side"><div className="visitor-side-brand"><img className="visitor-brand-logo" src="./kk-logo.svg" alt="KK" /><strong>{siteLabel}</strong></div><nav aria-label="访客统计导航">{nav.map(([id,icon,label])=><button key={id} type="button" className={view===id||view==='trend'&&id==='monitor'?'active':''} onClick={()=>{setView(id);setSelected(null);setSelectedTrend(null);setShowDimensionDrawer(false);setDetail(null);}}><i aria-hidden="true">{icon}</i>{label}</button>)}</nav><div className="visitor-side-state"><span className="visitor-live-dot"/>站点日志 · 只读</div></aside>
    <div className="visitor-body">
      <div className="visitor-fixed-head">
      <div className="visitor-command"><div className="visitor-command-heading"><div className="visitor-command-title"><small>{siteLabel}</small><strong>{view==='trend'?'趋势详情':nav.find(item=>item[0]===view)?.[2]}</strong></div><p className="visitor-command-description">{statsDescription}</p></div><div className="visitor-command-actions"><div className="visitor-period" aria-label="统计时间范围">{periods.map(([id,label])=><button key={id} type="button" className={range===id?'active':''} aria-pressed={range===id} onClick={()=>setRange(id)}>{label}</button>)}</div><div className="visitor-top-kpi"><span>总访问量 PV <strong><AnimatedVisitorNumber value={result?.views}/></strong></span><span>独立访客 UV <strong><AnimatedVisitorNumber value={result?.visitors}/></strong></span></div><button className="visitor-reset" type="button" onClick={toggleFullscreen}>{fullscreen?'退出全屏':'⛶ 全屏'}</button><button className="visitor-reset" type="button" onClick={reset}>↺ 重置</button></div></div>
      {error&&<div className="visitor-message error" role="alert">{error}</div>}
      {loading&&!result&&<div className="visitor-message" role="status">正在读取线上访问记录…</div>}

      {result&&<div className="visitor-signal"><span><i/>数据源：{result.source}{result.cached?' · 上次结果，正在更新':''}</span>{siteLinks.length>0&&<span className="visitor-site-scope" title="同一份站点日志合并统计；UV与会话统一去重。">统计页面：{siteLinks.map(link=><a key={link.href} href={link.href} target="_blank" rel="noreferrer">{link.label}</a>)}</span>}<span>最早可读：{dateTime(result.coverageStart)}</span><span>排除自动访问 {number(result.excludedBots)}</span><span>{demo?'快照：':'更新：'}{dateTime(result.generatedAt)}{demo?' · 固定脱敏快照':autoRefresh?' · 15秒自动更新':' · 手动更新'}</span></div>}
      </div>
      <div className="visitor-scroll-content">
      {result&&<>
        {view==='traffic'&&<VisitorInsights key={range} insights={result.insights} range={range} token={token} loading={loading} fullscreen={fullscreen} allowAddressDetails={allowAddressDetails}/>}
        {view==='overview'&&<div className="visitor-content">
          <div className="visitor-overview-cards">
            <section className="visitor-panel"><small>页面浏览 PV</small><strong><AnimatedVisitorNumber value={result.views}/></strong><span>页面文档成功请求</span></section>
            <section className="visitor-panel"><small>独立访客 UV · 估算</small><strong><AnimatedVisitorNumber value={result.visitors}/></strong><span>网络地址＋浏览器信息去重</span></section>
            <section className="visitor-panel"><small>平均可观测跨度</small><strong><AnimatedVisitorNumber value={averageObserved} suffix=" 秒"/></strong><span>仅 {observed.length} 条有多次页面请求的会话</span></section>
            <section className="visitor-panel"><small>跳出率</small><strong>—</strong><span>站内板块切换不产生日志，无法准确计算</span></section>
          </div>
          <section className="visitor-panel visitor-trend"><div className="visitor-panel-heading"><div><small>TREND / OBSERVED</small><h3>访问趋势</h3></div><span>按{periods.find(item=>item[0]===range)?.[1]}查看 · 点击点阵列查看详情 · 灰色表示日志缺失</span></div><VisitorTrend rows={result.trend||[]} range={range} onSelect={openTrend}/></section>
          <section className="visitor-panel visitor-sessions"><div className="visitor-panel-heading"><div><small>SESSION / LEDGER</small><h3>会话明细 <em>{selected?`· ${selected}`:''}</em></h3></div><div className="visitor-session-actions">{selected&&<button type="button" onClick={()=>setSelected(null)}>清除筛选</button>}<span>最近 {Math.min(result.sessionLimit,result.sessionCount)} 条估算会话</span></div></div><SessionTable key={`${range}-${dimension}-${selected||'all'}`} sessions={filtered} total={result.views} onOpen={openSession} autoPlay/></section>
        </div>}
        {view==='monitor'&&<div className="visitor-content">
          <div className="visitor-monitor-top">
            <section className="visitor-panel visitor-trend"><div className="visitor-panel-heading"><div><small>TREND / OBSERVED</small><h3>访客监测趋势</h3></div><span>点击节点进入详情</span></div><VisitorTrend rows={result.trend||[]} range={range} onSelect={openTrend}/></section>
            <section className="visitor-panel visitor-chart-panel"><div className="visitor-panel-heading"><div><small>AUDIENCE / DIMENSIONS</small><h3>访客维度统计</h3></div><div className="visitor-dimensions">{dimensions.map(([id,label])=><button type="button" key={id} className={dimension===id?'active':''} onClick={()=>{setDimension(id);setSelected(null);setShowDimensionDrawer(false);setDetail(null);}}>{label}</button>)}</div></div><VisitorDimensionLine key={dimension} rows={bars} selected={selected} label={descriptor[1]} onSelect={name=>{setSelected(name);setShowDimensionDrawer(true);}}/><div className="visitor-chart-note">单列像素格表示页面浏览 PV，橙蓝渐变并按音频电平节奏跳动。地域为离线 IP 数据估算，单维度 UV 暂不提供。</div></section>
          </div>
          <div className="visitor-rank-grid"><MiniRanking title="TOP 访问页面" items={result.pages} onSelect={item=>openRank('pages',item)}/><MiniRanking title="TOP 来源渠道" items={result.channels} onSelect={item=>openRank('channels',item)}/><MiniRanking title="IP 网络段 · 完整 CIDR 前缀" items={result.networks} onSelect={item=>openRank('networks',item)}/></div>
        </div>}
        {view==='trend'&&selectedTrend&&<div className="visitor-content"><section className="visitor-panel visitor-trend-detail"><button type="button" className="visitor-action" onClick={()=>{setView('overview');setSelectedTrend(null);}}>← 返回访问趋势</button><small>TREND / DATE DETAILS</small><h3>{selectedTrend.label} · 访问详情</h3><div className="visitor-trend-detail-kpis"><span>页面浏览 PV <strong>{number(selectedTrend.views)}</strong></span><span>独立访客 UV · 估算 <strong>{number(selectedTrend.visitors)}</strong></span></div><p>{dateTime(selectedTrend.start)} 至 {dateTime(selectedTrend.end)} · 仅统计可读取日志。</p></section><section className="visitor-panel visitor-sessions"><div className="visitor-panel-heading"><div><small>SESSION / LEDGER</small><h3>该时间段会话明细</h3></div><span>会话起始时间在该时间段内 · 每页 50 条</span></div><SessionTable key={selectedTrend.start} sessions={filtered} total={result.views} onOpen={openSession}/></section></div>}
        {view==='risk'&&<div className="visitor-content"><div className="visitor-risk-grid"><section className="visitor-panel"><small>自动访问请求</small><strong>{number(result.excludedBots)}</strong><span>按 User-Agent 规则排除，可能有误判</span></section><section className="visitor-panel"><small>高频估算会话</small><strong>{number(result.highFrequency)}</strong><span>5 分钟内至少 20 次页面请求</span></section></div><div className="visitor-rank-grid"><MiniRanking title="IP 网络段 · 完整 CIDR 前缀" items={result.networks} onSelect={item=>openRank('networks',item)}/><section className="visitor-panel visitor-risk-status"><h3>IP 规则管理</h3><p>当前后台只有受限的访问日志读取权限。封禁、白名单和事件审计需要在服务器侧接入可回滚的规则引擎；这里不会显示一个实际不生效的“封禁”按钮。</p><div className="visitor-risk-note">状态：监测可用 · 服务器防护规则未接入</div></section></div><section className="visitor-panel visitor-risk-status"><h3>风控事件</h3><p>可识别爬虫 {number(result.excludedBots)} 次；高频估算会话 {number(result.highFrequency)} 条。现有日志不记录拦截动作，因此没有可核对的封禁事件。</p></section></div>}
        {view==='settings'&&<div className="visitor-content visitor-settings"><section className="visitor-panel"><h3>数据读取</h3><label className="visitor-setting"><span><strong>自动刷新统计</strong><small>{demo?'当前为固定脱敏快照，不连接原站实时日志':'前台可见时每15秒更新一次，读取中不重复请求；回到页面立即更新'}</small></span><input type="checkbox" checked={autoRefresh} disabled={demo} onChange={event=>{setAutoRefresh(event.target.checked);try{localStorage.setItem('visitor-auto-refresh',event.target.checked?'on':'off');}catch{}}}/></label><button className="visitor-action" type="button" disabled={loading} onClick={()=>setRefresh(value=>value+1)}>{demo?'重新读取快照':'立即刷新日志'}</button></section><section className="visitor-panel"><h3>隐私与保留</h3><p>{demo?'当前演示读取脱敏真实日志快照；':'当前模式只读取本机显式配置的日志文件；'}会话 ID 为临时编号，常规报表显示 CIDR 网络段。{allowAddressDetails?'完整客户端地址仅在流量分析中按需临时读取，离开或切换筛选后清除。':'当前模式禁用完整客户端地址查询。'}当前后台不向前台增加跟踪脚本或 Cookie。</p><p>日志保留周期由服务器轮转策略决定；本页只读取显式配置且可访问的文件，不能修改服务器保留期或关闭服务器访问日志。</p><p>设备信息来自日志中的 User-Agent 和浏览器主动提供的型号提示；浏览器未提供型号时无法识别。是否停止采集需修改服务器日志配置。</p></section><section className="visitor-panel"><h3>数据导出</h3><p>导出当前范围内最多 {result.sessionLimit} 条估算会话，包含网络段，不含完整访客 IP、原始 User-Agent 或来源 URL 查询参数。</p><button className="visitor-action" type="button" onClick={exportRows}>导出 CSV 报表</button></section></div>}
        <p className="visitor-method">{result.sessionMethod} {result.coverageNote} 「全部」只表示全部可读取日志。UV 为估算值；访问时长、跳出率无法由当前日志准确提供。{result.locationMethod}</p>
      </>}
      </div>
    </div>
    {selected&&showDimensionDrawer&&view==='monitor'&&<FloatingPanel className="visitor-drawer" label={`${selected} 会话详情`}><div className="visitor-drawer-head"><div><small>DIMENSION DETAILS</small><h3>{selected}</h3></div><button type="button" onClick={()=>setShowDimensionDrawer(false)} aria-label="关闭维度详情">×</button></div><p>{filtered.length} 条可读会话 · 总量可能受最近 {result?.sessionLimit} 条上限影响</p><SessionTable key={`drawer-${range}-${selected}`} sessions={filtered} total={result?.views||0} onOpen={openSession}/></FloatingPanel>}
    {detail&&<FloatingPanel className="visitor-detail" label="单条访客会话详情" placement={showDimensionDrawer&&selected?"left":"right"}><div className="visitor-drawer-head"><div><small>SESSION DETAILS</small><h3>{detail.id}</h3></div><button type="button" onClick={()=>setDetail(null)} aria-label="关闭会话详情">×</button></div><dl>{[['来源域名',detail.source],['页面路径',detail.page],['PV 计数',detail.views],['会话占比',percent(detail.views,result?.views||0)],['设备',`${detail.device} · ${detail.model||'型号未提供'} · ${detail.system} · ${detail.browser}`],['观测跨度',detail.observedSeconds===null?'无法判定':`${detail.observedSeconds} 秒`],['IP 网络段',detail.network],['IP 属地',detail.location||'城市未提供'],['访问时间',dateTime(detail.startedAt)]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><p>来源 URL 的路径与查询参数未输出；观测跨度不等于实际停留时长。</p></FloatingPanel>}
  </div>;
}
