"use strict";
// ---------- relevé (front view) ----------
// Rise onto demi-pointe with both feet, hold, lower slowly. Filmed from the front.
// Height = how far each heel rises above where it rested while standing flat, in foot lengths
// (a foot ≈ 27% of thigh + shin). The resting heel height is learned while she stands flat.
// Phases: 20 flat, 21 rising, 22 at the top, 23 lowering.
let relBase = null, relPos = "first";
function analyzeReleve(lm, wlm){
  ctx.clearRect(0, 0, W(), H());
  if (!lm){ LIVE.forEach(k => setRow(liveEls, k, ["na", "noPerson"])); setPhaseChip(null); return; }
  const L = {}, R = {};
  for (const k of ["hip", "knee", "ankle", "heel", "toe"]){ L[k] = pt(lm, LEGS.left[k]); R[k] = pt(lm, LEGS.right[k]); }
  const ls = pt(lm, 11), rs = pt(lm, 12);
  const shMid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 }, hipMid = { x: (L.hip.x + R.hip.x) / 2, y: (L.hip.y + R.hip.y) / 2 };
  const torso = dist(shMid, hipMid) || 1;
  view = smooth("shw", dist(ls, rs) / torso) > 0.45 ? "front" : "side";
  const ok = (...ps) => Math.min(...ps.map(p => p.v)) >= VIS;
  const segLen = ((dist(L.hip, L.knee) + dist(L.knee, L.ankle)) + (dist(R.hip, R.knee) + dist(R.knee, R.ankle))) / 2 || 1;
  const footRef = 0.27 * segLen;

  // resting heel heights: learned while both heels are down (not higher than the baseline) and no rep is running
  let liftL = null, liftR = null, h = null;
  if (ok(L.heel, R.heel)){
    if (!relBase) relBase = { hL: L.heel.y, hR: R.heel.y, hip: hipMid.y };
    liftL = (relBase.hL - L.heel.y) / footRef; liftR = (relBase.hR - R.heel.y) / footRef;
    if (!rep && Math.abs(liftL) < 0.05 && Math.abs(liftR) < 0.05){        // only while really flat, so a slow rise doesn't drag it up
      relBase = { hL: relBase.hL * 0.9 + L.heel.y * 0.1, hR: relBase.hR * 0.9 + R.heel.y * 0.1, hip: relBase.hip * 0.9 + hipMid.y * 0.1 };
      liftL = (relBase.hL - L.heel.y) / footRef; liftR = (relBase.hR - R.heel.y) / footRef;
    }
    liftL = smooth("rL", Math.max(0, liftL)); liftR = smooth("rR", Math.max(0, liftR));
    h = (liftL + liftR) / 2;
  }
  // first or second position from how far apart the ankles are
  if (ok(L.ankle, R.ankle)){
    const gap = smooth("rGap", Math.abs(L.ankle.x - R.ankle.x) / segLen);
    relPos = cfg.pPos !== "auto" ? cfg.pPos : gap > 0.24 ? "second" : "first";
  } else if (cfg.pPos !== "auto") relPos = cfg.pPos;
  setText($("legInfo"), t("posInfo", t("pos_" + relPos), cfg.pPos === "auto"));

  const out = {};
  // knees straight (the bent one counts)
  const kA = (Lg, idx, key) => ok(Lg.hip, Lg.knee, Lg.ankle) ? smooth(key, jointAngle(lm, wlm, idx.hip, idx.knee, idx.ankle)) : null;
  const kL = kA(L, LEGS.left, "rkL"), kR = kA(R, LEGS.right, "rkR");
  const kMin = kL == null ? kR : kR == null ? kL : Math.min(kL, kR);
  out.knees = kMin == null ? ["na", "unclear"] : [kMin >= cfg.kneeMin ? "ok" : "bad", "deg", Math.round(kMin) + "°"];
  // upright
  let tilt = null;
  if (ok(ls, rs, L.hip, R.hip)){
    tilt = smooth("rTilt", Math.abs(Math.atan2(shMid.x - hipMid.x, hipMid.y - shMid.y)) * 180 / Math.PI);
    out.upright = [tilt <= cfg.tiltMax ? "ok" : "bad", "deg", tilt.toFixed(1) + "°"];
  } else out.upright = ["na", "unclear"];
  // hips level
  if (view !== "front" || !ok(L.hip, R.hip)) out.level = ["na", "needFront"];
  else {
    const ht = smooth("rHips", Math.abs(Math.atan2(L.hip.y - R.hip.y, Math.abs(L.hip.x - R.hip.x))) * 180 / Math.PI);
    out.level = [ht <= cfg.hipMax ? "ok" : "bad", "deg", ht.toFixed(1) + "°"];
  }
  // both heels rise the same amount
  const diff = h == null ? null : Math.abs(liftL - liftR);
  if (h == null) out.evenUp = ["na", "footUnclear"];
  else if (h < 0.2) out.evenUp = ["na", "whenUp"];
  else out.evenUp = [diff <= cfg.relEven ? "ok" : "bad", diff <= cfg.relEven ? "evenOk" : "uneven", diff.toFixed(2)];

  const ankX = ok(L.ankle, R.ankle) ? (L.ankle.x + R.ankle.x) / 2 : hipMid.x;
  const ph = trackReleve({ t: video.currentTime, h, diff, kMin, tilt, x: (hipMid.x - ankX) / segLen, pos: relPos, toe: { x: hipMid.x, y: hipMid.y }, toeVis: 1 });
  setPhaseChip(h == null ? null : ph, h == null ? "" : t("heel", h.toFixed(2)));
  for (const k of LIVE) setRow(liveEls, k, out[k]);
  drawReleve(lm, L, R, out);
  afterDraw();
  recordFrame(lm, wlm, h == null ? null : ph, null, h);
  voice(out);
}

function drawReleve(lm, L, R, out){
  const col = s => s === "ok" ? css("--ok") : s === "bad" ? css("--bad") : "rgba(255,255,255,.75)";
  const lw = Math.max(3, W() / 220), neutral = "rgba(255,255,255,.55)";
  const seg = (a, b, c) => { if (a.v < 0.3 || b.v < 0.3) return; ctx.strokeStyle = c; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };
  const P = i => pt(lm, i);
  ctx.lineCap = "round"; ctx.lineJoin = "round"; trail = [];
  [[11,13],[13,15],[12,14],[14,16]].forEach(([a, b]) => seg(P(a), P(b), neutral));
  const up = col(out.upright[0]);
  seg(P(11), P(12), up); seg(P(11), P(23), up); seg(P(12), P(24), up);
  seg(P(23), P(24), col(out.level[0]));
  const kc = col(out.knees[0]), fc = out.evenUp[0] === "bad" ? css("--bad") : "rgba(255,255,255,.9)";
  for (const Lg of [L, R]){
    seg(Lg.hip, Lg.knee, kc); seg(Lg.knee, Lg.ankle, kc);
    seg(Lg.ankle, Lg.heel, fc); seg(Lg.ankle, Lg.toe, fc); seg(Lg.heel, Lg.toe, fc);
    for (const p of [Lg.hip, Lg.knee, Lg.ankle, Lg.heel]){ if (p.v < 0.3) continue; ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(p.x, p.y, lw * 1.1, 0, Math.PI * 2); ctx.fill(); }
  }
}

// ---------- one rep = up, (hold), down ----------
function trackReleve(s){
  if (buf.length && s.t < buf[buf.length - 1].t) resetTracking();       // video looped
  buf.push(s);
  while (buf.length && s.t - buf[0].t > 3.0) buf.shift();
  if (s.h == null) return rep ? 22 : 20;
  if (!rep){
    if (s.h < 0.15) return 20;
    let k = 0; buf.forEach((b, i) => { if (b.h != null && b.h < 0.06) k = i; });
    rep = { start: buf[k].t, side: "both", max: s.h, phase: "up", errors: new Set(), S: buf.slice(k), seen: new Set(),
            needStart: true, farDirty: true, hasFar: false };
  } else rep.S.push(s);
  if (s.h > rep.max){ rep.max = s.h; if (rep.phase === "up") rep.farDirty = true; }
  if (rep.max < 0.2 && s.h < 0.08){ rep = null; return 20; }              // just a wobble
  if (rep.phase === "up" && rep.max >= 0.2 && s.h < rep.max - 0.12) rep.phase = "down";
  if (rep.phase === "down" && s.h < 0.08){ finishReleve(); return 20; }
  if (rep.phase === "down") return 23;
  const prev = buf.filter(b => b.h != null && s.t - b.t >= 0.2 && s.t - b.t <= 0.45).map(b => b.h);
  const vel = prev.length ? s.h - prev[0] : 0;                             // foot lengths per ~0.3 s
  return Math.abs(vel) < 0.06 && s.h >= rep.max - 0.1 ? 22 : 21;
}

function judgeReleve(S){
  const R = {};
  const V = S.filter(s => s.h != null);
  if (V.length < 8){ REP.forEach(k => R[k] = ["na", "unclear"]); return { R, dir: null, note: null, V: null, mi: 0 }; }
  let mi = 0; V.forEach((s, i) => { if (s.h > V[mi].h) mi = i; });
  const max = V[mi].h;
  const isTop = s => s.h >= max - 0.1;
  const first = V.findIndex(isTop), last = V.length - 1 - [...V].reverse().findIndex(isTop);
  V.forEach((s, i) => s.ph = s.h < 0.08 ? 20 : i >= first && i <= last && isTop(s) ? 22 : i < first ? 21 : i > last ? 23 : 22);
  const top = V.slice(first, last + 1);
  const pos = top.filter(s => s.pos === "second").length > top.length / 2 ? "second" : "first";

  R.rise = max >= cfg.relMin ? ["ok", "riseOk", max.toFixed(2)] : ["bad", "riseLow", max.toFixed(2)];
  const kn = median(top.filter(s => s.kMin != null).map(s => s.kMin));
  R.kneesTop = kn == null ? ["na", "unclear"] : kn >= cfg.kneeMin ? ["ok", "deg", Math.round(kn) + "°"] : ["bad", "kneesBentTop", Math.round(kn)];
  const df = median(top.filter(s => s.diff != null).map(s => s.diff));
  R.evenRep = df == null ? ["na", "footUnclear"] : df <= cfg.relEven ? ["ok", "evenOk", df.toFixed(2)] : ["bad", "uneven", df.toFixed(2)];
  const tl = V.filter(s => s.tilt != null).map(s => s.tilt);
  R.uprightRep = tl.length ? [Math.max(...tl) <= cfg.tiltMax ? "ok" : "bad", "deg", Math.max(...tl).toFixed(1) + "°"] : ["na", "unclear"];
  // balance at the top: how far the hips drift sideways (share of leg length)
  const xs = top.map(s => s.x);
  const sway = xs.length >= 3 ? Math.max(...xs) - Math.min(...xs) : null;
  R.steady = sway == null ? ["na", "tooShort"] : sway <= cfg.swayMax ? ["ok", "steadyOk", pct(sway)] : ["bad", "wobbly", pct(sway)];
  // lowering at least relLower × as long as rising
  const up0 = V.findIndex(s => s.h >= 0.1), dn1 = V.findIndex((s, i) => i > last && s.h < 0.1);
  const tUp = V[first].t - V[Math.max(0, up0)].t, tDown = (dn1 >= 0 ? V[dn1] : V[V.length - 1]).t - V[last].t;
  const sp = `${tUp.toFixed(1)}s / ${tDown.toFixed(1)}s`;
  R.controlDown = tUp < 0.05 ? ["na", "tooShort"] : tDown >= tUp * cfg.relLower ? ["ok", "lowerOk", sp] : ["bad", "dropped", sp];
  const hold = V[last].t - V[first].t;
  return { R, dir: pos, note: ["holdInfo", hold.toFixed(1)], V, mi };
}

function finishReleve(){
  const r = rep; rep = null; trailEnd = performance.now();
  if (video.currentTime - r.start < 0.5) return;
  commitRep(r, judgeReleve(r.S));
}

// ---------- drawings for the Learn page (front view) ----------
// rise 0..1: heel lift; the whole body goes up with it. o.err: "low" | "bentKnees" | "tilt"
function releveSVG(pos, rise, o = {}){
  const err = o.err, v = PL[pos];
  const lift = (err === "low" ? Math.min(rise, 0.35) : rise) * 15;        // px the heel (and the body) goes up
  const sink = err === "bentKnees" ? 7 : 0;
  const standY = ANK_Y - Math.sqrt(4 * SHIN * SHIN - (PL_HIPS[0] - v.ankles[0]) ** 2);
  const vb = o.tight ? [22, 20, 202, 242] : [0, 0, 240, 262];
  const s = [`<svg viewBox="${vb.join(" ")}" role="img" aria-label="${esc(o.alt || "relevé")}">`];
  s.push(floorSVG());
  const knees = [];
  [0, 1].forEach(i => {
    const out = i === 0 ? -1 : 1;
    const A = { x: v.ankles[i], y: ANK_Y - lift }, Hp = { x: PL_HIPS[i], y: standY - lift + sink };
    const K = { x: (A.x + Hp.x) / 2 + (sink ? out * 8 : 0), y: (A.y + Hp.y) / 2 };
    knees.push(K);
    s.push(legPath(Hp, K, A));
    const ball = { x: A.x + out * 13, y: FL - 1 }, toe = { x: A.x + out * 24, y: FL - 1 }, heel = { x: A.x - out * 2, y: FL - 2 - lift * 1.15 };
    s.push(lift > 0.5 ? `<path d="M${r1(heel.x)} ${r1(heel.y)} L${r1(ball.x)} ${r1(ball.y)} L${r1(toe.x)} ${r1(toe.y)}" stroke="#f47aa8" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`
                      : `<path d="M${r1(heel.x)} ${FL - 2} L${r1(toe.x)} ${FL - 1}" stroke="#f47aa8" stroke-width="9" stroke-linecap="round"/>`);
  });
  const dy = sink - lift;                                                // the upper body moves with the hips
  const tiltT = err === "tilt" ? ` rotate(-8 120 ${r1(150 + dy)})` : "";
  s.push(`<g transform="translate(0 ${r1(dy)})${tiltT}"><use href="#dancerTop" x="0" y="0" width="240" height="262"/></g>`);
  if (o.arrow) s.push(vArrowSVG(214, o.arrow === "up" ? 190 : 120, o.arrow === "up" ? 120 : 190));
  if (o.mark){
    const c = o.focus === "knee" ? knees[1] : o.focus === "heel" ? { x: v.ankles[1], y: FL - 6 - lift } : { x: 120, y: 110 + dy };
    s.push(markSVG(o.mark, c, vb, o.focus === "torso" ? 30 : 17));
  }
  s.push(`</svg>`);
  return s.join("");
}
const RCYCLE = 5.2;
function releveAnimAt(sec){
  const tt = sec % RCYCLE;
  return span(tt, 0, 0.7, 0, 0, "stand") || span(tt, 0.7, 1.8, 0, 1, "rise") || span(tt, 1.8, 3.0, 1, 1, "top") || span(tt, 3.0, 4.5, 1, 0, "lower") || [0, "stand"];
}
const RSTAGE_PH = { stand: 20, rise: 21, top: 22, lower: 23 };
const releveFrame = (pos, r, st) => { const ph = RSTAGE_PH[st]; return { svg: releveSVG(pos, r, { alt: t("mod_releve") }), ph, caption: t(PHASES[ph][0]) }; };
const RELEVE_STEPS = [[0, null], [0.5, "up"], [1, null], [0.5, "down"], [0, null]];
const RELEVE_MISTAKES = [["low", "heel"], ["bentKnees", "knee"], ["tilt", "torso"]];

registerMove({
  id: "releve", dirs: ["first", "second"], oneLeg: false,
  live: ["knees", "upright", "level", "evenUp"],
  rep:  ["rise", "kneesTop", "evenRep", "uprightRep", "steady", "controlDown"],
  rate: ["rise", "kneesTop", "evenRep", "uprightRep", "steady", "controlDown"],
  analyze: analyzeReleve,
  framing: () => view === "side" ? "fgFront" : null,
  dirLabel: p => t("pos_" + p) + " · Relevé",
  axes: ["axStart", "axTop", "axDown"], snaps: [["start", "snapStart"], ["far", "axTop"], ["close", "axDown"]],
  legend: [["--ph-flat", "rp_flat"], ["--ph-demi", "rp_up"], ["--ph-point", "rp_top"], ["--ph-up", "rp_down"], ["--ok", "lgOk"], ["--bad", "lgBad"]],
  tips: ["tipR1", "tipR2", "tip3", "tip4"], repEmpty: "repEmpty_releve", reportTitle: "rpTitle_releve",
  thumb: () => releveSVG("first", 1, { tight: true }),
  learn: {
    title: "lTitle_releve", intro: "lIntro_releve", tabs: ["first", "second"], tabLabel: p => t("pos_" + p), badge: () => "viewFront",
    track: [20, 21, 22, 23],
    frame: (pos, sec) => releveFrame(pos, ...releveAnimAt(sec)),
    paused: pos => releveFrame(pos, 1, "top"),
    tips: () => ["tipR_knees", "tipR_high", "tipR_down"],
    steps: pos => RELEVE_STEPS.map(([r, arrow], i) => ({ svg: releveSVG(pos, r, { tight: true, arrow, alt: t(`s_releve_${i + 1}`) }), text: t(`s_releve_${i + 1}`) })),
    mistakes: pos => RELEVE_MISTAKES.map(([err, focus]) => ({
      bad: releveSVG(pos, 1, { tight: true, err, mark: "bad", focus, alt: t(`mr_${err}_bad`) }), badText: t(`mr_${err}_bad`),
      good: releveSVG(pos, 1, { tight: true, mark: "good", focus, alt: t(`mr_${err}_good`) }), goodText: t(`mr_${err}_good`) })),
  },
});
