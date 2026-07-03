import { useEffect } from 'react';

/**
 * Fondo «césped segado» de la demo: bandas verticales verdes muy tenues
 * sobre todo el viewport, como las franjas de corte de un campo. Es una
 * capa fija por encima del contenido con pointer-events: none — los
 * screens de la app pintan su fondo opaco, así que ponerla debajo (como
 * hacía la demo con body::before) la taparía. Al 5–6% de alpha el efecto
 * sobre tarjetas y texto es imperceptible; sobre el papel tiza se leen
 * las bandas.
 *
 * Se monta en el layout de /v2 y se limpia al salir — v1 no la ve.
 */
const CSS = `
body.amic-stripes-on::after{
  content:"";position:fixed;inset:0;z-index:9998;pointer-events:none;
  background:repeating-linear-gradient(90deg,transparent 0 72px,rgba(23,113,58,.055) 72px 144px);
}
`;

export default function PitchStripes() {
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    document.body.classList.add('amic-stripes-on');
    return () => {
      document.body.classList.remove('amic-stripes-on');
      style.remove();
    };
  }, []);
  return null;
}
