import VisitorDotMatrix from './VisitorDotMatrix.jsx';
import './VisitorTrend.css';

const format = value => Math.round(value || 0).toLocaleString('zh-CN');

export default function VisitorTrend({rows = [], range, onSelect}) {
  const maximum = Math.max(1,...rows.filter(row => row.available).map(row => row.views));
  return <div className="visitor-trend-plot" key={range}>
    <div className="visitor-trend-axis"><span>{format(maximum)}</span><span>{format(Math.round(maximum/2))}</span><span>0</span></div>
    <div className="visitor-trend-graphic"><VisitorDotMatrix rows={rows} labels="trend" onSelect={onSelect}/></div>
  </div>;
}
