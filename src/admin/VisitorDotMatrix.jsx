import { useEffect, useRef, useState } from 'react';
import './VisitorDotMatrix.css';

const format = value => Math.round(value || 0).toLocaleString('zh-CN');
const rowsPerColumn = 16;
const pixelColor = (row, total) => {
  const ratio = total < 2 ? 1 : row / (total - 1);
  const mix = (blue, orange) => Math.round(blue + (orange - blue) * ratio);
  return `rgb(${mix(35,255)}, ${mix(105,157)}, ${mix(220,57)})`;
};

export default function VisitorDotMatrix({rows, selected, onSelect, labels='trend'}) {
  const chartRef = useRef(null);
  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => {
    let inView = false;
    const update = () => setVisible(inView && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; update(); });
    observer.observe(chartRef.current);
    document.addEventListener('visibilitychange', update);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update); };
  }, []);
  const available = rows.filter(row => row.available !== false);
  const maximum = Math.max(1, ...available.map(row => row.views));
  const step = rows.length > 20 ? 5 : rows.length > 12 ? 3 : 1;
  return <div ref={chartRef} data-motion-visible={visible} className={`visitor-dot-matrix visitor-dot-matrix--${labels}`} role="group" aria-label={labels === 'trend' ? '访问趋势点阵图' : '访客维度点阵图'}>
    <div className="visitor-dot-grid" aria-hidden="true"><span/><span/><span/></div>
    <div className="visitor-dot-columns">
      {rows.map((row,index) => {
        const disabled = row.available === false;
        const count = disabled ? 1 : row.views > 0 ? Math.max(1, Math.round(row.views / maximum * rowsPerColumn)) : 0;
        const name = labels === 'trend' ? row.label : row.name;
        const showLabel = labels === 'dimension' || index % step === 0 || index === rows.length - 1;
        const delay = rows.length < 2 ? 0 : index / (rows.length - 1) * 180;
        const lowRows = count < 2 ? 0 : Math.max(1,Math.round(count * .34));
        const midRows = count < 4 ? lowRows : Math.max(1,Math.round(count * .17));
        const height = Math.max(0,count*9-3);
        return <button type="button" key={row.start || row.name || index} className={`visitor-dot-item${disabled ? ' is-unavailable' : ''}${!disabled&&row.views>0 ? ' has-data' : ''}${selected === index || selected === row.name ? ' is-selected' : ''}`} style={{'--bar-height':`${height}px`,'--cut-low':`${lowRows*9}px`,'--cut-mid':`${midRows*9}px`,'--pulse-delay':`${1050+(index%5)*80}ms`}} disabled={disabled} onClick={() => onSelect(row)} title={`${name}：${disabled ? '无可用日志' : `${format(row.views)} PV`}`} aria-label={disabled ? `${name}：无可用日志` : `${name}：${format(row.views)} 次访问，查看详情`}>
          <span className="visitor-dot-value">{disabled ? '—' : format(row.views)}</span>
          <span className="visitor-dot-track" aria-hidden="true"><span className="visitor-dot-column">{Array.from({length:count},(_,rowIndex)=><i key={rowIndex} style={{'--dot-delay':`${delay + rowIndex * 33.333}ms`,'--dot-cool':`${delay + count * 33.333 + 80}ms`,'--pixel-color':pixelColor(rowIndex,count)}}/>)}</span></span>
          <span className="visitor-dot-label">{showLabel ? name : ''}</span>
        </button>;
      })}
    </div>
  </div>;
}
