// The Home orb: a canvas sphere of grey dots around an accent core that grows with the
// running lanes. Rotates slowly; drawn once under prefers-reduced-motion.

let angle = 0; // kept across re-renders so the 5 s poll does not reset the rotation

export function orb(canvas, { lanes = 0 } = {}) {
  const x = canvas.getContext?.('2d');
  if (!x) return null;
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--accent').trim() || '#7cc8ff';
  const dot = css.getPropertyValue('--ink2').trim() || '#a19c93';
  const W = canvas.width;
  const C = W / 2;
  const shell = [];
  const N = 900;
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const th = i * 2.399963;
    shell.push([Math.cos(th) * r, y, Math.sin(th) * r]);
  }
  const core = [];
  const count = Math.min(420, Math.max(0, lanes) * 70);
  for (let i = 0; i < count; i++) {
    const u = ((i * 0.754877) % 1) * 2 - 1;
    const t = ((i * 0.569840) % 1) * 6.283;
    const rr = Math.cbrt((i * 0.618034) % 1) * 0.45;
    const s = Math.sqrt(1 - u * u);
    core.push([s * Math.cos(t) * rr, u * rr, s * Math.sin(t) * rr, i % 6 === 0]);
  }
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const plot = (px, py, pz, ca, sa, size, colour, alpha) => {
    const X = px * ca + pz * sa;
    const Z = -px * sa + pz * ca;
    const s = (W * 0.476) / (2.6 - Z);
    x.globalAlpha = alpha(Z);
    x.fillStyle = colour;
    x.fillRect(C + X * s * 1.3 - 1, C + py * s * 1.3 - 1, size, size);
  };
  const draw = () => {
    x.clearRect(0, 0, W, W);
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    for (const [px, py, pz] of shell) plot(px, py, pz, ca, sa, 1.6, dot, (Z) => 0.12 + 0.35 * (Z + 1) / 2);
    for (const [px, py, pz, white] of core) plot(px * 1.6, py, pz, ca, sa, 2, white ? '#ffffff' : accent, () => 0.85);
    x.globalAlpha = 1;
  };
  const tick = () => {
    if (!canvas.isConnected) return; // a re-render replaced this canvas
    angle += 0.004;
    draw();
    requestAnimationFrame(tick);
  };
  if (still) draw();
  else requestAnimationFrame(tick);
  return { draw };
}
