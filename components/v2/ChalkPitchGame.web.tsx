import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Mini-juego «chuta a portería» (solo web): un balón arrastrable con física
 * de tiza — gravedad, rebotes y confeti al marcar en la portería dibujada.
 * Easter egg del login, versión noche (sobre la pizarra verde botella).
 *
 * La física corre fuera de React (refs + requestAnimationFrame) y el bucle
 * se duerme cuando el balón reposa, así que en idle no consume nada.
 */
const SIZE = 58;
const G = 0.42;
const BOUNCE = -0.58;
const FRICTION = 0.995;
const FLOOR_F = 0.94;
const CONFETTI_COLORS = ['#FFC91F', '#17713A', '#D63415', '#FFFFFF'];

const CSS = `
.amic-pitch{
  position:relative;height:300px;max-width:440px;width:100%;align-self:center;
  border:2px solid rgba(244,250,240,.5);
  background:
    repeating-linear-gradient(0deg,transparent 0 37px,rgba(255,255,255,.045) 37px 74px),
    #0F4A26;
  box-shadow:8px 8px 0 rgba(0,0,0,.45);
  overflow:hidden;touch-action:pan-y;
}
.amic-pitch .halfline{position:absolute;left:0;right:0;top:50%;border-top:2px dashed rgba(244,250,240,.55)}
.amic-pitch .centerspot{position:absolute;left:18%;top:50%;width:8px;height:8px;margin:-4px;border-radius:50%;background:rgba(244,250,240,.8)}
.amic-pitch .hint{
  position:absolute;left:12px;top:9px;z-index:3;
  font-family:'IBMPlexMono_500Medium',monospace;font-size:10.5px;letter-spacing:.16em;
  text-transform:uppercase;color:rgba(244,250,240,.75);
}
.amic-pitch .scorechip{
  position:absolute;right:12px;top:9px;z-index:3;
  font-family:'IBMPlexMono_500Medium',monospace;font-size:12px;letter-spacing:.1em;
  border:2px solid #0D2015;background:#FAFBF4;color:#14251A;padding:3px 9px;
  box-shadow:3px 3px 0 rgba(0,0,0,.45);transition:background .2s;
}
.amic-pitch .scorechip.scored{background:#FFC91F;color:#0D2015}
.amic-pitch .goal{position:absolute;right:0;bottom:28px;width:98px;height:140px;z-index:1}
.amic-pitch .goal .frame{
  position:absolute;inset:0;border:4px solid rgba(244,250,240,.85);border-right:none;
  background:
    repeating-linear-gradient(0deg,transparent 0 12px,rgba(244,250,240,.22) 12px 13px),
    repeating-linear-gradient(90deg,transparent 0 12px,rgba(244,250,240,.22) 12px 13px);
}
.amic-pitch .goal .label{
  position:absolute;left:-2px;bottom:-22px;white-space:nowrap;
  font-family:'IBMPlexMono_400Regular',monospace;font-style:italic;font-size:11px;
  color:rgba(244,250,240,.6);
}
.amic-pitch .ball{
  position:absolute;z-index:2;width:${SIZE}px;height:${SIZE}px;font-size:50px;line-height:${SIZE}px;text-align:center;
  user-select:none;-webkit-user-select:none;touch-action:none;will-change:transform;
  filter:drop-shadow(0 0 14px rgba(255,255,255,.2)) drop-shadow(4px 6px 0 rgba(0,0,0,.5));
}
.amic-pitch .golflash{
  position:absolute;inset:0;display:none;place-items:center;z-index:4;pointer-events:none;
  font-family:'Anton_400Regular',sans-serif;font-size:54px;color:#FFC91F;
  -webkit-text-stroke:2px #0D2015;text-transform:uppercase;
}
.amic-pitch .golflash.on{display:grid;animation:amic-golpop .9s cubic-bezier(.2,1.4,.3,1) both}
@keyframes amic-golpop{
  0%{transform:scale(.4) rotate(-6deg);opacity:0}
  25%{opacity:1}
  70%{transform:scale(1.15) rotate(2deg)}
  100%{transform:scale(1.1);opacity:0}
}
.amic-pitch .confetti{position:absolute;width:9px;height:13px;z-index:3;pointer-events:none;will-change:transform}
`;

export default function ChalkPitchGame() {
  const { t } = useTranslation();
  const boxRef = useRef<HTMLDivElement>(null);
  const ballRef = useRef<HTMLDivElement>(null);
  const goalRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLSpanElement>(null);
  const countRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const box = boxRef.current, ball = ballRef.current, goalEl = goalRef.current,
      flash = flashRef.current, chip = chipRef.current, countEl = countRef.current;
    if (!box || !ball || !goalEl || !flash || !chip || !countEl) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let x = 40, y = 40, vx = 0, vy = 0, rot = 0, goals = 0;
    let dragging = false, celebrating = false, settledFrames = 0;
    let raf: number | null = null, resetTimer: ReturnType<typeof setTimeout> | null = null;
    let trail: { x: number; y: number; t: number }[] = [];
    const confetti: { el: HTMLDivElement; x: number; y: number; vx: number; vy: number; r: number; vr: number; life: number }[] = [];

    const bw = () => box.clientWidth;
    const bh = () => box.clientHeight;
    const render = () => {
      ball.style.transform = `translate(${x}px,${y}px) rotate(${rot}deg)`;
    };
    const inGoal = () => {
      const gr = goalEl.getBoundingClientRect(), br = box.getBoundingClientRect();
      const gx = gr.left - br.left, gy = gr.top - br.top;
      const cxx = x + SIZE / 2, cyy = y + SIZE / 2;
      return cxx > gx + 14 && cxx < gx + gr.width && cyy > gy + 10 && cyy < gy + gr.height - 6;
    };
    const spawnConfetti = () => {
      if (reduced) return;
      const gr = goalEl.getBoundingClientRect(), br = box.getBoundingClientRect();
      for (let i = 0; i < 26; i++) {
        const el = document.createElement('div');
        el.className = 'confetti';
        el.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
        box.appendChild(el);
        confetti.push({
          el,
          x: gr.left - br.left + 20 + Math.sin(i * 2.1) * 18,
          y: gr.top - br.top + 50,
          vx: -1.5 - (i % 7) * 0.9,
          vy: -6 - (i % 5) * 1.4,
          r: i * 37, vr: 6 + (i % 9) * 2, life: 100,
        });
      }
    };
    const goal = () => {
      goals++; countEl.textContent = String(goals); celebrating = true;
      chip.classList.add('scored');
      flash.classList.remove('on'); void flash.offsetWidth; flash.classList.add('on');
      spawnConfetti();
      wake(); // el confeti anima aunque la física esté en pausa de celebración
      resetTimer = setTimeout(() => {
        x = 40; y = 40; vx = 0; vy = 0; rot = 0; celebrating = false;
        chip.classList.remove('scored');
        render(); wake();
      }, 900);
    };
    const step = () => {
      raf = null;
      const W = bw(), H = bh();
      if (!dragging && !celebrating) {
        vy += G; x += vx; y += vy; rot += vx * 1.6;
        if (y > H - SIZE - 4) { y = H - SIZE - 4; vy *= BOUNCE; vx *= FLOOR_F; if (Math.abs(vy) < 1.2) vy = 0; }
        if (y < 4) { y = 4; vy *= BOUNCE; }
        if (x < 4) { x = 4; vx *= BOUNCE; }
        if (x > W - SIZE - 4) { x = W - SIZE - 4; vx *= BOUNCE; }
        vx *= FRICTION;
        if (inGoal()) { render(); goal(); return; }
      }
      for (let i = confetti.length - 1; i >= 0; i--) {
        const c = confetti[i];
        c.vy += 0.35; c.x += c.vx; c.y += c.vy; c.r += c.vr; c.life--;
        c.el.style.transform = `translate(${c.x}px,${c.y}px) rotate(${c.r}deg)`;
        c.el.style.opacity = String(Math.max(0, c.life / 60));
        if (c.life <= 0) { c.el.remove(); confetti.splice(i, 1); }
      }
      render();
      const idle = !dragging && !celebrating && Math.abs(vx) < 0.08 && Math.abs(vy) < 0.08
        && y >= bh() - SIZE - 5 && confetti.length === 0;
      settledFrames = idle ? settledFrames + 1 : 0;
      if (settledFrames < 30) raf = requestAnimationFrame(step);
    };
    const wake = () => { if (!raf) { settledFrames = 0; raf = requestAnimationFrame(step); } };

    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      dragging = true; trail = [];
      ball.setPointerCapture(e.pointerId);
      wake();
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const br = box.getBoundingClientRect();
      x = Math.min(Math.max(e.clientX - br.left - SIZE / 2, 0), bw() - SIZE);
      y = Math.min(Math.max(e.clientY - br.top - SIZE / 2, 0), bh() - SIZE);
      trail.push({ x, y, t: performance.now() });
      if (trail.length > 6) trail.shift();
      render();
    };
    const release = () => {
      if (!dragging) return;
      dragging = false;
      if (trail.length > 1) {
        const a = trail[0], b = trail[trail.length - 1];
        const dt = Math.max(b.t - a.t, 16);
        const MAX = 34;
        vx = Math.max(Math.min(((b.x - a.x) / dt) * 18, MAX), -MAX);
        vy = Math.max(Math.min(((b.y - a.y) / dt) * 18, MAX), -MAX);
      }
      wake();
    };
    ball.addEventListener('pointerdown', onDown);
    ball.addEventListener('pointermove', onMove);
    ball.addEventListener('pointerup', release);
    ball.addEventListener('pointercancel', release);

    x = 40; y = bh() - SIZE - 4; render(); wake();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (resetTimer) clearTimeout(resetTimer);
      ball.removeEventListener('pointerdown', onDown);
      ball.removeEventListener('pointermove', onMove);
      ball.removeEventListener('pointerup', release);
      ball.removeEventListener('pointercancel', release);
      confetti.forEach((c) => c.el.remove());
    };
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <style>{CSS}</style>
      <div className="amic-pitch" ref={boxRef}>
        <span className="hint">{t('login.game_hint', 'Entrenamiento libre — arrastra y chuta')}</span>
        <span className="scorechip" ref={chipRef}>
          {t('login.game_goals', 'GOLES')} <b ref={countRef as any}>0</b>
        </span>
        <div className="halfline" />
        <div className="centerspot" />
        <div className="goal" ref={goalRef}>
          <div className="frame" />
          <span className="label">{t('login.game_goal_label', 'portería norte')}</span>
        </div>
        <div
          className="ball"
          ref={ballRef}
          data-chalk-grab="true"
          role="img"
          aria-label={t('login.game_ball_label', 'Balón arrastrable: lánzalo a portería')}
        >
          ⚽
        </div>
        <div className="golflash" ref={flashRef}>{t('login.game_goal_flash', '¡Gooool!')}</div>
      </div>
    </div>
  );
}
