import { useEffect } from 'react';

/**
 * Fondo de campo de la demo: bandas horizontales de «césped segado» + figuras
 * de tiza (círculo central, cuarto de córner y área de penalti) dibujadas en
 * trazo discontinuo muy tenue. Es una capa fija por encima del contenido con
 * pointer-events: none — los screens pintan su fondo opaco, así que ponerla
 * debajo (como el body::before de la demo) la taparía. A ~5-7% de alpha el
 * efecto sobre tarjetas y texto es imperceptible; sobre el papel tiza se lee.
 *
 * Se monta en el layout de /v2 y se limpia al salir — v1 no la ve.
 */
const INK = 'rgba(23,113,58,';

const CSS = `
#amic-field-bg{position:fixed;inset:0;z-index:9998;pointer-events:none}
#amic-field-bg .stripes{
  position:absolute;inset:0;
  background:repeating-linear-gradient(0deg,transparent 0 72px,${INK}.055) 72px 144px);
}
#amic-field-bg svg{position:absolute;overflow:visible}
#amic-field-bg .geo{fill:none;stroke:${INK}.10);stroke-width:2;stroke-dasharray:10 12}
#amic-field-bg .spot{fill:${INK}.10);stroke:none}
`;

const SVG = `
<svg class="geo-circle" width="440" height="440" viewBox="0 0 440 440" style="right:-150px;top:64px">
  <circle class="geo" cx="220" cy="220" r="200"/>
  <circle class="spot" cx="220" cy="220" r="5"/>
</svg>
<svg width="200" height="200" viewBox="0 0 200 200" style="left:-40px;bottom:56px">
  <path class="geo" d="M 160 200 A 160 160 0 0 0 0 40"/>
</svg>
<svg width="260" height="150" viewBox="0 0 260 150" style="left:24%;bottom:-6px">
  <rect class="geo" x="30" y="40" width="200" height="110"/>
  <path class="geo" d="M 90 40 A 44 44 0 0 1 170 40"/>
  <circle class="spot" cx="130" cy="76" r="4"/>
</svg>
`;

export default function PitchStripes() {
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const layer = document.createElement('div');
    layer.id = 'amic-field-bg';
    layer.setAttribute('aria-hidden', 'true');
    layer.innerHTML = `<div class="stripes"></div>${SVG}`;
    document.body.appendChild(layer);

    return () => {
      layer.remove();
      style.remove();
    };
  }, []);
  return null;
}
