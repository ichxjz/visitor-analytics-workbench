import {useEffect,useState} from 'react';

export default function AnimatedVisitorNumber({value,suffix=''}){
  const target=Number.isFinite(value)?Math.max(0,Math.round(value)):null;
  const [current,setCurrent]=useState(target===null?null:0);
  useEffect(()=>{
    if(target===null){setCurrent(null);return undefined;}
    if(target===0||window.matchMedia('(prefers-reduced-motion: reduce)').matches){setCurrent(target);return undefined;}
    let frame,start;
    setCurrent(0);
    const tick=now=>{
      if(start===undefined)start=now;
      const progress=Math.min((now-start)/600,1);
      setCurrent(Math.round(target*(1-(1-progress)**3)));
      if(progress<1)frame=requestAnimationFrame(tick);
    };
    frame=requestAnimationFrame(tick);
    return ()=>cancelAnimationFrame(frame);
  },[target]);
  return <>{current===null?'—':current.toLocaleString('zh-CN')}{current===null?'':suffix}</>;
}
