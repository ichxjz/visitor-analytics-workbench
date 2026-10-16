import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createGlobeClock, createGlobeInputQueue, decodeWorldCountries, findCountry, matchRegionCountries } from './visitorRegionGlobe.js';
import { createGlobePainter, prepareGlobeSurface } from './visitorRegionGlobeCanvas.js';
import './VisitorRegionGlobe.css';

let cachedSurface;
const colors = element => {
  const style = getComputedStyle(element);
  const value = (name, fallback) => style.getPropertyValue('--vi-globe-' + name).trim() || fallback;
  return { sea: value('sea', '#081827'), seaLight: value('sea-light', '#183e53'), land: value('land', '#85c1cd'), borders: value('borders', '#4b7a8f'), grid: value('grid', '#315467'), rim: value('rim', '#6bafc3'), orbit: value('orbit', '#7898af55'), highlight: value('highlight', '#ffb26b'), selected: value('selected', '#ff7545') };
};

// Country outlines are an overview of logged region estimates. The data never
// supplies a visitor/city coordinate, so this component never invents one.
export default function VisitorRegionGlobe({ regions = [], selectedCountry = '', onSelectCountry }) {
  const id = useId(), root = useRef(null), stage = useRef(null), canvas = useRef(null), engine = useRef(null), bounds = useRef(null), leaveTimer = useRef(null), drag = useRef(null);
  const flags = useRef({ inView: false, hidden: false, reduced: false, hover: false, dragging: false, focused: false });
  const [surface, setSurface] = useState(null), [status, setStatus] = useState('loading'), [reload, setReload] = useState(0), [reduced, setReduced] = useState(false), [hover, setHover] = useState(null), [dragging, setDragging] = useState(false);
  const mapped = useMemo(() => surface ? matchRegionCountries(surface.world, regions) : { groups: [], unmatched: [] }, [surface, regions]);
  const selectedId = surface && findCountry(surface.world, selectedCountry)?.id;
  const selection = useRef({ groups: mapped.groups, selectedId }); selection.current = { groups: mapped.groups, selectedId };
  const select = name => onSelectCountry?.(name);

  useEffect(() => {
    let disposed = false, size = 280;
    const request = new AbortController(), timeout = setTimeout(() => request.abort(), 10000);
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    flags.current.hidden = document.hidden; flags.current.reduced = motion.matches; setReduced(motion.matches);
    const sync = () => {
      const current = engine.current;
      if (!current) return;
      const state = flags.current;
      if (!state.inView || state.hidden) current.input.cancel();
      if (state.inView && !state.hidden && !state.reduced && !state.hover && !state.dragging && !state.focused) current.clock.start();
      else current.clock.stop();
    };
    const resize = () => { if (engine.current) engine.current.painter.resize(size, devicePixelRatio, colors(root.current)); };
    const visibility = () => { flags.current.hidden = document.hidden; sync(); };
    const reduce = () => { flags.current.reduced = motion.matches; setReduced(motion.matches); sync(); };
    const scrolled = () => { bounds.current = null; };
    const intersection = new IntersectionObserver(([entry]) => { flags.current.inView = entry.isIntersecting; sync(); }, { threshold: .01 });
    intersection.observe(stage.current);
    const dimensions = new ResizeObserver(([entry]) => { size = entry.contentRect.width || 280; bounds.current = null; resize(); }); dimensions.observe(stage.current);
    const theme = new MutationObserver(resize);
    for (let ancestor = root.current.parentElement; ancestor; ancestor = ancestor.parentElement) theme.observe(ancestor, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-admin-theme'] });
    document.addEventListener('visibilitychange', visibility); motion.addEventListener('change', reduce); window.addEventListener('scroll', scrolled, true);
    const load = async () => {
      try {
        let next = cachedSurface;
        if (!next) {
          const response = await fetch(`${import.meta.env.BASE_URL}data/world-borders.json`, { signal: request.signal });
          if (!response.ok) throw new Error('World boundary unavailable');
          const topology = await response.json(); if (disposed) return;
          next = prepareGlobeSurface(decodeWorldCountries(topology)); cachedSurface = next;
        }
        if (disposed) return;
        const painter = createGlobePainter(canvas.current, next), clock = createGlobeClock({ draw: painter.draw, fps: 60 });
        const input = createGlobeInputQueue({ rotate: painter.rotate, paint: clock.invalidate });
        engine.current = { painter, clock, input, sync }; painter.setRegions(selection.current.groups, selection.current.selectedId);
        resize(); setSurface(next); setStatus('ready'); sync();
      } catch (error) { if (!disposed) setStatus('error'); }
      finally { clearTimeout(timeout); }
    };
    setStatus('loading'); void load();
    return () => {
      disposed = true; request.abort(); clearTimeout(timeout); clearTimeout(leaveTimer.current); drag.current = null; flags.current.dragging = false; engine.current?.input.dispose(); engine.current?.clock.dispose(); engine.current = null;
      intersection.disconnect(); dimensions.disconnect(); theme.disconnect();
      document.removeEventListener('visibilitychange', visibility); motion.removeEventListener('change', reduce); window.removeEventListener('scroll', scrolled, true);
    };
  }, [reload]);
  useEffect(() => { engine.current?.painter.setRegions(mapped.groups, selectedId); engine.current?.clock.invalidate(); }, [mapped.groups, selectedId, surface]);

  const point = event => {
    if (!bounds.current) bounds.current = canvas.current.getBoundingClientRect();
    return { x: event.clientX - bounds.current.left, y: event.clientY - bounds.current.top, width: bounds.current.width };
  };
  const enter = event => { if (event.pointerType === 'touch') return; clearTimeout(leaveTimer.current); flags.current.hover = true; engine.current?.sync(); };
  const leave = event => { if (event.pointerType === 'touch') return; clearTimeout(leaveTimer.current); leaveTimer.current = setTimeout(() => { setHover(null); flags.current.hover = false; engine.current?.sync(); }, 140); };
  const stopDrag = () => {
    engine.current?.input.flush();
    const current = drag.current; drag.current = null; flags.current.dragging = false; setDragging(false);
    if (current && canvas.current?.hasPointerCapture(current.id)) canvas.current.releasePointerCapture(current.id);
    engine.current?.sync(); return current;
  };
  const down = event => {
    if (!event.isPrimary) { stopDrag(); return; }
    if (event.button !== 0 || !engine.current) return;
    const p = point(event); if (!engine.current.painter.contains(p.x, p.y)) return;
    // Avoid pointer focus keeping the canvas paused after the mouse leaves.
    // Keyboard focus remains available through Tab and the country list.
    event.preventDefault(); clearTimeout(leaveTimer.current);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false };
    flags.current.dragging = true; engine.current.sync(); canvas.current.setPointerCapture(event.pointerId);
  };
  const move = event => {
    const current = drag.current;
    if (current?.id === event.pointerId) {
      if (!current.moved && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 5) return;
      if (!current.moved) { current.moved = true; setDragging(true); setHover(null); }
      engine.current?.input.move(event.clientX - current.x, event.clientY - current.y);
      current.x = event.clientX; current.y = event.clientY; return;
    }
    if (event.pointerType === 'touch') return;
    const p = point(event), group = engine.current?.painter.hit(p.x, p.y);
    setHover(previous => previous?.group.country.id === group?.country.id ? previous : group ? { group, x: Math.max(6, Math.min(p.width - 146, p.x + 10)), y: p.y + 50 < p.width ? p.y + 12 : Math.max(8, p.y - 48) } : null);
  };
  const activate = event => {
    if (drag.current?.id !== event.pointerId) return;
    const current = stopDrag();
    if (current.moved || Math.hypot(event.clientX - current.startX, event.clientY - current.startY) >= 5) return;
    const p = point(event), group = engine.current?.painter.hit(p.x, p.y); if (group) select(group.name);
  };
  const key = event => {
    const movement = { ArrowLeft: [-14, 0], ArrowRight: [14, 0], ArrowUp: [0, -14], ArrowDown: [0, 14] }[event.key];
    if (!movement) return;
    event.preventDefault(); setHover(null); engine.current?.painter.rotate(...movement); engine.current?.clock.invalidate();
  };
  const focus = event => { if (event.target.matches(':focus-visible')) { flags.current.focused = true; engine.current?.sync(); } };
  const blur = event => { if (!stage.current?.contains(event.relatedTarget)) { flags.current.focused = false; engine.current?.sync(); } };
  return <section ref={root} className="vi-region-globe" aria-label="地区分布地球概览" data-globe-state={status}>
    <div className="vi-region-globe-eyebrow"><span aria-hidden="true">◉</span> REGIONAL OVERVIEW</div>
    <div ref={stage} className="vi-region-globe-stage" onPointerEnter={enter} onPointerLeave={leave} onFocusCapture={focus} onBlurCapture={blur}>
      <canvas ref={canvas} className={dragging ? 'is-dragging' : hover ? 'has-country' : undefined} tabIndex={0} role="img" aria-label="地区分布地球，可拖动或用方向键旋转" aria-describedby={`${id}-note`} onPointerDown={down} onPointerMove={move} onPointerUp={activate} onPointerCancel={stopDrag} onLostPointerCapture={stopDrag} onKeyDown={key}/>
      {status === 'loading' && <span className="vi-region-globe-message" role="status">载入地理边界…</span>}
      {status === 'error' && <div className="vi-region-globe-message" role="status"><span>地理边界暂不可用</span><button type="button" onClick={() => setReload(value => value + 1)}>重新载入</button></div>}
      {hover && <button className="vi-region-globe-hover" type="button" style={{ left: hover.x, top: hover.y }} onPointerEnter={enter} onFocus={enter} onClick={() => select(hover.group.name)} aria-label={`查看${hover.group.name}地区数据`}><span>{hover.group.name}</span><span aria-hidden="true">↗</span></button>}
    </div>
    <div className="vi-region-globe-controls"><span><i aria-hidden="true"/> 地区估算</span><span>{reduced ? '静态地球 · 可拖动' : '拖动旋转 · 悬停暂停'}</span></div>
    <p id={`${id}-note`} className="vi-region-globe-note">高亮表示有数据的国家或地区，不代表访客精确位置。</p>
    {mapped.groups.length > 0 && <details className="vi-region-globe-countries"><summary aria-controls={`${id}-countries`}>选择国家或地区 <span>{mapped.groups.length}</span></summary><div id={`${id}-countries`}>{mapped.groups.map(group => <button key={group.country.id} type="button" aria-pressed={selectedId === group.country.id} onClick={() => select(group.name)}>{group.name}<span aria-hidden="true">↗</span></button>)}</div></details>}
  </section>;
}
