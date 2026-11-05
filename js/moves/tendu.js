"use strict";
// ---------- the tendu family: tendu, dégagé, grand battement ----------
// All three brush the working foot out along the floor first, so they share one engine:
// per-frame checks (knees, hips, foot phase), the rep tracker and most of the per-rep judgement.
// TF holds what differs: whether the leg leaves the floor, how far out a pause still counts as
// "on the way back", extra hip tolerance at height, and whether the torso is watched.
const TF = {
  tendu:     { lift: false, stableFrac: 0.5,  hipExtra: 0 },
  degage:    { lift: true,  stableFrac: 0.35, hipExtra: 2 },
  battement: { lift: true,  stableFrac: 0.25, hipExtra: 6, torso: true },
};
let torsoBase = null;

function analyzeTendu(lm, wlm){
  const F = TF[mod];
  ctx.clearRect(0, 0, W(), H());
  if (!lm){ LIVE.forEach(k => setRow(liveEls, k, ["na", "noPerson"])); setPhaseChip(null); return; }

  const L = {}, R = {};
  for (const k of ["hip","knee","ankle","heel","toe"]){ L[k] = pt(lm, LEGS.left[k]); R[k] = pt(lm, LEGS.right[k]); }
  const leanL = smooth("leanL", legLean(L.hip, L.ankle)), leanR = smooth("leanR", legLean(R.hip, R.ankle));

  // camera view (front vs side) and which way she faces (side view)
  const ls = pt(lm, 11), rs = pt(lm, 12);
  const shMid = { x:(ls.x+rs.x)/2, y:(ls.y+rs.y)/2 }, hipMid = { x:(L.hip.x+R.hip.x)/2, y:(L.hip.y+R.hip.y)/2 };
  const torso = dist(shMid, hipMid) || 1;
  view = smooth("shw", dist(ls, rs) / torso) > 0.45 ? "front" : "side";
  const nose = pt(lm, 0), earX = (lm[7].x + lm[8].x) / 2 * W();
  const f = smooth("facing", nose.x - earX);
  facing = Math.abs(f) < 0.02 * torso ? 0 : Math.sign(f);

  // which leg is working
  if (cfg.leg !== "auto") workSide = cfg.leg;
  else if (Math.max(leanL, leanR) > 9 && Math.abs(leanL - leanR) > 5) workSide = leanL > leanR ? "left" : "right";
  const work = workSide === "left" ? L : R, sup = workSide === "left" ? R : L;
  const workLean = workSide === "left" ? leanL : leanR;
  lastLeg = workSide;
  setText($("legInfo"), t("legInfo", t(workSide), cfg.leg === "auto"));

  const legLen = dist(sup.hip, sup.ankle) || 1;
  const footRef = 0.27 * legLen;               // a foot is roughly 27% of hip-to-ankle length
  const extended = workLean > 12;
  const out = {};

  // knees
  const otherSide = workSide === "left" ? "right" : "left";
  for (const [key, leg, idx] of [["workKnee", work, LEGS[workSide]], ["supportKnee", sup, LEGS[otherSide]]]){
    if (Math.min(leg.hip.v, leg.knee.v, leg.ankle.v) < VIS){ out[key] = ["na", "unclear"]; continue; }
    const a = smooth(key, jointAngle(lm, wlm, idx.hip, idx.knee, idx.ankle));
    out[key] = [a >= cfg.kneeMin ? "ok" : "bad", "deg", Math.round(a) + "°"];
  }
  // hips level (front view only); a high battement à la seconde gets a little more room
  if (view !== "front" || Math.min(L.hip.v, R.hip.v) < VIS) out.hips = ["na", "needFront"];
  else {
    const tilt = smooth("hips", Math.abs(Math.atan2(L.hip.y - R.hip.y, Math.abs(L.hip.x - R.hip.x))) * 180 / Math.PI);
    out.hips = [tilt <= cfg.hipMax + F.hipExtra ? "ok" : "bad", "deg", tilt.toFixed(1) + "°"];
  }
  // torso: how far the shoulders-over-hips line moved from where it was while standing
  let torsoDev = null;
  if (F.torso){
    if (Math.min(ls.v, rs.v, L.hip.v, R.hip.v) >= VIS){
      const a = smooth("torsoA", Math.atan2(shMid.x - hipMid.x, hipMid.y - shMid.y) * 180 / Math.PI);
      if (workLean < 6 && !rep) torsoBase = torsoBase == null ? a : torsoBase * 0.9 + a * 0.1;
      if (torsoBase != null) torsoDev = Math.abs(a - torsoBase);
    }
    if (torsoDev == null) out.torso = ["na", torsoBase == null ? "standFirst" : "unclear"];
    else if (!(extended || rep)) out.torso = ["na", "whenOut"];
    else out.torso = [torsoDev <= cfg.torsoMax ? "ok" : "bad", "deg", Math.round(torsoDev) + "°"];
  }

  // foot phase: from heel height and toe height above the floor (floor = standing foot)
  let ph = null, heelH = null, toeLift = null;
  if (Math.min(work.toe.v, work.heel.v, sup.toe.v, sup.heel.v) >= VIS){
    const floorY = Math.max(sup.toe.y, sup.heel.y);
    heelH = smooth("heelH", (floorY - work.heel.y) / footRef);
    toeLift = smooth("toeLift", (floorY - work.toe.y) / legLen);
    ph = toeLift > cfg.toeMax ? (F.lift ? 3 : -1) : heelH >= cfg.pointH ? 2 : heelH >= cfg.demiH ? 1 : 0;
  }
  if (LIVE.includes("toe")){
    if (!(extended || rep)) out.toe = ["na", "whenOut"];
    else if (ph === null) out.toe = ["na", "footUnclear"];
    else out.toe = ph === -1 ? ["bad", "lifted", pct(toeLift)] : ["ok", "onFloor"];
  }
  setPhaseChip(ph, heelH == null ? "" : F.lift && ph === 3 ? t("deg", Math.round(workLean) + "°") : t("heel", heelH.toFixed(2)));

  // instep: knee–ankle–toe angle of the working foot (≈180° when the foot is fully stretched)
  const wi = LEGS[workSide];
  const ankA = Math.min(work.knee.v, work.ankle.v, work.toe.v) >= VIS ? smooth("ankA", jointAngle(lm, wlm, wi.knee, wi.ankle, wi.toe)) : null;
  // standing-knee hyperextension (side view): the knee sits BEHIND the hip–ankle line instead of on or in front of it
  let hyper = null;
  if (view === "side" && facing && Math.min(sup.hip.v, sup.knee.v, sup.ankle.v) >= VIS && Math.abs(sup.ankle.y - sup.hip.y) > 1){
    const lineX = sup.hip.x + (sup.ankle.x - sup.hip.x) * (sup.knee.y - sup.hip.y) / (sup.ankle.y - sup.hip.y);
    const bendS = 180 - angle(sup.hip, sup.knee, sup.ankle);
    hyper = smooth("hyper", (sup.knee.x - lineX) * facing < 0 ? bendS : -bendS);
  }
  trackRep({ t: video.currentTime, lean: workLean, ph, ankA, hyper, torso: torsoDev, toe: { x: work.toe.x, y: work.toe.y }, toeVis: work.toe.v }, out, work, sup, legLen, footRef);

  for (const k of LIVE) setRow(liveEls, k, out[k]);
  draw(lm, work, sup, out);
  afterDraw();
  recordFrame(lm, wlm, ph, workLean, heelH);
  voice(out);
}

// ---------- drawing on the video ----------
function draw(lm, work, sup, out){
  const col = s => s === "ok" ? css("--ok") : s === "bad" ? css("--bad") : "rgba(255,255,255,.75)";
  const lw = Math.max(3, W() / 220);
  const seg = (a, b, c) => { if (a.v < 0.3 || b.v < 0.3) return; ctx.strokeStyle = c; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };
  const P = i => pt(lm, i), neutral = "rgba(255,255,255,.55)";
  ctx.lineCap = "round"; ctx.lineJoin = "round";

  // toe trail, coloured by foot phase
  if (!rep && trail.length && performance.now() - trailEnd > 5000) trail = [];
  if (trail.length > 1){
    ctx.lineWidth = lw * 1.1;
    for (let i = 1; i < trail.length; i++){
      ctx.strokeStyle = trail[i].ph === null ? neutral : css(PHASES[trail[i].ph][1]);
      ctx.beginPath(); ctx.moveTo(trail[i-1].x, trail[i-1].y); ctx.lineTo(trail[i].x, trail[i].y); ctx.stroke();
    }
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(trail[0].x, trail[0].y, lw * 1.4, 0, Math.PI * 2); ctx.fill();
  }

  const body = out.torso ? col(out.torso[0]) : neutral;
  [[11,13],[13,15],[12,14],[14,16]].forEach(([a,b]) => seg(P(a), P(b), neutral));
  [[11,12],[11,23],[12,24]].forEach(([a,b]) => seg(P(a), P(b), body));
  seg(P(23), P(24), col(out.hips[0]));
  seg(work.hip, work.knee, col(out.workKnee[0])); seg(work.knee, work.ankle, col(out.workKnee[0]));
  seg(sup.hip, sup.knee, col(out.supportKnee[0])); seg(sup.knee, sup.ankle, col(out.supportKnee[0]));
  const footCol = out.toe && out.toe[0] === "bad" ? css("--bad") : "rgba(255,255,255,.9)";
  seg(work.ankle, work.heel, footCol); seg(work.ankle, work.toe, footCol); seg(work.heel, work.toe, footCol);
  seg(sup.ankle, sup.heel, neutral); seg(sup.ankle, sup.toe, neutral); seg(sup.heel, sup.toe, neutral);
  for (const p of [work.hip, work.knee, work.ankle, work.heel, work.toe, sup.hip, sup.knee, sup.ankle]){
    if (p.v < 0.3) continue; ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(p.x, p.y, lw * 1.1, 0, Math.PI * 2); ctx.fill();
  }
}

// ---------- rep tracking ----------
// A rep starts when the working leg leans > 7° and counts once it passes 12°.
// The last 3 s of frames are buffered so the start of the slide (flat-foot phase) is kept:
// the rep is back-dated to the last moment the leg was still at rest.
// Progress is measured by the toe's distance from where it started (not the leg angle,
// which returns to vertical while a flat foot is still out). The rep ends when the toe
// is back home or stops on the way back, or if it goes out again without closing.
// Timing uses the video's own clock, so slow-motion playback behaves the same.
function trackRep(s, out, work, sup, legLen, footRef){
  const F = TF[mod];
  if (buf.length && s.t < buf[buf.length - 1].t) resetTracking();          // video looped
  buf.push(s);
  while (buf.length && s.t - buf[0].t > 3.0) buf.shift();

  if (!rep){
    if (s.lean <= 7) return;
    const minLean = Math.min(...buf.map(b => b.lean));
    let k = 0; buf.forEach((b, i) => { if (b.lean <= minLean + 1) k = i; });
    rep = { start: buf[k].t, side: workSide, max: s.lean, phase: "out", errors: new Set(), S: buf.slice(k), s0: buf[k].toe, maxD: 0,
            seen: new Set(), needStart: true, farDirty: false, hasFar: false };
    trail = rep.S.filter(b => b.toeVis >= 0.3).map(b => ({ x: b.toe.x, y: b.toe.y, ph: b.ph }));
  } else {
    rep.S.push(s);
    if (s.toeVis >= 0.3) trail.push({ x: s.toe.x, y: s.toe.y, ph: s.ph });
  }
  rep.max = Math.max(rep.max, s.lean);
  const d = dist(s.toe, rep.s0) / legLen;
  if (d >= rep.maxD) rep.farDirty = true;                 // new farthest point: keep this frame
  rep.maxD = Math.max(rep.maxD, d);
  for (const k of LIVE) if (out[k][0] !== "na") rep.seen.add(k);
  const recent = rep.S.filter(b => s.t - b.t <= 0.3);
  const stable = recent.length >= 3 && recent.every(b => dist(b.toe, s.toe) < 0.02 * legLen);
  if (rep.max > 12) for (const k of LIVE) if (M_().rate.includes(k) && out[k][0] === "bad") rep.errors.add(k);

  if (rep.phase === "out"){
    if (rep.max <= 12 && s.lean < 5){ rep = null; trail = []; return; }    // just a wobble
    if (rep.max > 12 && d < rep.maxD * 0.6) rep.phase = "back";
  } else if (d > rep.maxD * 0.75) finishRep(work, sup, legLen, footRef, false);        // went out again
  else if (d < rep.maxD * 0.1 || (stable && d < rep.maxD * F.stableFrac)) finishRep(work, sup, legLen, footRef, true);
}

function detectDirection(D){
  if (cfg.dir !== "auto") return { dir: cfg.dir, note: null };
  const len = Math.hypot(D.x, D.y) || 1;
  if (view === "front"){
    if (Math.abs(D.x) >= 0.6 * len) return { dir: "seconde", note: null };
    if (TF[mod].lift) return { dir: null, note: ["frontAmbig"] };          // a raised leg toward the camera: front or back?
    return { dir: D.y > 0 ? "devant" : "derriere", note: ["frontAmbig"] };
  }
  if (!facing) return { dir: null, note: ["noFacing"] };
  return { dir: D.x * facing > 0 ? "devant" : "derriere", note: null };
}

const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

function judgeRep(S, closedNormally, work, sup, legLen, footRef){
  const F = TF[mod], R = {};
  const V = S.filter(s => s.ph !== null && s.toeVis >= 0.3);
  if (V.length < 8){ REP.forEach(k => R[k] = ["na", "footUnclear"]); return { R, dir: null, note: ["repUnclear"], V: null, mi: 0 }; }
  const s0 = V[0].toe;
  let mi = 0;
  V.forEach((s, i) => { s.d = dist(s.toe, s0); if (s.d > V[mi].d) mi = i; });
  const maxD = V[mi].d || 1;
  V.forEach(s => { s.e = s.d / maxD; s.dl = s.d / legLen; });
  const O = V.slice(0, mi + 1), B = V.slice(mi);
  let { dir, note } = detectDirection({ x: V[mi].toe.x - s0.x, y: V[mi].toe.y - s0.y });

  if (F.lift) judgeLift(R, V, O, B, mi, dir);
  else judgeFloor(R, V, O, B, mi, legLen);

  // heel must land before the foot closes; measured against how far out the toe was on the floor
  // (for dégagé that's where it touched down, not the top of the lift)
  const bFi = B.findIndex(s => s.ph === 0);
  if (REP.includes("heelDown")){
    const land = F.lift ? B.find(s => s.ph >= 0 && s.ph <= 2) : null;
    const eh = bFi < 0 ? 0 : land ? B[bFi].d / (land.d || 1) : B[bFi].e;
    if (bFi < 0) R.heelDown = ["bad", "noHeelDown"];
    else if (eh < cfg.heelDownMin) R.heelDown = ["bad", "heelLate", pct(eh)];
    else R.heelDown = ["ok", "heelOk", pct(eh)];
  }

  // closing gap between the two feet
  if (!closedNormally) R.close = ["bad", "notClosed"];
  else if (Math.min(work.heel.v, work.toe.v, sup.heel.v, sup.toe.v) < 0.2) R.close = ["na", "footUnclear"];
  else {
    const gap = Math.min(
      segDist(work.heel, sup.heel, sup.toe), segDist(work.toe, sup.heel, sup.toe), segDist(work.ankle, sup.heel, sup.toe),
      segDist(sup.heel, work.heel, work.toe), segDist(sup.toe, work.heel, work.toe)) / footRef;
    R.close = gap < 0.1 ? ["ok", "snug"] : [gap <= cfg.closeMax ? "ok" : "bad", "gap", gap.toFixed(1)];
  }

  // standing knee pushed back (median over the rep, so a single noisy frame doesn't count)
  const med = median(V.filter(s => s.hyper != null).map(s => s.hyper));
  R.hyperext = med == null ? ["na", "needSide"] : med > cfg.hyperMax ? ["bad", "hyperBad", Math.round(med)] : ["ok", "hyperOk"];

  // filming advice for this direction
  if (!note && dir === "seconde" && view === "side") note = ["secondeSide"];
  if (!note && dir && dir !== "seconde" && view === "front") note = ["sideFor", M_().dirLabel(dir)];
  return { R, dir, note, V, mi };
}

// tendu: the toe never leaves the floor; flat → demi-pointe → point and back
function judgeFloor(R, V, O, B, mi, legLen){
  // share of frames in phase p, ignoring toe-off frames (those are reported by the floor check)
  const frac = (arr, p) => { const a = arr.filter(s => s.ph !== -1); return a.length ? a.filter(s => s.ph === p).length / a.length : 0; };
  const idx = (arr, p) => arr.findIndex(s => s.ph === p);
  const s0 = V[0].toe;

  // toe stays on the floor
  const offO = O.some(s => s.ph === -1), offB = B.some(s => s.ph === -1);
  R.floor = offO || offB ? ["bad", offO && offB ? "offBoth" : offO ? "offOut" : "offBack"] : ["ok", "allOn"];

  // path: deviation from straight lines start -> farthest -> end
  const e = V[V.length - 1].toe, fp = V[mi].toe;
  let dev = 0;
  V.forEach((s, i) => { dev = Math.max(dev, i <= mi ? segDist(s.toe, s0, fp) : segDist(s.toe, fp, e)); });
  dev /= legLen;
  R.path = [dev <= cfg.pathMax ? "ok" : "bad", "dev", pct(dev)];

  // out: flat -> demi -> point
  const oD = frac(O, 1), oDi = idx(O, 1), oPi = idx(O, 2);
  if (oD === 0) R.outDemi = ["bad", "noDemi"];
  else if (oPi >= 0 && oPi < oDi) R.outDemi = ["bad", "reversed"];
  else if (oD < cfg.demiMin) R.outDemi = ["bad", "shortDemi", pct(oD)];
  else R.outDemi = ["ok", "demiShare", pct(oD)];

  // when the heel leaves the floor on the way out
  const firstLift = O.find(s => s.ph >= 1 || s.ph === -1);
  if (!firstLift) R.lift = ["bad", "neverLift"];
  else if (firstLift.e < cfg.liftMin) R.lift = ["bad", "liftEarly", pct(firstLift.e)];
  else if (firstLift.e > cfg.liftMax) R.lift = ["bad", "liftLate", pct(firstLift.e)];
  else R.lift = ["ok", "liftOk", pct(firstLift.e)];

  // fully pointed at the far end: heel high enough AND the instep stretched (median knee–ankle–toe angle)
  const far = V.filter(s => s.e >= 0.9);
  const ankMed = median(far.map(s => s.ankA).filter(a => a != null));
  if (frac(far, 2) < 0.5) R.point = ["bad", frac(far, 1) >= frac(far, 0) ? "onlyDemi" : "heelNotUp"];
  else if (ankMed != null && ankMed < cfg.pointAngle) R.point = ["bad", "instepBent", Math.round(ankMed)];
  else R.point = ["ok", ankMed != null ? "pointedDeg" : "pointed", ankMed != null ? Math.round(ankMed) : undefined];

  // back: point -> demi -> flat
  const bD = frac(B, 1), bDi = idx(B, 1), bFi = idx(B, 0);
  if (bD === 0) R.backDemi = ["bad", "noDemi"];
  else if (bFi >= 0 && bFi < bDi) R.backDemi = ["bad", "badOrder"];
  else if (bD < cfg.demiMin) R.backDemi = ["bad", "shortDemi", pct(bD)];
  else R.backDemi = ["ok", "demiShare", pct(bD)];
}

// dégagé / grand battement: brush out through tendu, lift, come down through tendu, close
function judgeLift(R, V, O, B, mi, dir){
  const air = s => s.ph === 3, floor = s => s.ph >= 0 && s.ph <= 2;
  const fa = O.findIndex(air);                                       // the moment the toe leaves the floor
  const maxLean = Math.max(...V.map(s => s.lean));

  // brushed along the floor far enough before lifting
  if (fa < 0) R.brush = ["na", "noLiftYet"];
  else if (O[fa].dl < cfg.brushMin) R.brush = ["bad", "liftSoon", pct(O[fa].dl)];
  else R.brush = ["ok", "brushOk", pct(O[fa].dl)];

  // height of the leg (hip–ankle angle from vertical)
  const deg = Math.round(maxLean);
  if (mod === "degage") R.height = maxLean < cfg.degMin ? ["bad", "tooLow", deg] : maxLean > cfg.degMax ? ["bad", "tooHigh", deg] : ["ok", "heightDeg", deg];
  else R.height = maxLean < cfg.gbMin ? ["bad", "tooLow", deg] : ["ok", "heightDeg", deg];

  // foot pointed while in the air (instep angle near the top)
  const ankMed = median(V.filter(s => air(s) && s.e >= 0.85 && s.ankA != null).map(s => s.ankA));
  if (fa < 0) R.pointAir = ["na", "noLiftYet"];
  else if (ankMed == null) R.pointAir = ["na", "footUnclear"];
  else R.pointAir = ankMed >= cfg.pointAngle ? ["ok", "pointedDeg", Math.round(ankMed)] : ["bad", "instepBent", Math.round(ankMed)];

  // came down through tendu: the toe touches the floor while the leg is still stretched out
  const fl = B.findIndex(floor);
  if (fa < 0) R.land = ["na", "noLiftYet"];
  else if (fl < 0) R.land = ["bad", "noLand"];
  else if (B[fl].dl < cfg.brushMin * 0.8) R.land = ["bad", "landLate", pct(B[fl].dl)];
  else R.land = ["ok", "landOk", pct(B[fl].dl)];

  if (mod !== "battement") return;
  // torso stays still (derrière allows a little forward tip at height)
  const tv = V.filter(s => s.torso != null && s.e >= 0.3).map(s => s.torso);
  const tMax = cfg.torsoMax + (dir === "derriere" ? 12 : 0);
  R.torsoRep = !tv.length ? ["na", "unclear"] : Math.max(...tv) <= tMax ? ["ok", "deg", Math.round(Math.max(...tv)) + "°"] : ["bad", "torsoMoved", Math.round(Math.max(...tv))];
  // lowered with control: coming down takes at least as long as going up (× lowerRatio);
  // a pause at the top counts for neither
  if (fa < 0 || fl < 0) R.controlDown = ["na", "noLiftYet"];
  else {
    const top = V.filter(s => s.lean >= maxLean - 5);
    const up = top[0].t - O[fa].t, down = B[fl].t - top[top.length - 1].t, sp = `${up.toFixed(1)}s / ${down.toFixed(1)}s`;
    R.controlDown = down >= up * cfg.lowerRatio ? ["ok", "lowerOk", sp] : ["bad", "dropped", sp];
  }
}

function finishRep(work, sup, legLen, footRef, closedNormally){
  const r = rep; rep = null; trailEnd = performance.now();
  if (video.currentTime - r.start < 0.35) return;
  commitRep(r, judgeRep(r.S, closedNormally, work, sup, legLen, footRef));
}

// ---------- learn: drawings ----------
// Poses are computed, not hand-drawn per frame: the toe slides along the floor while the foot goes
// flat → demi-pointe → pointed, using the same phases the camera analysis checks for. For dégagé and
// grand battement the whole stretched leg then rotates up around the hip.
// devant / derrière are drawn from the side (front of the dancer = right), à la seconde from the front.
const VIEWS = {
  devant:   { side: true,  d: 1,  work: [121, 146], stand: [118, 146], t0: 134, L: 70 },
  seconde:  { side: false, d: 1,  work: [126, 146], stand: [113, 146], t0: 142, L: 66 },
  derriere: { side: true,  d: -1, work: [119, 146], stand: [122, 146], t0: 106, L: 70 },
};
function footAt(v, e, err){
  const d = v.d, hip = { x: v.work[0], y: v.work[1] };
  const T = { x: v.t0 + d * e * v.L, y: err === "toeLift" ? FL - 15 : FL };
  const stage = err === "flatPoint" && e > 0.6 ? 0.55 : e;           // a lazy foot stays in demi-pointe
  let H, B = null;
  if (stage < 0.3) H = { x: T.x - d * FOOT, y: T.y };
  else if (stage < 0.65){
    const a = rad((stage - 0.3) / 0.35 * 35);
    B = { x: T.x - d * 7, y: T.y };
    H = { x: B.x - d * (FOOT - 7) * Math.cos(a), y: T.y - (FOOT - 7) * Math.sin(a) };
  } else {
    const k = (stage - 0.65) / 0.35;
    const legA = Math.atan2(T.y - hip.y, Math.abs(T.x - hip.x));          // leg line at this toe position
    const a = rad(30) + k * (legA - rad(30));
    H = { x: T.x - d * FOOT * Math.cos(a), y: T.y - FOOT * Math.sin(a) };
    return { T, H, B, A: { x: H.x + (1 - k) * d * 4, y: H.y - (1 - k) * 9 }, ph: err === "toeLift" ? -1 : 2 };
  }
  const A = { x: H.x + d * 4, y: H.y - 9 };
  const ph = err === "toeLift" ? -1 : stage < 0.3 ? 0 : stage < 0.65 ? 1 : 2;
  return { T, H, B, A, ph };
}
// angle of the hip → toe line from vertical in the fully pointed tendu (about 42° in these drawings)
const tenduAngle = v => Math.atan2(Math.abs(v.t0 + v.d * v.L - v.work[0]), FL - v.work[1]) * 180 / Math.PI;

// o: { err, arrow: "out"|"back"|"up"|"down", mark: "bad"|"good", focus: "knee"|"foot"|"heel"|"hip"|"torso", label, tight, wide, alt }
// lift: 0 = foot on the floor (tendu pose at e); > 0 = degrees the hip → toe line is raised above the tendu angle
function poseSVG(dir, e, o = {}, lift = 0){
  const v = VIEWS[dir], d = v.d, err = o.err;
  let f = footAt(v, lift > 0 ? 1 : e, lift > 0 ? null : err);
  const P = { x: v.work[0], y: v.work[1] - (err === "hipHike" ? 8 : 0) };
  if (lift > 0){
    // rotate the stretched leg up around the hip (screen angle −d·lift)
    const th = rad(-d * lift), rot = p => ({ x: P.x + (p.x - P.x) * Math.cos(th) - (p.y - P.y) * Math.sin(th), y: P.y + (p.x - P.x) * Math.sin(th) + (p.y - P.y) * Math.cos(th) });
    const A = rot(f.A);
    const u = { x: (A.x - P.x) / (dist(A, P) || 1), y: (A.y - P.y) / (dist(A, P) || 1) };
    let T;
    if (err === "flatPoint"){                                          // flexed foot: bent up at the ankle
      const fx = Math.cos(rad(-d * 70)) * u.x - Math.sin(rad(-d * 70)) * u.y, fy = Math.sin(rad(-d * 70)) * u.x + Math.cos(rad(-d * 70)) * u.y;
      T = { x: A.x + fx * (FOOT - 4), y: A.y + fy * (FOOT - 4) };
    } else T = { x: A.x + u.x * (FOOT - 2), y: A.y + u.y * (FOOT - 2) };
    f = { A, T, H: { x: A.x - u.x * 3, y: A.y - u.y * 3 }, B: null, ph: 3 };
  }
  let K = { x: (P.x + f.A.x) / 2, y: (P.y + f.A.y) / 2 };
  if (err === "bentKnee"){
    const dx = f.A.x - P.x, dy = f.A.y - P.y, n = Math.hypot(dx, dy) || 1;
    let px = dy / n, py = -dx / n;
    if (lift > 0){ if (px * d < 0){ px = -px; py = -py; } }           // a raised leg bends with the knee forward/up
    else if (py > 0){ px = -px; py = -py; }
    K = { x: K.x + px * 19 + (lift > 0 ? 0 : d * 5), y: K.y + py * 19 };
  }
  const SA = { x: v.stand[0] - 1, y: 227 };
  const vb = o.wide ? (o.tight ? [-8, 22, 256, 240] : [-14, 0, 268, 262]) : o.tight ? [22, 30, 202, 232] : [0, 0, 240, 262];
  const s = [`<svg viewBox="${vb.join(" ")}" role="img" aria-label="${esc(o.alt || "tendu")}">`];
  s.push(floorSVG());
  s.push(`<line x1="${v.t0}" y1="${FL + 1}" x2="${v.t0 + d * v.L}" y2="${FL + 1}" stroke="#f6bfd5" stroke-width="2" stroke-dasharray="3 5"/>`);
  // standing leg and its turned-out foot
  s.push(legPath({ x: v.stand[0], y: v.stand[1] }, { x: (v.stand[0] + SA.x) / 2, y: (v.stand[1] + SA.y) / 2 }, SA));
  s.push(v.side ? `<ellipse cx="${SA.x}" cy="${FL - 3}" rx="8" ry="5.5" fill="#f47aa8"/>`
                : `<path d="M${SA.x + 2} ${FL - 2} L${SA.x - 22} ${FL - 1}" stroke="#f47aa8" stroke-width="9" stroke-linecap="round"/>`);
  // working leg and foot
  s.push(legPath(P, K, f.A));
  const fp = f.B ? `M${r1(f.H.x)} ${r1(f.H.y)} L${r1(f.B.x)} ${r1(f.B.y)} L${r1(f.T.x)} ${r1(f.T.y)}`
                 : lift > 0 ? `M${r1(f.A.x)} ${r1(f.A.y)} L${r1(f.T.x)} ${r1(f.T.y)}` : `M${r1(f.H.x)} ${r1(f.H.y)} L${r1(f.T.x)} ${r1(f.T.y)}`;
  s.push(`<path d="${fp}" stroke="#f47aa8" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`);
  // upper body (tutu covers the hips)
  const tr = err === "hipHike" ? ' transform="rotate(-6 120 150)"' : err === "torsoLean" ? ` transform="rotate(${-d * 9} 120 150)"` : "";
  s.push(`<g${tr}><use href="#dancerTop" x="0" y="0" width="240" height="262"/></g>`);
  if (o.arrow === "out" || o.arrow === "back"){
    const out = o.arrow === "out", x1 = out ? v.t0 : v.t0 + d * v.L, x2 = out ? v.t0 + d * v.L : v.t0;
    s.push(arrowSVG(x1, x2, 254, "#cf3577"));
  } else if (o.arrow){
    const x = d > 0 ? vb[0] + vb[2] - 14 : vb[0] + 14, up = o.arrow === "up";
    s.push(vArrowSVG(x, up ? 200 : 120, up ? 120 : 200));
  }
  if (o.label && v.side) s.push(`<text x="${vb[0] + vb[2] - 8}" y="22" text-anchor="end" font-size="13" font-weight="700" fill="#b9a3ae">${esc(t("lFront"))}</text>`);
  if (o.mark){
    const c = o.focus === "knee" ? K : o.focus === "hip" ? P : o.focus === "heel" ? f.H : o.focus === "torso" ? { x: 120, y: 105 } : f.T;
    s.push(markSVG(o.mark, c, vb, o.focus === "torso" ? 30 : 17));
  }
  s.push(`</svg>`);
  return { svg: s.join(""), ph: f.ph };
}

// ---------- the three moves ----------
const tenduDirs = ["devant", "seconde", "derriere"];
const tenduFraming = () => {
  if ((cfg.dir === "devant" || cfg.dir === "derriere") && view === "front") return "fgTenduSide";
  if (cfg.dir === "seconde" && view === "side") return "fgTenduFront";
  return null;
};
const familyBase = (id, title) => ({
  id, dirs: tenduDirs, oneLeg: true, quiet: ["toe"], framing: tenduFraming, analyze: analyzeTendu,
  dirLabel: d => DIRS[d] ? `${title} ${DIRS[d]}` : d, dirShort: d => DIRS[d] || d,
  axes: ["axStart", "axFar", "axClose"], snaps: [["start", "snapStart"], ["far", "snapFar"], ["close", "snapClose"]],
});

// tendu: one cycle of the animation (seconds) and the 5 step pictures
const CYCLE = 6.4;
function animAt(sec){
  const tt = sec % CYCLE;
  return span(tt, 0, 0.7, 0, 0, "closed") || span(tt, 0.7, 2.7, 0, 1, "out") || span(tt, 2.7, 3.7, 1, 1, "hold")
      || span(tt, 3.7, 5.7, 1, 0, "back") || [0, "closed"];
}
const STEP_E = [0, 0.18, 0.5, 1, 0.18], STEP_ARROW = [null, "out", null, null, "back"];
const MISTAKES = { devant: ["bentKnee", "toeLift", "flatPoint"], seconde: ["bentKnee", "hipHike", "toeLift", "flatPoint"], derriere: ["bentKnee", "toeLift", "flatPoint"] };
const FOCUS = { bentKnee: "knee", toeLift: "foot", flatPoint: "heel", hipHike: "hip", tooHigh: "foot", torsoLean: "torso" };
const tenduFrame = (dir, e, st) => { const { svg, ph } = poseSVG(dir, e, { label: true, alt: t("lTitle") }); return { svg, ph: st === "closed" ? null : ph, caption: caption("l_" + st, st === "closed" ? null : ph) }; };

registerMove({
  ...familyBase("tendu", "Tendu"),
  live: ["workKnee", "supportKnee", "hips", "toe"],
  rep:  ["floor", "path", "outDemi", "lift", "point", "backDemi", "heelDown", "close", "hyperext"],
  rate: ["workKnee", "supportKnee", "hips", "floor", "path", "outDemi", "lift", "point", "backDemi", "heelDown", "close", "hyperext"],
  legend: [["--ph-flat", "lgFlat"], ["--ph-demi", "lgDemi"], ["--ph-point", "lgPoint"], ["--ph-off", "lgOff"], ["--ok", "lgOk"], ["--bad", "lgBad"]],
  tips: ["tip1", "tip2", "tip3", "tip4", "tip5"], repEmpty: "repEmpty", reportTitle: "rpTitle",
  thumb: () => poseSVG("seconde", 1, { tight: true }).svg,
  learn: {
    title: "lTitle", intro: "lIntro", tabs: tenduDirs, tabLabel: d => t("dir_" + d), badge: d => VIEWS[d].side ? "viewSide" : "viewFront",
    track: [0, 1, 2],
    frame: (dir, sec) => tenduFrame(dir, ...animAt(sec)),
    paused: dir => tenduFrame(dir, 1, "hold"),
    tips: dir => ["tip_knees", "tip_floor", "tip_" + dir],
    steps: dir => STEP_E.map((e, i) => ({ svg: poseSVG(dir, e, { tight: true, arrow: STEP_ARROW[i], alt: t(`s_${dir}_${i + 1}`) }).svg, text: t(`s_${dir}_${i + 1}`) })),
    mistakes: dir => MISTAKES[dir].map(err => {
      const e = err === "toeLift" ? 0.6 : 1;
      return { bad: poseSVG(dir, e, { tight: true, err, mark: "bad", focus: FOCUS[err], alt: t(`m_${err}_bad`) }).svg, badText: t(`m_${err}_bad`),
               good: poseSVG(dir, e, { tight: true, mark: "good", focus: FOCUS[err], alt: t(`m_${err}_good`) }).svg, goodText: t(`m_${err}_good`) };
    }),
  },
});

// dégagé and grand battement: brush out (floor), lift, come down to tendu, brush back in
// heights are the extra lift above the tendu angle in the drawings
const LIFT_H = { degage: { devant: 18, seconde: 18, derriere: 14 }, battement: { devant: 62, seconde: 58, derriere: 34 } };
function liftAnimAt(id, dir, sec){
  const H = LIFT_H[id][dir], gb = id === "battement", C = gb ? 6.2 : 5.6, tt = sec % C;
  // returns [e (floor), lift (deg), stage]
  const a = (x0, x1, f, to, st) => { const r = span(tt, x0, x1, f, to, st); return r; };
  let r;
  if ((r = a(0, 0.5, 0, 0, "closed"))) return [0, 0, "closed"];
  if ((r = a(0.5, 1.6, 0, 1, "out"))) return [r[0], 0, "out"];
  if ((r = a(1.6, gb ? 2.1 : 2.1, 0, H, "up"))) return [1, r[0], "up"];
  if ((r = a(gb ? 2.1 : 2.1, gb ? 2.4 : 2.6, H, H, "top"))) return [1, H, "top"];
  if ((r = a(gb ? 2.4 : 2.6, gb ? 3.6 : 3.2, H, 0, "down"))) return [1, r[0], "down"];
  if ((r = a(gb ? 3.6 : 3.2, gb ? 4.7 : 4.3, 1, 0, "back"))) return [r[0], 0, "back"];
  return [0, 0, "closed"];
}
function liftFrame(id, dir, e, lift, st){
  const { svg, ph } = poseSVG(dir, e, { label: true, wide: true, alt: t("mod_" + id) }, lift);
  const p = st === "closed" ? null : ph;
  return { svg, ph: p, caption: caption("l_" + st, p) };
}
const LIFT_MISTAKES = {
  degage:    { devant: ["bentKnee", "flatPoint", "tooHigh"], seconde: ["bentKnee", "hipHike", "flatPoint", "tooHigh"], derriere: ["bentKnee", "flatPoint", "tooHigh"] },
  battement: { devant: ["bentKnee", "torsoLean", "flatPoint"], seconde: ["bentKnee", "hipHike", "torsoLean", "flatPoint"], derriere: ["bentKnee", "torsoLean", "flatPoint"] },
};
function liftLearn(id){
  const wide = true;                                               // a raised foot needs room on the side
  const P = (dir, e, lift, o = {}) => poseSVG(dir, e, { tight: true, wide, ...o }, lift).svg;
  return {
    title: "lTitle_" + id, intro: "lIntro_" + id, tabs: tenduDirs, tabLabel: d => t("dir_" + d), badge: d => VIEWS[d].side ? "viewSide" : "viewFront",
    track: [0, 1, 2, 3],
    frame: (dir, sec) => liftFrame(id, dir, ...liftAnimAt(id, dir, sec)),
    paused: dir => liftFrame(id, dir, 1, LIFT_H[id][dir], "top"),
    tips: dir => ["tip_" + id + "_1", "tip_" + id + "_2", id === "degage" ? "tip_" + dir : "tip_battement_3"],
    steps: dir => {
      const H = LIFT_H[id][dir];
      const pics = [P(dir, 0, 0), P(dir, 0.6, 0, { arrow: "out" }), P(dir, 1, H, { arrow: "up" }), P(dir, 1, H * 0.45, { arrow: "down" }), P(dir, 0.18, 0, { arrow: "back" })];
      return pics.map((svg, i) => ({ svg, text: t(`s_${id}_${i + 1}`) }));
    },
    mistakes: dir => LIFT_MISTAKES[id][dir].map(err => {
      const H = LIFT_H[id][dir], hb = err === "tooHigh" ? H + 40 : H;
      return { bad: P(dir, 1, hb, { err, mark: "bad", focus: FOCUS[err], alt: t(`m_${err}_bad`) }), badText: t(`m_${err}_bad`),
               good: P(dir, 1, H, { mark: "good", focus: FOCUS[err], alt: t(`m_${err}_good`) }), goodText: t(err === "tooHigh" && id === "degage" ? "m_tooHigh_good" : `m_${err}_good`) };
    }),
  };
}

registerMove({
  ...familyBase("degage", "Dégagé"),
  live: ["workKnee", "supportKnee", "hips"],
  rep:  ["brush", "height", "pointAir", "land", "heelDown", "close", "hyperext"],
  rate: ["workKnee", "supportKnee", "hips", "brush", "height", "pointAir", "land", "heelDown", "close", "hyperext"],
  legend: [["--ph-flat", "lgFlat"], ["--ph-demi", "lgDemi"], ["--ph-point", "lgPoint"], ["--ph-up", "lgAir"], ["--ok", "lgOk"], ["--bad", "lgBad"]],
  tips: ["tip1", "tip2", "tip3", "tipLift1", "tipLift2"], repEmpty: "repEmpty_degage", reportTitle: "rpTitle_degage",
  thumb: () => poseSVG("seconde", 1, { tight: true, wide: true }, 18).svg,
  learn: liftLearn("degage"),
});
registerMove({
  ...familyBase("battement", "Grand battement"),
  live: ["workKnee", "supportKnee", "hips", "torso"],
  rep:  ["brush", "height", "pointAir", "torsoRep", "controlDown", "land", "close", "hyperext"],
  rate: ["workKnee", "supportKnee", "hips", "brush", "height", "pointAir", "torsoRep", "controlDown", "land", "close", "hyperext"],
  legend: [["--ph-flat", "lgFlat"], ["--ph-demi", "lgDemi"], ["--ph-point", "lgPoint"], ["--ph-up", "lgAir"], ["--ok", "lgOk"], ["--bad", "lgBad"]],
  tips: ["tip1", "tip2", "tip3", "tipLift1", "tipLift2"], repEmpty: "repEmpty_battement", reportTitle: "rpTitle_battement",
  thumb: () => poseSVG("devant", 1, { tight: true, wide: true }, 58).svg,
  learn: liftLearn("battement"),
});
