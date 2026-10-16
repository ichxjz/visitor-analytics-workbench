import { Children, useLayoutEffect, useRef, useState } from 'react';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export default function FloatingPanel({className, label, placement = 'right', children}) {
  const [heading,...content] = Children.toArray(children);
  const panelRef = useRef(null);
  const dragRef = useRef(null);
  const [position, setPosition] = useState(null);

  useLayoutEffect(() => {
    const place = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const width = panel.offsetWidth;
      const height = panel.offsetHeight;
      const right = Math.max(12, window.innerWidth - width - 20);
      const left = Math.max(12, window.innerWidth - width - Math.min(560, window.innerWidth - 32) - 48);
      setPosition(current => current ? {
        x: clamp(current.x, 12, Math.max(12, window.innerWidth - width - 12)),
        y: clamp(current.y, 12, Math.max(12, window.innerHeight - height - 12)),
      } : {x: placement === 'left' && left > 24 ? left : right, y: Math.max(12, window.innerHeight - height - 20)});
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [placement]);

  const startDrag = event => {
    if (event.button !== 0 || event.target.closest('button')) return;
    const rect = panelRef.current.getBoundingClientRect();
    dragRef.current = {pointerId:event.pointerId, offsetX:event.clientX - rect.left, offsetY:event.clientY - rect.top};
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = event => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    const panel = panelRef.current;
    setPosition({
      x:clamp(event.clientX - dragRef.current.offsetX, 12, Math.max(12, window.innerWidth - panel.offsetWidth - 12)),
      y:clamp(event.clientY - dragRef.current.offsetY, 12, Math.max(12, window.innerHeight - panel.offsetHeight - 12)),
    });
  };
  const stopDrag = event => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  return <aside ref={panelRef} className={`${className} visitor-floating-panel`} role="dialog" aria-label={label} style={position ? {left:position.x, top:position.y, right:'auto', bottom:'auto'} : undefined}>
    <div className="visitor-drag-surface" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={stopDrag} onPointerCancel={stopDrag}>{heading}</div>
    {content}
  </aside>;
}
