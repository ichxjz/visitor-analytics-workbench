import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import './VisitorInsights.css';
import VisitorRotatingTable from './VisitorRotatingTable.jsx';
import VisitorRegionGlobe from './VisitorRegionGlobe.jsx';
import VisitorFlowGraph from './VisitorFlowGraph.jsx';
import { matchesFlowSelection } from './visitorFlowGraph.js';

const PAGES = [['regions', '地区详情'], ['flows', '规则链路'], ['associations', '域名 / IP 关联'], ['domains', '热门域名']];
const UNKNOWN_DOMAIN = '未记录访问域名';
const EMPTY_FILTERS = { domain: '', network: '', region: '', source: '' };
const EMPTY_ADDRESSES = { status: 'idle', items: [] };
const CAPABILITY_LABELS = { requestHost: '访问域名 Host', referrer: '来源 Referer', responseBytes: '响应正文流量', requestBytes: '请求体积', region: '地区估算', rules: '实际规则', upstreams: '上游', clientAddresses: '日志客户端地址' };
const asRows = value => Array.isArray(value) ? value : [];
const hasNumber = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const numeric = value => hasNumber(value) ? Math.max(0, Number(value)) : 0;
const count = value => hasNumber(value) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(Number(value)) : '—';
const text = (value, fallback = '未记录') => typeof value === 'string' && value.trim() ? value : typeof value === 'number' ? String(value) : fallback;
const bytes = value => {
  if (!hasNumber(value)) return '未记录';
  const amount = Math.max(0, Number(value));
  const unit = amount >= 1024 ** 3 ? 3 : amount >= 1024 ** 2 ? 2 : amount >= 1024 ? 1 : 0;
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: unit ? 1 : 0 }).format(amount / 1024 ** unit)} ${['B', 'KiB', 'MiB', 'GiB'][unit]}`;
};
const dateTime = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '未记录';
const matches = (row, filters, includeNetwork = true) => (!filters.domain || row.domain === filters.domain) && (!filters.region || row.region === filters.region) && (!filters.source || row.source === filters.source) && (!includeNetwork || !filters.network || row.network === filters.network);
const sorted = (rows, metric) => [...rows].sort((a, b) => Number(hasNumber(b[metric]))-Number(hasNumber(a[metric])) || numeric(b[metric]) - numeric(a[metric]) || text(a.name).localeCompare(text(b.name), 'zh-CN'));
const ruleName = value => {
  const exact = { 'guard:hidden-path': '隐藏文件访问保护', 'guard:private-path': '后台与源码路径保护', 'proxy:earth': '地理查询代理', 'proxy:orbits': '卫星轨道代理', 'redirect:https': 'HTTPS 跳转' };
  if (exact[value]) return exact[value];
  if (value.startsWith('guard:retired')) return '旧地址停用';
  if (value.startsWith('static:')) return '静态资源分发';
  if (value.startsWith('redirect:') || value.startsWith('server:') && value.endsWith('.www-redirect')) return '域名与地址跳转';
  if (value.startsWith('server:') && value.endsWith('.default-reject')) return '默认站点保护';
  if (value.startsWith('server:https')) return '站点 HTTPS 服务';
  if (value.startsWith('server:http')) return '站点 HTTP 服务';
  return /[\u3400-\u9fff]/.test(value) ? value : '已记录规则';
};

function Empty({ children = '当前范围暂无可读取记录。' }) {
  return <div className="vi-empty">{children}</div>;
}

function Coverage({ type, rows, limits, summary }) {
  const omitted = limits?.omitted?.[type];
  const covered = rows.reduce((sum, row) => sum + numeric(row.requests), 0);
  return <p className="vi-note vi-coverage">已提供 {count(rows.length)} 组{hasNumber(limits?.[type]) ? `，最多保留 ${count(limits[type])} 组` : ''} · 覆盖 {count(covered)} / {count(summary?.requests)} 次请求。{numeric(omitted) > 0 ? `另有 ${count(omitted)} 组未展示；筛选与链路仅覆盖已提供的聚合。` : '筛选与链路以服务端返回的聚合范围为准。'}</p>;
}

function RecordFacts({ fields }) {
  return <dl className="vi-facts">{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

function CapabilityDetails({ capabilities = {}, fullscreen = false }) {
  const rows=Object.entries(CAPABILITY_LABELS).map(([key,label])=>{
    const item=capabilities[key];
    return {key,label,status:item?.status||'missing',observed:item?`${count(item.observedRequests)} / ${count(item.totalRequests)}`:'未记录',note:item?.note||'当前日志未提供该字段。'};
  });
  const columns=[{key:'label',label:'记录字段',render:value=><strong>{value}</strong>},{key:'status',label:'记录情况',render:value=><span className={`vi-availability is-${value}`}>{value==='available'?'已记录':value==='partial'?'部分记录':'未记录'}</span>},{key:'observed',label:'请求覆盖'},{key:'note',label:'说明'}];
  return <details className="vi-capabilities" open={fullscreen}><summary>数据口径与日志覆盖</summary>
    <p>请求统计包含静态资源、错误和自动访问，与仪表盘页面浏览 PV 的口径不同。响应正文流量取日志 bytesSent，不等于含响应头、TLS 的网络账单；地区由可配置适配器估算；未配置时显示未知。</p>
    <div className="vi-capability-list"><VisitorRotatingTable rows={rows} columns={columns} rowKey="key" label="日志覆盖记录列表" maxHeight={180}/></div>
  </details>;
}

export default function VisitorInsights({ insights, range, token, loading = false, fullscreen = false, allowAddressDetails = false }) {
  const id = useId();
  const heading = useRef(null);
  const regionLayout=useRef(null);
  const controller = useRef(null);
  const [page, setPage] = useState('regions');
  const [domainKind, setDomainKind] = useState('domains');
  const [top, setTop] = useState(10);
  const [regionMetric, setRegionMetric] = useState('requests');
  const [hovered, setHovered] = useState(null);
  const [focused, setFocused] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [regionCountry,setRegionCountry]=useState('');
  const [flowSelection,setFlowSelection]=useState(null);
  const [flowDetail,setFlowDetail]=useState(null);
  const [addresses, setAddresses] = useState(EMPTY_ADDRESSES);

  const domains = asRows(insights?.domains);
  const referrers = asRows(insights?.referrerDomains);
  const regions = asRows(insights?.regions);
  const associations = asRows(insights?.associations);
  const flows = asRows(insights?.flows);
  const summary = insights?.summary || {};
  const domainRows = sorted(domainKind === 'domains' ? domains : referrers, 'bytesSent').slice(0, top);
  const regionRows = sorted(regions, regionMetric);
  const selectedDomain = domainRows.find(row => row.name === (focused || hovered));
  const filteredAssociations = useMemo(() => asRows(insights?.associations).filter(row => matches(row, filters)), [insights, filters]);
  const filteredFlows = useMemo(() => asRows(insights?.flows).filter(row => matches(row, filters, false)), [insights, filters]);
  const selectedFilters = Object.entries(filters).filter(([, value]) => value);
  const filterLabels = { domain: '访问域名', network: '网络段', region: '地区', source: '来源' };
  const options = useMemo(() => {
    const union = [...asRows(insights?.associations), ...asRows(insights?.flows)];
    const unique = (key, other = []) => [...new Set([...union.map(row => row[key]), ...other].filter(value => typeof value === 'string' && value))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    return { domain: unique('domain', asRows(insights?.domains).map(row => row.name)), network: unique('network'), region: unique('region', asRows(insights?.regions).map(row => row.name)), source: unique('source', asRows(insights?.referrerDomains).map(row => row.name)) };
  }, [insights]);

  // A new scope hides the old response during render, before effect cleanup.
  // Neither full addresses nor the token are stored in URLs or persistence.
  const addressScope = useMemo(() => ({ range, token, page, filters, insights }), [range, token, page, filters, insights]);
  const visibleAddresses = addresses.scope === addressScope && page === 'associations' ? addresses : EMPTY_ADDRESSES;
  const unknownDomain = filters.domain === UNKNOWN_DOMAIN;
  useEffect(() => {
    if (controller.current?.scope !== addressScope) controller.current?.request.abort();
    setAddresses(current => current.scope === addressScope ? current : EMPTY_ADDRESSES);
    return () => { if (controller.current?.scope === addressScope) controller.current.request.abort(); };
  }, [addressScope]);
  useEffect(() => {setHovered(null);setFocused(null);setFlowSelection(null);setFlowDetail(null);}, [range,page,filters,domainKind,insights]);

  const navigate = (next, patch) => {
    if(patch)setFilters({...EMPTY_FILTERS,...patch});
    else if(next==='regions'||next==='domains')setFilters(EMPTY_FILTERS);
    else if(next==='flows')setFilters(current=>({...current,network:''}));
    setPage(next);
    requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }));
  };
  const changeFilter = (key, value) => setFilters(current => ({ ...current, [key]: value }));
  const hideAddresses = () => { controller.current?.request.abort(); setAddresses(EMPTY_ADDRESSES); };
  const loadAddresses = async () => {
    if (!allowAddressDetails || !token || controller.current?.scope === addressScope && !controller.current.request.signal.aborted && visibleAddresses.status === 'loading') return;
    controller.current?.request.abort();
    const request = new AbortController();
    const scope = addressScope;
    controller.current = { request, scope };
    setAddresses({ status: 'loading', items: [], scope });
    const query = new URLSearchParams({ range: String(range || 'week') });
    for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
    try {
      const response = await fetch(`/__admin/analytics/addresses?${query}`, { headers: { 'x-admin-token': token, Accept: 'application/json' }, cache: 'no-store', credentials: 'same-origin', signal: request.signal });
      if (!response.ok) {
        const message = response.status === 401 || response.status === 403 ? '后台授权已失效，请重新载入后台后重试。' : response.status === 503 ? '暂时无法读取客户端地址，请稍后重试。' : '客户端地址读取失败，请重试。';
        throw new Error(message);
      }
      const result = await response.json();
      if (!Array.isArray(result.items)) throw new Error('返回数据不完整，请重新读取。');
      if (!request.signal.aborted) setAddresses({ ...result, status: 'ready', items: result.items, scope });
    } catch (error) {
      if (!request.signal.aborted) setAddresses({ status: 'error', items: [], scope, error: error.name === 'TypeError' ? '网络连接中断，请稍后重试。' : error.name === 'SyntaxError' ? '返回数据格式有误，请重新读取。' : error.message || '暂时无法读取客户端地址，请重试。' });
    }
  };


  const exactScope=row=>({domain:row.domain||'',region:row.region||'',network:row.network||'',source:row.source||''});
  const associationColumns=[
    {key:'domain',label:'访问域名',render:value=><strong>{text(value,UNKNOWN_DOMAIN)}</strong>},
    {key:'network',label:'IP 网络段'},
    {key:'region',label:'地区估算'},
    {key:'source',label:'来源域名'},
    {key:'requests',label:'请求',render:count},
    {key:'bytesSent',label:'响应流量',render:bytes},
  ];
  const addressColumns=[
    {key:'ip',label:'客户端 IP',render:value=><strong className="vi-mono">{value}</strong>},
    {key:'region',label:'地区估算'},
    {key:'domains',label:'关联域名',render:value=>asRows(value).join('、')||UNKNOWN_DOMAIN,title:value=>asRows(value).join('、')},
    {key:'requests',label:'请求',render:count},
    {key:'bytesSent',label:'响应流量',render:bytes},
    {key:'lastSeen',label:'最近请求',render:dateTime},
  ];
  const regionData=regionRows.filter(row=>!regionCountry||row.name.split(/\s*·\s*/)[0]===regionCountry);
  useLayoutEffect(()=>{
    const layout=regionLayout.current;if(!layout)return;
    const stage=layout.querySelector('.vi-region-globe-stage'),data=layout.querySelector('.vi-region-data'),viewport=data?.querySelector('.vrt-scroll');
    if(!stage||!data||!viewport)return;
    const align=()=>{
      const parallel=data.getBoundingClientRect().x>stage.getBoundingClientRect().right;
      const height=parallel?Math.min(258,Math.max(150,stage.getBoundingClientRect().height-60)):258;
      layout.style.setProperty('--vi-region-list-height',height+'px');
      const prior=parseFloat(layout.style.getPropertyValue('--vi-region-data-offset'))||0;
      const globe=stage.getBoundingClientRect(),list=viewport.getBoundingClientRect();
      const offset=parallel?Math.max(0,Math.min(180,globe.y+globe.height/2-(list.y+list.height/2)+prior)):0;
      if(Math.abs(prior-offset)>.5)layout.style.setProperty('--vi-region-data-offset',offset+'px');
    };
    const observer=new ResizeObserver(align);observer.observe(stage);observer.observe(data);observer.observe(viewport);align();
    return()=>observer.disconnect();
  },[page,regionCountry,insights]);
  const regionColumns=[
    {key:'name',label:'地区',render:value=><strong>{value}</strong>},
    {key:'requests',label:'请求',render:count},
    {key:'bytesSent',label:'响应流量',render:bytes},
    {key:'visitors',label:'访客估算',render:count},
  ];
  const flowData=flowSelection?filteredFlows.filter(row=>matchesFlowSelection(row,flowSelection)):filteredFlows;
  const flowColumns=[
    {key:'source',label:'来源'}, {key:'domain',label:'访问域名'},
    {key:'path',label:'请求路径'}, {key:'status',label:'HTTP',render:value=>value??'未记录'},
    {key:'requests',label:'请求',render:count}, {key:'bytesSent',label:'响应流量',render:bytes},
  ];
  const filterControls=<div className="vi-filter-grid">{['domain','region',...(page==='associations'?['network']:[]),'source'].map(key=><label key={key}>{filterLabels[key]}<select aria-label={`筛选${filterLabels[key]}`} value={filters[key]} onChange={event=>changeFilter(key,event.target.value)}><option value="">全部{filterLabels[key]}</option>{(filters[key]&&!options[key].includes(filters[key])?[filters[key],...options[key]]:options[key]).map(value=><option value={value} key={value}>{value}</option>)}</select></label>)}</div>;

  return <section className="visitor-insights vi-compact" aria-label="流量分析" aria-busy={loading}>
    <div className="vi-section-toolbar"><div className="vi-heading"><div><small>TRAFFIC / INSIGHTS</small><h3 ref={heading} tabIndex={-1}>{PAGES.find(([value])=>value===page)?.[1]}</h3></div>{loading&&<span className="vi-updating" role="status">更新中…</span>}</div><nav className="vi-navigation" aria-label="流量分析子页面">{PAGES.map(([value,label])=><button key={value} type="button" aria-current={page===value?'page':undefined} aria-controls={`${id}-content`} onClick={()=>navigate(value)}>{label}</button>)}</nav></div>
    {!insights?<Empty>{loading?'正在读取流量分析…':'当前尚无流量分析数据，请重新加载访客统计。'}</Empty>:<>
      <div className="vi-summary">{[['请求总数',count(summary.requests)],['响应正文流量',bytes(summary.bytesSent)],['页面文档请求',count(summary.viewRequests)],['请求体积',bytes(summary.requestBytes)]].map(([label,value])=><div key={label}><small>{label}</small><strong>{value}</strong></div>)}</div>
      {selectedFilters.length>0&&<div className="vi-filter-context"><span>关联筛选</span>{selectedFilters.map(([key,value])=><button type="button" key={key} onClick={()=>changeFilter(key,'')} aria-label={`清除${filterLabels[key]}筛选：${value}`}>{filterLabels[key]}：{value}<span aria-hidden="true"> ×</span></button>)}<button type="button" onClick={()=>setFilters(EMPTY_FILTERS)}>清除全部</button></div>}
      <div id={`${id}-content`} className="vi-content">
        {page==='domains'&&<section className="vi-panel vi-domain-panel">
          <div className="vi-panel-head"><div><h4>按流量排名的热门域名</h4><p>响应正文流量 · 点击域名查看关联</p></div><div className="vi-controls"><div className="vi-segment" aria-label="域名统计类型">{[['domains','访问域名'],['referrerDomains','来源域名']].map(([value,label])=><button type="button" key={value} aria-pressed={domainKind===value} onClick={()=>{setDomainKind(value);setHovered(null);setFocused(null);}}>{label}</button>)}</div><label className="vi-top">展示<select aria-label="排行条数" value={top} onChange={event=>setTop(Number(event.target.value))}>{[10,20,50,100].map(value=><option key={value} value={value}>Top {value}</option>)}</select></label></div></div>
          {domainKind==='referrerDomains'&&<p className="vi-note">按请求来源归因，不代表向来源网站传输的流量。</p>}
          <div className="vi-domain-plot">
            <div key={`${range}-${domainKind}-${top}-${summary.requests}-${summary.bytesSent}`} className="vi-ranking" role="group" aria-label="域名流量进度图">
              {domainRows.length?domainRows.map((row,index)=><button className="vi-rank-row" type="button" key={`${row.name}-${index}`} style={{'--rank-delay':`${Math.min(index,8)*24}ms`,'--rank-index':index%4}} onMouseEnter={()=>setHovered(row.name)} onMouseLeave={()=>setHovered(null)} onFocus={()=>setFocused(row.name)} onBlur={()=>setFocused(null)} onClick={()=>navigate('associations',domainKind==='domains'?{domain:row.name}:{source:row.name})} aria-label={`${text(row.name)}，${count(row.requests)} 次请求，响应流量 ${bytes(row.bytesSent)}，查看关联`}><span className="vi-rank-label" title={row.name}>{text(row.name)}</span><span className="vi-bar-track" aria-hidden="true"><i style={{width:`${numeric(domainRows[0]?.bytesSent)?numeric(row.bytesSent)/numeric(domainRows[0].bytesSent)*100:0}%`}}/></span><span className="vi-rank-value"><strong>{bytes(row.bytesSent)}</strong></span></button>):<Empty>{domainKind==='domains'&&numeric(summary.unknownHostRequests)>0?<>旧日志未记录访问域名。<button type="button" className="vi-link" onClick={()=>navigate('associations',{domain:UNKNOWN_DOMAIN})}>查看未知域名关联 →</button></>:'当前范围没有域名记录。'}</Empty>}
            </div>
            {selectedDomain&&<aside className="vi-rank-inspector vi-domain-tooltip" aria-label="域名流量明细" role="status"><h4>{selectedDomain.name}</h4><RecordFacts fields={[[domainKind==='domains'?'访问请求':'归因请求',count(selectedDomain.requests)],['响应正文流量',bytes(selectedDomain.bytesSent)],['请求体积',bytes(selectedDomain.requestBytes)]]}/></aside>}
          </div>
          {!!domainRows.length&&<div className="vi-axis" aria-hidden="true">{[0,.25,.5,.75,1].map(value=><span key={value}>{bytes(numeric(domainRows[0]?.bytesSent)*value)}</span>)}</div>}
          <details className="vi-coverage-detail"><summary>查看排行覆盖范围{summary.unknownHostRequests?` · ${count(summary.unknownHostRequests)} 次请求未记录访问域名`:''}</summary><Coverage type={domainKind==='domains'?'domains':'referrerDomains'} rows={domainKind==='domains'?domains:referrers} limits={insights.limits} summary={summary}/></details>
        </section>}

        {page==='regions'&&<section className="vi-panel vi-region-panel"><div className="vi-panel-head"><div><h4>地区访问分布</h4><p>高亮有记录的国家或地区 · 悬停查看，点击关联数据</p></div><div className="vi-segment" aria-label="地区排序指标">{[['requests','请求数'],['bytesSent','响应流量']].map(([value,label])=><button type="button" key={value} aria-pressed={regionMetric===value} onClick={()=>setRegionMetric(value)}>{label}</button>)}</div></div>
          <div ref={regionLayout} className="vi-region-layout"><VisitorRegionGlobe regions={regions} selectedCountry={regionCountry} onSelectCountry={country=>setRegionCountry(country)}/><div className="vi-region-data"><div className="vi-region-title"><strong>{regionCountry||'全部地区'}</strong>{regionCountry&&<button className="vi-link" type="button" onClick={()=>setRegionCountry('')}>返回全部地区</button>}</div><p className="vi-note" role="status">{count(regionData.length)} 个地区 · 点击行查看域名 / IP 关联</p><VisitorRotatingTable rows={regionData} columns={regionColumns} rowKey="name" label="地区数据列表" maxHeight={258} pageSize={50} onRowClick={row=>navigate('associations',{region:row.name})} onAction={row=>navigate('flows',{region:row.name})} actionLabel="规则链路"/></div></div>
          <details className="vi-coverage-detail"><summary>地区估算与覆盖说明</summary><p className="vi-note">国家高亮仅根据已记录地区与可核对边界匹配；不表示精确访客位置。无法匹配的地区保留在列表中。</p><Coverage type="regions" rows={regions} limits={insights.limits} summary={summary}/></details>
        </section>}

        {page==='associations'&&<section className="vi-panel vi-association-panel"><div className="vi-panel-head"><div><h4>{visibleAddresses.status==='ready'?'客户端 IP 地址':'域名与 IP 网络段'}</h4><p>按当前筛选交集查看 · 点击网络段记录进入链路</p></div><div className="vi-controls">{visibleAddresses.status!=='idle'&&<button type="button" className="vi-button" onClick={hideAddresses}>{visibleAddresses.status==='loading'?'取消读取':'收起并清除地址'}</button>}<button type="button" className="vi-button is-primary" title={allowAddressDetails?'临时读取当前日志精确客户端地址':'公开演示已禁用精确IP；本机模式需显式授权开启'} disabled={!allowAddressDetails||!token||loading||visibleAddresses.status==='loading'} onClick={loadAddresses}>{visibleAddresses.status==='loading'?'正在读取…':visibleAddresses.status==='error'?'重试读取地址':visibleAddresses.status==='ready'?'重新读取地址':allowAddressDetails?'读取客户端地址':'当前模式禁用精确IP'}</button></div></div>
          <details className="vi-compact-filters"><summary>筛选域名、地区、网络段与来源</summary>{filterControls}</details>
          {unknownDomain&&<p className="vi-note">仅匹配未记录访问域名的请求，不混入已知域名。</p>}
          {visibleAddresses.status==='error'&&<p className="vi-address-error" role="alert">{visibleAddresses.error}</p>}
          {visibleAddresses.status==='ready'?<><p className="vi-note" role="status">{count(visibleAddresses.totalAddresses)} 个匹配地址 · {count(visibleAddresses.matchedRequests)} 次请求{visibleAddresses.truncated?' · 已截断，仅展示返回地址':''} · 离页或筛选后清除</p><VisitorRotatingTable rows={visibleAddresses.items} columns={addressColumns} rowKey="ip" label="客户端地址列表" maxHeight={264} emptyText="没有符合当前筛选的客户端地址。"/></>:<VisitorRotatingTable rows={filteredAssociations} columns={associationColumns} rowKey={row=>JSON.stringify([row.domain,row.network,row.region,row.source])} label="域名 IP 关联列表" maxHeight={264} onRowClick={row=>navigate('flows',{...exactScope(row),network:''})} onAction={row=>setFilters(exactScope(row))} actionLabel="筛选此关联"/>}
          <details className="vi-coverage-detail"><summary>关联范围与地址隐私</summary><p className="vi-note">完整客户端地址只在本机授权页面按需读取，不写入浏览器存储或脱敏快照；切换范围、筛选或离开后清除。</p><Coverage type="associations" rows={associations} limits={insights.limits} summary={summary}/></details>
        </section>}

        {page==='flows'&&<section className="vi-panel vi-flow-panel"><div className="vi-panel-head"><div><h4>规则链路流向</h4><p>来源 → 访问域名 → 页面 → 实际最终规则 → 响应结果</p></div><details className="vi-compact-filters"><summary>筛选链路</summary>{filterControls}</details></div>
          <VisitorFlowGraph rows={filteredFlows} selected={flowSelection} onSelect={selection=>{setFlowSelection(selection&&Object.keys(selection).length?selection:null);setFlowDetail(null);}}/>
          {flowSelection&&<div className="vi-flow-selection"><div className="vi-region-title"><strong>选中节点 · {count(flowData.length)} 组关联</strong><button className="vi-link" type="button" onClick={()=>{setFlowSelection(null);setFlowDetail(null);}}>清除节点选择</button></div><VisitorRotatingTable rows={flowData} columns={flowColumns} rowKey="id" label="链路关联明细" maxHeight={170} onRowClick={row=>setFlowDetail(row)}/></div>}
          {flowDetail&&<aside className="vi-flow-facts"><div className="vi-region-title"><strong>请求链路详情</strong><button className="vi-link" type="button" onClick={()=>setFlowDetail(null)}>收起详情</button></div><RecordFacts fields={[["地区",flowDetail.region],["来源",flowDetail.source],["页面",flowDetail.path],["记录规则",asRows(flowDetail.rules).length?flowDetail.rules.map(rule=>`${ruleName(String(rule))} (${rule})`).join(' → '):'未记录'],["实际上游",asRows(flowDetail.upstreams).join(' → ')||'未记录'],["响应",flowDetail.status??'未记录']]}/></aside>}
          <details className="vi-coverage-detail"><summary>链路记录与覆盖范围</summary><p className="vi-note">图中规则是日志实际最终处理节点，不代表完整 WAF 历史。流光表示链路方向，不是每一个真实请求的即时重放。</p><Coverage type="flows" rows={flows} limits={insights.limits} summary={summary}/></details>
        </section>}
      </div>
      <CapabilityDetails capabilities={insights.capabilities} fullscreen={fullscreen}/>
    </>}
  </section>;
}
