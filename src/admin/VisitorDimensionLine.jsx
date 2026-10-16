import VisitorDotMatrix from './VisitorDotMatrix.jsx';
import './VisitorDimensionLine.css';

export default function VisitorDimensionLine({rows,selected,onSelect,label}){
  if(!rows.length)return <div className="visitor-dimension-chart" role="group" aria-label={label}><p>当前范围无记录。</p></div>;
  return <div className="visitor-dimension-scroll"><div className="visitor-dimension-chart" role="group" aria-label={label} style={{minWidth:`${Math.max(320,rows.length*54)}px`}}><VisitorDotMatrix rows={rows} labels="dimension" selected={selected} onSelect={row=>onSelect(row.name)}/></div></div>;
}
