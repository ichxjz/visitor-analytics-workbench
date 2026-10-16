import { useEffect, useMemo, useRef, useState } from 'react';
import './VisitorRotatingTable.css';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value);
const cellText = value => value === null || value === undefined || value === '' ? '—' : typeof value === 'boolean' ? value ? '是' : '否' : typeof value === 'string' || typeof value === 'number' ? String(value) : '—';
const interactiveTarget = target => target?.closest?.('button,a,input,select,textarea,summary,[role="button"],[contenteditable="true"]');

/**
 * columns.render(value, row, absoluteIndex) renders a cell;
 * columns.title(value, row, absoluteIndex), or a title string, supplies its
 * full tooltip. rowKey may be a property name or (row, absoluteIndex) => key.
 * All rows remain owned by the caller; this component never persists data.
 */
export default function VisitorRotatingTable({
  rows = [], columns = [], rowKey, onRowClick, onAction, actionLabel = '查看详情',
  label = '记录列表', emptyText = '当前范围没有可显示的记录。',
  pageDurationMs = 50000, maxHeight = 280, pageSize = 50,
}) {
  const items = Array.isArray(rows) ? rows : [];
  const fields = Array.isArray(columns) ? columns : [];
  const size = isFiniteNumber(pageSize) ? Math.max(1, Math.min(50, Math.floor(pageSize))) : 50;
  const duration = isFiniteNumber(pageDurationMs) ? Math.max(100, pageDurationMs) : 50000;
  const height = isFiniteNumber(maxHeight) ? Math.max(80, maxHeight) : 280;
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const root = useRef(null), viewport = useRef(null), table = useRef(null);
  const elapsed = useRef(0), maxScroll = useRef(0), running = useRef(false), scrollTimer = useRef(null);
  const [page, setPage] = useState(1);
  const [manualPaused, setManualPaused] = useState(false);
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false);
  const [touching, setTouching] = useState(false), [settling, setSettling] = useState(false);
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || !document.hidden);
  const [inView, setInView] = useState(false), [scrollable, setScrollable] = useState(false);
  const [reduced, setReduced] = useState(() => typeof matchMedia === 'function' && matchMedia(REDUCED_MOTION).matches);
  const currentPage = Math.min(page, pageCount);
  const keyOf = (row, index) => typeof rowKey === 'function' ? rowKey(row, index) : typeof rowKey === 'string' ? row?.[rowKey] ?? index : row?.id ?? row?.name ?? row?.ip ?? index;
  const identity = JSON.stringify(items.map((row, index) => keyOf(row, index)));
  const firstIndex = (currentPage - 1) * size;
  const shown = items.slice(firstIndex, firstIndex + size);
  const pageNumbers = useMemo(() => {
    const start = Math.max(1, Math.min(currentPage - 3, pageCount - 7));
    return Array.from({ length: Math.min(8, pageCount) }, (_, index) => start + index);
  }, [currentPage, pageCount]);
  const motionAvailable = items.length > 0 && (scrollable || pageCount > 1);
  const interacting = hovered || focused || touching || settling;
  const mayRun = motionAvailable && !reduced && !manualPaused && !interacting && visible && inView;
  const status = reduced ? '减少动态：手动翻页' : manualPaused ? '已暂停' : !visible ? '后台暂停' : !inView ? '离屏暂停' : interacting && motionAvailable ? '操作时暂停' : motionAvailable ? `自动浏览 ${Math.round(duration / 100) / 10} 秒/页` : '全部已显示';

  useEffect(() => {
    const update = () => { running.current = false; setVisible(!document.hidden); };
    document.addEventListener('visibilitychange', update);
    const query = matchMedia(REDUCED_MOTION);
    const updateMotion = () => { running.current = false; setReduced(query.matches); };
    query.addEventListener('change', updateMotion);
    return () => { document.removeEventListener('visibilitychange', update); query.removeEventListener('change', updateMotion); };
  }, []);
  useEffect(() => {
    if (!root.current) return undefined;
    if (typeof IntersectionObserver !== 'function') { setInView(true); return undefined; }
    const observer = new IntersectionObserver(entries => {
      const shown = entries.some(entry => entry.isIntersecting);
      if (!shown) running.current = false;
      setInView(shown);
    }, { threshold: 0.01 });
    observer.observe(viewport.current || root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    elapsed.current = 0;
    if (viewport.current) viewport.current.scrollTop = 0;
    setPage(value => Math.min(value, pageCount));
  }, [identity, size, duration, currentPage, pageCount]);
  useEffect(() => {
    const measure = () => {
      if (!viewport.current) return;
      maxScroll.current = Math.max(0, viewport.current.scrollHeight - viewport.current.clientHeight);
      setScrollable(maxScroll.current > 1);
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (viewport.current) observer?.observe(viewport.current);
    if (table.current) observer?.observe(table.current);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [identity, currentPage, fields.length, height, size]);
  useEffect(() => () => clearTimeout(scrollTimer.current), []);

  useEffect(() => {
    if (!mayRun) { running.current = false; return undefined; }
    let frame = 0, timer = 0, active = true, previous = performance.now();
    running.current = true;
    const advance = () => {
      elapsed.current = 0;
      if (viewport.current) viewport.current.scrollTop = 0;
      if (pageCount > 1) setPage(value => value >= pageCount ? 1 : value + 1);
    };
    if (scrollable) {
      const tick = now => {
        if (!active || document.hidden) return;
        elapsed.current += Math.max(0, now - previous);
        previous = now;
        if (elapsed.current >= duration) {
          advance();
          if (pageCount > 1) return;
        } else if (viewport.current) viewport.current.scrollTop = maxScroll.current * Math.min(elapsed.current / duration, 1);
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    } else {
      timer = setTimeout(() => { if (active && !document.hidden) advance(); }, Math.max(0, duration - elapsed.current));
    }
    return () => {
      active = false;
      running.current = false;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      if (!scrollable) elapsed.current = Math.min(duration, elapsed.current + Math.max(0, performance.now() - previous));
    };
  }, [mayRun, scrollable, currentPage, pageCount, duration, identity, size]);

  const interaction = () => { running.current = false; clearTimeout(scrollTimer.current); setSettling(true); };
  const quiet = () => {
    clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => setSettling(false), 900);
  };
  const pointerStart = event => { interaction(); if (event.pointerType === 'touch') setTouching(true); };
  const pointerEnd = event => { if (event.pointerType !== 'touch') setTouching(false); quiet(); };
  const scroll = () => {
    if (running.current) return;
    if (maxScroll.current > 0 && viewport.current) elapsed.current = Math.min(duration, Math.max(0, viewport.current.scrollTop / maxScroll.current * duration));
    if (settling || touching) quiet();
  };
  const goToPage = next => {
    running.current = false;
    elapsed.current = 0;
    if (viewport.current) viewport.current.scrollTop = 0;
    setPage(Math.min(pageCount, Math.max(1, next)));
  };

  return <section ref={root} className="visitor-rotating-table" aria-label={label} data-rotation-state={mayRun ? 'running' : 'paused'}
    onPointerEnter={event => { if (event.pointerType !== 'touch') { running.current = false; setHovered(true); } }}
    onPointerLeave={event => { setHovered(false); if (event.pointerType !== 'touch') setTouching(false); quiet(); }}
    onFocusCapture={() => { running.current = false; setFocused(true); }}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <div ref={viewport} className="vrt-scroll" style={{ maxHeight: height }} tabIndex={0} aria-label={`${label}，可在表格内滚动`}
      onPointerDown={pointerStart} onPointerUp={pointerEnd} onPointerCancel={pointerEnd}
      onTouchStart={() => { interaction(); setTouching(true); }} onTouchEnd={event => { if (!event.touches.length) { setTouching(false); quiet(); } }} onTouchCancel={() => { setTouching(false); quiet(); }}
      onWheel={() => { interaction(); quiet(); }} onScroll={scroll}>
      <table ref={table} aria-label={label} style={{ minWidth: Math.max(280, fields.length * 125 + (onAction ? 88 : 0)) }}>
        <thead><tr>{fields.map(column => <th key={column.key} scope="col" style={column.width ? { width: column.width } : undefined}>{column.label}</th>)}{onAction && <th scope="col" className="vrt-action-heading">操作</th>}</tr></thead>
        <tbody>{shown.length ? shown.map((row, index) => {
          const absoluteIndex = firstIndex + index;
          return <tr key={keyOf(row, absoluteIndex)} tabIndex={onRowClick ? 0 : undefined} className={onRowClick ? 'vrt-clickable' : undefined}
            onClick={event => { if (onRowClick && !interactiveTarget(event.target) && (window.getSelection()?.isCollapsed ?? true)) onRowClick(row, absoluteIndex, event); }}
            onKeyDown={event => { if (onRowClick && event.target === event.currentTarget && !event.altKey && !event.ctrlKey && !event.metaKey && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onRowClick(row, absoluteIndex, event); } }}>
            {fields.map(column => {
              const value = row?.[column.key];
              const title = typeof column.title === 'function' ? column.title(value, row, absoluteIndex) : column.title ?? (typeof value === 'string' || typeof value === 'number' ? String(value) : undefined);
              return <td key={column.key} title={typeof title === 'string' ? title : undefined}><div className="vrt-cell">{column.render ? column.render(value, row, absoluteIndex) : cellText(value)}</div></td>;
            })}
            {onAction && <td className="vrt-action-cell"><button type="button" className="vrt-action" onClick={event => { event.stopPropagation(); onAction(row, absoluteIndex, event); }}>{actionLabel}</button></td>}
          </tr>;
        }) : <tr><td colSpan={Math.max(1, fields.length + (onAction ? 1 : 0))}><div className="vrt-empty">{emptyText}</div></td></tr>}</tbody>
      </table>
    </div>
    <div className="vrt-footer"><div className="vrt-summary"><span>每页 {size} 条 · 共 {items.length.toLocaleString('zh-CN')} 条</span><span className="vrt-state">{status}</span><button type="button" className="vrt-toggle" disabled={reduced || !motionAvailable} aria-pressed={manualPaused} aria-label={`${label}：${manualPaused ? '继续轮播' : '暂停轮播'}`} title="交互时自动暂停；移开鼠标或移出焦点后继续" onClick={() => setManualPaused(value => !value)}>{manualPaused ? '继续轮播' : '暂停轮播'}</button></div>
      <nav className="vrt-pagination" aria-label={`${label}分页`}><span>第 {currentPage} / {pageCount} 页</span><button type="button" disabled={currentPage <= 1} onClick={() => goToPage(currentPage - 1)}>上一页</button>{pageNumbers.map(value => <button key={value} type="button" aria-current={value === currentPage ? 'page' : undefined} onClick={() => goToPage(value)}>{value}</button>)}<button type="button" disabled={currentPage >= pageCount} onClick={() => goToPage(currentPage + 1)}>下一页</button></nav>
    </div>
  </section>;
}
