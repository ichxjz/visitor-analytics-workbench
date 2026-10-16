import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { buildVisitorFlowGraph, FLOW_GRAPH_SIZE, matchesFlowSelection } from './visitorFlowGraph.js';
import './VisitorFlowGraph.css';

const count = value => new Intl.NumberFormat('zh-CN', {maximumFractionDigits: 0}).format(value);
const bytes = value => {
  if (value === null || value === undefined) return '流量未记录';
  const unit = value >= 1024 ** 3 ? 3 : value >= 1024 ** 2 ? 2 : value >= 1024 ? 1 : 0;
  return `${new Intl.NumberFormat('zh-CN', {maximumFractionDigits: unit ? 1 : 0}).format(value / 1024 ** unit)} ${['B', 'KiB', 'MiB', 'GiB'][unit]}`;
};
const intersects = (first, second) => first && second && [...first].some(value => second.has(value));

function useGraphMotion(ref) {
  const [running, setRunning] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof window === 'undefined') return undefined;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let inView = !('IntersectionObserver' in window);
    const update = () => setRunning(inView && !document.hidden && !media.matches);
    const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {inView = entries.some(entry => entry.isIntersecting); update();}, {threshold: 0}) : null;
    observer?.observe(element);
    document.addEventListener('visibilitychange', update);
    media.addEventListener?.('change', update);
    update();
    return () => {observer?.disconnect(); document.removeEventListener('visibilitychange', update); media.removeEventListener?.('change', update);};
  }, [ref]);
  return running;
}

export default function VisitorFlowGraph({ rows = [], onSelect, selected }) {
  const id = useId(), root = useRef(null), buttons = useRef(new Map());
  const graph = useMemo(() => buildVisitorFlowGraph(rows), [rows]);
  const [hovered, setHovered] = useState(null), [focused, setFocused] = useState(null), [local, setLocal] = useState(null);
  const selection = selected === undefined ? local : selected;
  const running = useGraphMotion(root), nodes = graph.columns.flatMap(column => column.nodes);
  const active = nodes.find(node => node.id === focused) || nodes.find(node => node.id === hovered) || null;
  const selectedRows = useMemo(() => selection && Object.keys(selection).length ? new Set(graph.rows.flatMap((row, index) => matchesFlowSelection(row, selection) ? [index] : [])) : null, [graph, selection]);
  const activeRows = active?.rowIndexes || selectedRows;
  const select = node => {setLocal(node.selection); onSelect?.(node.selection);};
  const moveFocus = (event, node) => {
    const column = graph.columns[node.stage], index = column.nodes.indexOf(node);
    let next;
    if (event.key === 'ArrowDown') next = column.nodes[(index + 1) % column.nodes.length];
    else if (event.key === 'ArrowUp') next = column.nodes[(index - 1 + column.nodes.length) % column.nodes.length];
    else if (event.key === 'Home') next = column.nodes[0];
    else if (event.key === 'End') next = column.nodes.at(-1);
    else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const other = graph.columns[node.stage + (event.key === 'ArrowRight' ? 1 : -1)];
      next = other?.nodes.filter(item => intersects(item.rowIndexes, node.rowIndexes)).reduce((best, item) => !best || Math.abs(item.y - node.y) < Math.abs(best.y - node.y) ? item : best, null);
    } else if (event.key === 'Escape') {setLocal(null); setHovered(null); onSelect?.({});}
    if (next) {event.preventDefault(); buttons.current.get(next.id)?.focus();}
  };
  const pressed = node => selection && Object.hasOwn(selection, node.key) && JSON.stringify(selection[node.key]) === JSON.stringify(node.selection[node.key]);

  if (!graph.rows.length) return <div ref={root} className="visitor-flow-graph vfg-empty" role="status">当前范围暂无可视化链路。日志记录到请求后将在此显示。</div>;

  return <div ref={root} className={`visitor-flow-graph${running ? ' is-running' : ''}`}>
    <div className="vfg-caption"><span><strong>{count(graph.requests)}</strong> 次请求 · {bytes(graph.bytesSent)}</span><span>点击节点查看匹配记录 <span className="vfg-mobile-hint">· 左右滑动查看全图</span></span></div>
    <div className="vfg-scroll" tabIndex={0} role="region" aria-label="请求链路流向图，可横向滚动" aria-describedby={`${id}-help`}>
      <div className="vfg-canvas">
        <svg className="vfg-links" viewBox={`0 0 ${FLOW_GRAPH_SIZE.width} ${FLOW_GRAPH_SIZE.height}`} preserveAspectRatio="none" aria-hidden="true">
          {graph.links.map((link, index) => {
            const related = !activeRows || intersects(link.rowIndexes, activeRows);
            return <g key={link.id} className={`vfg-link vfg-stage-${link.stage}${related ? ' is-related' : ' is-dimmed'}`}>
              <path className="vfg-line" d={link.path} strokeWidth={link.width} vectorEffect="non-scaling-stroke"/>
              <path className="vfg-spark" d={link.path} pathLength="100" strokeWidth="2" strokeDasharray="1 19" vectorEffect="non-scaling-stroke" style={{animationDelay: `${-index * .137}s`}}/>
            </g>;
          })}
        </svg>
        {graph.columns.map((column, stage) => <section key={column.key} className={`vfg-column vfg-stage-${stage}`} style={{left: `${stage * 20}%`}} aria-label={column.label}>
          <h5>{column.label}</h5>
          {column.nodes.map(node => {
            const related = !activeRows || intersects(node.rowIndexes, activeRows);
            const fullValue = node.other ? `${node.values.slice(0, 6).map(value => value === null ? '未记录' : value).join('、')}${node.values.length > 6 ? ` 等 ${node.values.length} 项` : ''}` : node.value ?? '未记录';
            return <button key={node.id} ref={element => {if (element) buttons.current.set(node.id, element); else buttons.current.delete(node.id);}} type="button" className={`vfg-node${node.other ? ' is-other' : ''}${related ? ' is-related' : ' is-dimmed'}${pressed(node) ? ' is-selected' : ''}`} style={{top: `${node.y - FLOW_GRAPH_SIZE.nodeHeight / 2}px`}} aria-pressed={!!pressed(node)} aria-label={`${column.label}：${node.label}。${node.label !== fullValue ? `${fullValue}。` : ''}${count(node.requests)} 次请求，${bytes(node.bytesSent)}。点击查看匹配记录。`} title={`${node.label}\n${fullValue}\n${count(node.requests)} 次请求 · ${bytes(node.bytesSent)}`} onMouseEnter={() => setHovered(node.id)} onMouseLeave={() => setHovered(null)} onFocus={() => setFocused(node.id)} onBlur={() => setFocused(null)} onKeyDown={event => moveFocus(event, node)} onClick={() => select(node)}>
              <span className="vfg-node-name">{node.label}</span><span className="vfg-node-facts"><b>{count(node.requests)} 次</b><span>{bytes(node.bytesSent)}</span></span>
            </button>;
          })}
        </section>)}
      </div>
    </div>
    <div className={`vfg-detail${active ? ' has-active' : ''}`} aria-live="polite" aria-atomic="true">
      {active ? <><strong>{active.label}</strong><span className="vfg-detail-value">{active.other ? `${active.values.slice(0, 6).map(value => value ?? '未记录').join('、')}${active.values.length > 6 ? ` 等 ${active.values.length} 项` : ''}` : active.value ?? '未记录'}</span><span>{count(active.requests)} 次请求 · {active.bytesSent === null ? '响应流量未记录' : `${bytes(active.bytesSent)} 响应正文已记录小计`}</span></> : <p>线宽表示请求数；悬停或 Tab 聚焦查看明细，方向键切换节点。规则为日志最终记录节点，不代表完整 WAF 历史；“其他”保留合并请求。</p>}
    </div>
    <span id={`${id}-help`} className="vfg-sr-only">来源、域名、路径、最终记录规则与 HTTP 结果，线宽表示请求数。Tab 聚焦节点，方向键切换，Enter 或空格选择；手机可在图内横向滚动。</span>
  </div>;
}
