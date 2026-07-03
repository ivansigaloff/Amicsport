import { useEffect } from 'react';

/**
 * Cursor de tiza (solo web, puntero fino): un punto con anilla dibujada que
 * sigue al ratón con un pelín de retardo, se ensancha sobre elementos
 * interactivos y pasa a trazo discontinuo sobre elementos arrastrables
 * (marcados con data-chalk-grab). Usa mix-blend-mode: difference para ser
 * legible tanto sobre papel tiza como sobre la pizarra verde botella.
 *
 * Se monta una vez en el layout de /v2 y se desmonta limpio al salir, de
 * modo que v1 conserva el cursor del sistema.
 */
const CSS = `
#amic-chalk-cursor{position:fixed;z-index:9999;pointer-events:none;left:0;top:0;mix-blend-mode:difference}
#amic-chalk-cursor .dot{position:absolute;left:-3px;top:-3px;width:6px;height:6px;background:#fff;border-radius:50%}
#amic-chalk-cursor .ring{
  position:absolute;left:-16px;top:-16px;width:32px;height:32px;border-radius:50%;
  border:2px solid #fff;opacity:.85;
  transition:transform .18s cubic-bezier(.2,.9,.3,1.3),border-style .18s,opacity .18s;
}
#amic-chalk-cursor.hot .ring{transform:scale(1.7)}
#amic-chalk-cursor.grab .ring{transform:scale(2.1);border-style:dashed}
body.amic-cursor-on, body.amic-cursor-on a, body.amic-cursor-on [role="button"],
body.amic-cursor-on button, body.amic-cursor-on [tabindex]{cursor:none !important}
body.amic-cursor-on input, body.amic-cursor-on textarea{cursor:text !important}
`;

const HOT_SELECTOR = 'a, button, [role="button"], [tabindex]:not(input):not(textarea)';

export default function ChalkCursor() {
  useEffect(() => {
    const finePointer = window.matchMedia('(pointer: fine)').matches;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!finePointer || reduced) return;

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const cursor = document.createElement('div');
    cursor.id = 'amic-chalk-cursor';
    cursor.setAttribute('aria-hidden', 'true');
    cursor.innerHTML = '<div class="ring"></div><div class="dot"></div>';
    document.body.appendChild(cursor);
    document.body.classList.add('amic-cursor-on');

    let cx = -100, cy = -100, tx = -100, ty = -100;
    let raf = 0;

    const onMove = (e: PointerEvent) => {
      tx = e.clientX;
      ty = e.clientY;
      const target = e.target as Element | null;
      const grab = !!target?.closest?.('[data-chalk-grab]');
      const hot = !grab && !!target?.closest?.(HOT_SELECTOR);
      cursor.classList.toggle('hot', hot);
      cursor.classList.toggle('grab', grab);
    };
    document.addEventListener('pointermove', onMove, { passive: true });

    const loop = () => {
      cx += (tx - cx) * 0.32;
      cy += (ty - cy) * 0.32;
      cursor.style.transform = `translate(${cx}px,${cy}px)`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('pointermove', onMove);
      document.body.classList.remove('amic-cursor-on');
      cursor.remove();
      style.remove();
    };
  }, []);

  return null;
}
