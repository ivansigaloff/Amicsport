import { useEffect } from 'react';

/**
 * Fondo de campo (solo web): capa fija DETRÁS de todo (z-index -1) con el
 * papel tiza, bandas verticales de césped segado y las líneas de tiza en
 * BLANCO (con un halo verde suave para que se lean sobre el papel claro).
 * Las pantallas ponen su fondo transparente en web para dejarla ver; las
 * tarjetas y demás objetos son opacos y la tapan — nunca al revés.
 *
 * Se monta en el layout raíz y se limpia al desmontar.
 */
const CSS = `
body{background-color:#F1F3EA}
#amic-field-bg{position:fixed;inset:0;z-index:-1;pointer-events:none;background-color:#F1F3EA}
#amic-field-bg .stripes{
  position:absolute;inset:0;
  background:repeating-linear-gradient(90deg,transparent 0 72px,rgba(23,113,58,.055) 72px 144px);
}
#amic-field-bg svg{position:absolute;overflow:visible}
#amic-field-bg .halo{fill:none;stroke:rgba(23,113,58,.16);stroke-width:6;stroke-dasharray:10 12}
#amic-field-bg .geo{fill:none;stroke:rgba(255,255,255,.95);stroke-width:2.5;stroke-dasharray:10 12}
#amic-field-bg .spot{fill:rgba(255,255,255,.95);stroke:none}
`;

const SVG = `
<svg width="440" height="440" viewBox="0 0 440 440" style="right:-150px;top:64px">
  <circle class="halo" cx="220" cy="220" r="200"/>
  <circle class="geo" cx="220" cy="220" r="200"/>
  <circle class="spot" cx="220" cy="220" r="5"/>
</svg>
<svg width="200" height="200" viewBox="0 0 200 200" style="left:-40px;bottom:56px">
  <path class="halo" d="M 160 200 A 160 160 0 0 0 0 40"/>
  <path class="geo" d="M 160 200 A 160 160 0 0 0 0 40"/>
</svg>
<svg width="260" height="150" viewBox="0 0 260 150" style="left:24%;bottom:-6px">
  <rect class="halo" x="30" y="40" width="200" height="110"/>
  <rect class="geo" x="30" y="40" width="200" height="110"/>
  <path class="halo" d="M 90 40 A 44 44 0 0 1 170 40"/>
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
