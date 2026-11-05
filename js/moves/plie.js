"use strict";
// ---------- plié: per-frame checks (front view) ----------
// Bend = 180° − knee angle, averaged over both legs. Leg length uses thigh + shin, which doesn't shrink when bending.
// Knees over toes: a bent leg is a triangle hip–knee–ankle. With good turnout the knee bulges out toward the
// toes by the full height that triangle should have (from the leg length learned while standing); a knee that
// comes forward instead shows almost no bulge in a front view, and one that falls in bulges the wrong way.
// Score = sideways bulge ÷ expected bulge: ≈1 over the toes, ≈0 forward, < 0 falling in.
// The floor and the true leg length are learned while the knees are straight.
let plieBase = null, pliePos = "first";
function analyzePlie(lm, wlm){
  ctx.clearRect(0, 0, W(), H());
  if (!lm){ LIVE.forEach(k => setRow(liveEls, k, ["na", "noPerson"])); setPhaseChip(null); return; }
  const L = {}, R = {};
  for (const k of ["hip", "knee", "ankle", "heel", "toe"]){ L[k] = pt(lm, LEGS.left[k]); R[k] = pt(lm, LEGS.right[k]); }
  const ls = pt(lm, 11), rs = pt(lm, 12);
  const shMid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 }, hipMid = { x: (L.hip.x + R.hip.x) / 2, y: (L.hip.y + R.hip.y) / 2 };
  const torso = dist(shMid, hipMid) || 1;
  view = smooth("shw", dist(ls, rs) / torso) > 0.45 ? "front" : "side";
  const ok = (...ps) => Math.min(...ps.map(p => p.v)) >= VIS;
  const bendOf = (Lg, idx, key) => ok(Lg.hip, Lg.knee, Lg.ankle) ? Math.max(0, 180 - smooth(key, jointAngle(lm, wlm, idx.hip, idx.knee, idx.ankle))) : null;
  const bendL = bendOf(L, LEGS.left, "pAL"), bendR = bendOf(R, LEGS.right, "pAR");
  const bend = bendL != null && bendR != null ? (bendL + bendR) / 2 : (bendL ?? bendR);
  const segLen = ((dist(L.hip, L.knee) + dist(L.knee, L.ankle)) + (dist(R.hip, R.knee) + dist(R.knee, R.ankle))) / 2 || 1;
  const footRef = 0.27 * segLen;

  // learn the floor and the straight-leg baseline while standing
  if (bend != null && bend < 8 && ok(L.toe, R.toe, L.heel, R.heel)){
    const floor = Math.max(L.toe.y, R.toe.y, L.heel.y, R.heel.y);
    plieBase = plieBase ? { floor: plieBase.floor * 0.9 + floor * 0.1, seg: plieBase.seg * 0.9 + segLen * 0.1 } : { floor, seg: segLen };
  }
  // first or second position from how far apart the ankles are
  if (ok(L.ankle, R.ankle)){
    const gap = smooth("pGap", Math.abs(L.ankle.x - R.ankle.x) / segLen);
    pliePos = cfg.pPos !== "auto" ? cfg.pPos : gap > 0.24 ? "second" : "first";
  } else if (cfg.pPos !== "auto") pliePos = cfg.pPos;
  setText($("legInfo"), t("posInfo", t("pos_" + pliePos), cfg.pPos === "auto"));

  const out = {};
  // knees over toes
  const track = (Lg, b) => {
    if (b == null || b < 15 || !plieBase || !ok(Lg.hip, Lg.knee, Lg.ankle, Lg.toe)) return null;
    const toeSide = Lg.toe.x - Lg.ankle.x;
    if (Math.abs(toeSide) < 0.03 * plieBase.seg) return null;            // toes point at the camera: can't tell
    const dx = Lg.ankle.x - Lg.hip.x, dy = Lg.ankle.y - Lg.hip.y, D = Math.hypot(dx, dy) || 1;
    let nx = -dy / D, ny = dx / D;                                        // unit normal to the hip–ankle line…
    if (Math.sign(nx) !== Math.sign(toeSide)){ nx = -nx; ny = -ny; }      // …pointing toward the toes
    const bulge = (Lg.knee.x - Lg.hip.x) * nx + (Lg.knee.y - Lg.hip.y) * ny;
    const half = plieBase.seg / 2, expected = Math.sqrt(Math.max(0, half * half - (D / 2) ** 2));
    if (expected < 0.06 * plieBase.seg) return null;                      // barely bent yet
    return bulge / expected;
  };
  const kL = track(L, bendL), kR = track(R, bendR);
  const kMin = kL == null ? kR : kR == null ? kL : Math.min(kL, kR);
  out.kneesOver = kMin == null ? ["na", "whenBent"] : kMin >= cfg.kneeTrackMin ? ["ok", "kneeOk"] : ["bad", "kneeIn"];
  // heels
  let heelLift = null;
  if (plieBase && ok(L.heel, R.heel)) heelLift = smooth("pHeel", Math.max(plieBase.floor - L.heel.y, plieBase.floor - R.heel.y) / footRef);
  const heelAllowed = pliePos === "first" && bend != null && bend >= cfg.grandMin - 8;
  if (heelLift == null) out.heelsDown = ["na", plieBase ? "footUnclear" : "standFirst"];
  else if (heelLift <= cfg.demiH) out.heelsDown = ["ok", "heelsOn"];
  else out.heelsDown = heelAllowed ? ["ok", "heelsAllowed"] : ["bad", "heelsUp"];
  // upright: sideways lean of the shoulders-to-hips line
  let tilt = null;
  if (ok(ls, rs, L.hip, R.hip)){
    tilt = smooth("pTilt", Math.abs(Math.atan2(shMid.x - hipMid.x, hipMid.y - shMid.y)) * 180 / Math.PI);
    out.upright = [tilt <= cfg.tiltMax ? "ok" : "bad", "deg", tilt.toFixed(1) + "°"];
  } else out.upright = ["na", "unclear"];
  // hips level
  let hipTilt = null;
  if (view !== "front" || !ok(L.hip, R.hip)) out.level = ["na", "needFront"];
  else {
    hipTilt = smooth("pHips", Math.abs(Math.atan2(L.hip.y - R.hip.y, Math.abs(L.hip.x - R.hip.x))) * 180 / Math.PI);
    out.level = [hipTilt <= cfg.hipMax ? "ok" : "bad", "deg", hipTilt.toFixed(1) + "°"];
  }

  const ph = trackPlie({ t: video.currentTime, bend, bendL, bendR, kMin, heelLift, heelAllowed, tilt, hipTilt, pos: pliePos,
                         toe: { x: hipMid.x, y: hipMid.y }, toeVis: 1 });
  setPhaseChip(bend == null ? null : ph, bend == null ? "" : t("bendDeg", Math.round(bend)));
  for (const k of LIVE) setRow(liveEls, k, out[k]);
  drawPlie(lm, L, R, out);
  afterDraw();
  recordFrame(lm, wlm, bend == null ? null : ph, bend, heelLift);
  voice(out);
}

function drawPlie(lm, L, R, out){
  const col = s => s === "ok" ? css("--ok") : s === "bad" ? css("--bad") : "rgba(255,255,255,.75)";
  const lw = Math.max(3, W() / 220), neutral = "rgba(255,255,255,.55)";
  const seg = (a, b, c, w = lw, dash) => { if (a.v < 0.3 || b.v < 0.3) return; ctx.setLineDash(dash || []); ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]); };
  const P = i => pt(lm, i);
  ctx.lineCap = "round"; ctx.lineJoin = "round"; trail = [];
  [[11,13],[13,15],[12,14],[14,16]].forEach(([a, b]) => seg(P(a), P(b), neutral));
  const up = col(out.upright[0]);
  seg(P(11), P(12), up); seg(P(11), P(23), up); seg(P(12), P(24), up);
  seg(P(23), P(24), col(out.level[0]));
  const kc = col(out.kneesOver[0]), hc = out.heelsDown[0] === "bad" ? css("--bad") : "rgba(255,255,255,.9)";
  for (const Lg of [L, R]){
    seg(Lg.hip, Lg.knee, kc); seg(Lg.knee, Lg.ankle, kc);
    seg(Lg.ankle, Lg.heel, hc); seg(Lg.ankle, Lg.toe, hc); seg(Lg.heel, Lg.toe, hc);
    seg(Lg.knee, { x: Lg.toe.x, y: Lg.toe.y, v: Lg.toe.v }, "rgba(255,214,102,.8)", lw * 0.6, [lw * 1.5, lw * 1.5]);   // knee → toe guide
    for (const p of [Lg.hip, Lg.knee, Lg.ankle]){ if (p.v < 0.3) continue; ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(p.x, p.y, lw * 1.1, 0, Math.PI * 2); ctx.fill(); }
  }
}

// ---------- plié: one rep = down and back up ----------
// Phases: 10 standing, 11 going down, 12 at the bottom, 13 coming up.
function trackPlie(s){
  if (buf.length && s.t < buf[buf.length - 1].t) resetTracking();       // video looped
  buf.push(s);
  while (buf.length && s.t - buf[0].t > 3.0) buf.shift();
  if (s.bend == null) return rep ? 12 : 10;
  const prev = buf.filter(b => b.bend != null && s.t - b.t >= 0.2 && s.t - b.t <= 0.45).map(b => b.bend);
  const vel = prev.length ? s.bend - prev[0] : 0;                          // ° per ~0.3 s
  if (!rep){
    if (s.bend <= 12) return 10;
    let k = 0; buf.forEach((b, i) => { if (b.bend != null && b.bend <= 6) k = i; });
    rep = { module: "plie", start: buf[k].t, side: "both", max: s.bend, tMax: s.t, phase: "down", tUp: null, errors: new Set(),
            S: buf.slice(k), seen: new Set(), needStart: true, farDirty: true, hasFar: false };
  } else rep.S.push(s);
  if (s.bend > rep.max){ rep.max = s.bend; rep.tMax = s.t; rep.farDirty = true; }
  if (rep.phase === "down" && s.bend < rep.max - 6){ rep.phase = "up"; rep.tUp = s.t; }
  if (rep.max < 15 && s.bend < 6){ rep = null; return 10; }                // just a wobble
  if (rep.phase === "up" && s.bend < 7){ finishPlie(); return 10; }
  if (rep.phase === "up") return 13;
  return Math.abs(vel) < 3 && s.bend > 15 ? 12 : 11;
}

function judgePlie(S){
  const R = {};
  const V = S.filter(s => s.bend != null);
  if (V.length < 8){ REP.forEach(k => R[k] = ["na", "unclear"]); return { R, dir: null, V: null, mi: 0 }; }
  let mi = 0; V.forEach((s, i) => { if (s.bend > V[mi].bend) mi = i; });
  const max = V[mi].bend;
  const kind = max >= cfg.grandMin ? "grand" : "demi";
  const bottom = V.filter(s => s.bend >= max - 8);
  const pos = bottom.filter(s => s.pos === "second").length > bottom.length / 2 ? "second" : "first";
  V.forEach((s, i) => s.ph = s.bend < 8 ? 10 : s.bend >= max - 5 ? 12 : i < mi ? 11 : 13);

  R.depth = kind === "grand" ? ["ok", "depthDeg", Math.round(max)]
          : max >= cfg.pDemiMin ? ["ok", "depthDeg", Math.round(max)] : ["bad", "tooShallow", Math.round(max)];
  const kt = V.filter(s => s.kMin != null);
  if (!kt.length) R.kneeTrack = ["na", "toesHidden"];
  else { const bad = kt.filter(s => s.kMin < cfg.kneeTrackMin).length / kt.length;
         R.kneeTrack = bad <= 0.2 ? ["ok", "kneeOk"] : ["bad", "kneesInPct", pct(bad)]; }
  const hv = V.filter(s => s.heelLift != null);
  if (!hv.length) R.heels = ["na", "footUnclear"];
  else {
    const lifted = hv.filter(s => s.heelLift > cfg.demiH && !(pos === "first" && kind === "grand" && s.bend >= cfg.grandMin - 8));
    R.heels = !lifted.length ? ["ok", "heelsGood"]
            : kind === "demi" ? ["bad", "heelsUpDemi"] : pos === "second" ? ["bad", "heelsUp2nd"] : ["bad", "heelsEarly"];
  }
  const tl = V.filter(s => s.tilt != null).map(s => s.tilt);
  R.uprightRep = tl.length ? [Math.max(...tl) <= cfg.tiltMax ? "ok" : "bad", "deg", Math.max(...tl).toFixed(1) + "°"] : ["na", "unclear"];
  const hp = V.filter(s => s.hipTilt != null).map(s => s.hipTilt);
  R.levelRep = hp.length ? [Math.max(...hp) <= cfg.hipMax ? "ok" : "bad", "deg", Math.max(...hp).toFixed(1) + "°"] : ["na", "needFront"];
  const ev = V.filter(s => s.bendL != null && s.bendR != null && s.bend > 20).map(s => Math.abs(s.bendL - s.bendR));
  R.even = ev.length ? [Math.max(...ev) <= cfg.evenMax ? "ok" : "bad", "deg", Math.round(Math.max(...ev)) + "°"] : ["na", "unclear"];
  const tDown = V[mi].t - V[0].t, tUpDur = V[V.length - 1].t - V[mi].t;
  const ratio = tDown > 0.05 ? tUpDur / tDown : 1;
  const sp = `${tDown.toFixed(1)}s / ${tUpDur.toFixed(1)}s`;
  R.smooth = ratio < 0.5 ? ["bad", "fastUp", sp] : ratio > 2 ? ["bad", "fastDown", sp] : ["ok", "speedOk", sp];
  return { R, dir: `${pos}-${kind}`, V, mi };
}

function finishPlie(){
  const r = rep; rep = null; trailEnd = performance.now();
  if (video.currentTime - r.start < 0.6) return;
  commitRep(r, judgePlie(r.S));
}

// ---------- plié: drawings for the Learn page (front view) ----------
const PL = { first: { ankles: [114, 126] }, second: { ankles: [88, 152] } };
const PL_HIPS = [113, 127], SHIN = 40, ANK_Y = 227;
function plieSVG(pos, bend, o = {}){
  const v = PL[pos], err = o.err;
  const D = 2 * SHIN * Math.sin(rad(180 - bend) / 2);                      // hip-to-ankle distance at this bend
  const legs = [0, 1].map(i => {
    const ax = v.ankles[i], hx = PL_HIPS[i];
    const dx = hx - ax, dy = Math.sqrt(Math.max(1, D * D - dx * dx));
    const Hp = { x: hx, y: ANK_Y - dy }, A = { x: ax, y: ANK_Y };
    const M = { x: (Hp.x + A.x) / 2, y: (Hp.y + A.y) / 2 }, h = Math.sqrt(Math.max(0, SHIN * SHIN - (D / 2) ** 2));
    let px = -(A.y - Hp.y) / D, py = (A.x - Hp.x) / D;                      // unit perpendicular to the leg
    const outward = i === 0 ? -1 : 1;
    if (Math.sign(px || outward) !== outward) { px = -px; py = -py; }
    const dirn = err === "kneesIn" ? -1 : 1;
    const K = { x: M.x + px * h * dirn, y: M.y + py * h * dirn };
    return { Hp, K, A, outward };
  });
  const standY = ANK_Y - Math.sqrt(4 * SHIN * SHIN - (PL_HIPS[0] - v.ankles[0]) ** 2);
  const drop = legs[0].Hp.y - standY;
  const heelUp = err === "heelsUp" ? 9 : (pos === "first" && bend > 75 ? (bend - 75) / 25 * 9 : 0);
  const vb = o.tight ? [22, 30, 202, 232] : [0, 0, 240, 262];
  const s = [`<svg viewBox="${vb.join(" ")}" role="img" aria-label="${esc(o.alt || "plié")}">`];
  s.push(floorSVG());
  for (const g of legs){
    s.push(`<path d="M${r1(g.Hp.x)} ${r1(g.Hp.y)} L${r1(g.K.x)} ${r1(g.K.y)} L${r1(g.A.x)} ${r1(g.A.y)}" stroke="#ffd2df" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`);
    const toeX = g.A.x + g.outward * 24, heelX = g.A.x - g.outward * 2;
    s.push(heelUp > 0
      ? `<path d="M${r1(heelX)} ${r1(FL - 2 - heelUp)} L${r1(g.A.x + g.outward * 14)} ${FL - 1} L${r1(toeX)} ${FL - 1}" stroke="#f47aa8" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`
      : `<path d="M${r1(heelX)} ${FL - 2} L${r1(toeX)} ${FL - 1}" stroke="#f47aa8" stroke-width="9" stroke-linecap="round"/>`);
    if (o.guide) s.push(`<line x1="${r1(g.K.x)}" y1="${r1(g.K.y)}" x2="${r1(toeX)}" y2="${FL - 1}" stroke="#f2b33d" stroke-width="2" stroke-dasharray="4 4"/>`);
  }
  const tiltT = err === "tilt" ? ` rotate(-8 120 ${r1(150 + drop)})` : "";
  s.push(`<g transform="translate(0 ${r1(drop)})${tiltT}"><use href="#dancerTop" x="0" y="0" width="240" height="262"/></g>`);
  if (o.arrow){
    const x = 214, y1 = o.arrow === "down" ? 120 : 190, y2 = o.arrow === "down" ? 190 : 120, dir = Math.sign(y2 - y1);
    s.push(`<path d="M${x} ${y1} L${x} ${y2 - dir * 6}" stroke="#cf3577" stroke-width="3" stroke-linecap="round"/><path d="M${x} ${y2} L${x - 6} ${y2 - dir * 9} L${x + 6} ${y2 - dir * 9} Z" fill="#cf3577"/>`);
  }
  if (o.mark){
    const c = o.focus === "knee" ? legs[1].K : o.focus === "heel" ? { x: legs[1].A.x, y: FL - 4 } : { x: 120, y: 110 + drop };
    s.push(markSVG(o.mark, c, vb, o.focus === "torso" ? 30 : 17));
  }
  s.push(`</svg>`);
  return { svg: s.join("") };
}
// demi down–up, then grand down–up
const PCYCLE = 9.6;
function plieAnimAt(sec){
  const tt = sec % PCYCLE;
  return span(tt, 0, 0.6, 0, 0, "stand") || span(tt, 0.6, 2.2, 0, 48, "down") || span(tt, 2.2, 2.7, 48, 48, "bottom") || span(tt, 2.7, 4.3, 48, 0, "up")
      || span(tt, 4.3, 4.9, 0, 0, "stand") || span(tt, 4.9, 7.0, 0, 98, "down") || span(tt, 7.0, 7.5, 98, 98, "bottom") || span(tt, 7.5, 9.6, 98, 0, "up") || [0, "stand"];
}
const PSTAGE_PH = { stand: 10, down: 11, bottom: 12, up: 13 };
const PLIE_STEPS = [[0, null], [30, "down"], [48, null], [98, null], [30, "up"]];
const PLIE_MISTAKES = [["kneesIn", "knee", 48], ["heelsUp", "heel", 48], ["tilt", "torso", 48]];

const plieFrame = (pos, e, st, kind) => { const ph = PSTAGE_PH[st]; return { svg: plieSVG(pos, e, { guide: true, alt: t("lTitleP") }).svg, ph, caption: (kind === "grand" ? "Grand plié" : "Demi-plié") + " · " + t(PHASES[ph][0]) }; };
registerMove({
  id: "plie", dirs: ["first-demi", "first-grand", "second-demi", "second-grand"], oneLeg: false,
  live: ["kneesOver", "heelsDown", "upright", "level"],
  rep:  ["depth", "kneeTrack", "heels", "uprightRep", "levelRep", "even", "smooth"],
  rate: ["depth", "kneeTrack", "heels", "uprightRep", "levelRep", "even", "smooth"],
  analyze: analyzePlie,
  framing: () => view === "side" ? "fgFront" : null,
  // "first-demi" → "一位 · Demi-plié"
  dirLabel: d => d.includes("-") ? t("pos_" + d.split("-")[0]) + " · " + (d.endsWith("grand") ? "Grand plié" : "Demi-plié") : d,
  axes: ["axStart", "axBottom", "axUp"], snaps: [["start", "snapStart"], ["far", "axBottom"], ["close", "axUp"]],
  legend: [["--ph-flat", "pp_stand"], ["--ph-demi", "pp_down"], ["--ph-point", "pp_bottom"], ["--ph-up", "pp_up"], ["#ffd666", "lgGuide"], ["--ok", "lgOk"], ["--bad", "lgBad"]],
  tips: ["tipP1", "tipP2", "tip3", "tip4"], repEmpty: "repEmpty_plie", reportTitle: "rpTitleP",
  thumb: () => plieSVG("second", 70, { tight: true }).svg,
  learn: {
    title: "lTitleP", intro: "lIntroP", tabs: ["first", "second"], tabLabel: p => t("pos_" + p), badge: () => "viewFront",
    track: [10, 11, 12, 13],
    frame: (pos, sec) => { const [e, st] = plieAnimAt(sec); return plieFrame(pos, e, st, (sec % PCYCLE) < 4.6 ? "demi" : "grand"); },
    paused: pos => plieFrame(pos, 48, "bottom", "demi"),
    tips: pos => ["tipP_knees", "tipP_upright", "tipP_" + pos],
    steps: pos => PLIE_STEPS.map(([b, arrow], i) => ({ svg: plieSVG(pos, b, { tight: true, arrow, guide: i === 1 || i === 2, alt: t(`sp_${pos}_${i + 1}`) }).svg, text: t(`sp_${pos}_${i + 1}`) })),
    mistakes: pos => PLIE_MISTAKES.map(([err, focus, b]) => ({
      bad: plieSVG(pos, b, { tight: true, err, mark: "bad", focus, guide: err === "kneesIn", alt: t(`mp_${err}_bad`) }).svg, badText: t(`mp_${err}_bad`),
      good: plieSVG(pos, b, { tight: true, mark: "good", focus, guide: err === "kneesIn", alt: t(`mp_${err}_good`) }).svg, goodText: t(`mp_${err}_good`) })),
  },
});
