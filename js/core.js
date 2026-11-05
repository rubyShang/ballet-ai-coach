"use strict";
const VISION = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODELS = {
  lite: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  full: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
};
// MediaPipe landmark indices (the dancer's own left/right)
const LEGS = {
  left:  { hip:23, knee:25, ankle:27, heel:29, toe:31 },
  right: { hip:24, knee:26, ankle:28, heel:30, toe:32 },
};
// French direction names, shared by tendu, dégagé and grand battement
const DIRS = { devant:"devant", seconde:"à la seconde", derriere:"derrière" };
// foot phases for the tendu family (-1..3), body phases for plié (10..13) and relevé (20..23) share one colour map
const PHASES = { "-1":["ph_off","--ph-off"], "0":["ph_flat","--ph-flat"], "1":["ph_demi","--ph-demi"], "2":["ph_point","--ph-point"], "3":["ph_air","--ph-up"],
                 "10":["pp_stand","--ph-flat"], "11":["pp_down","--ph-demi"], "12":["pp_bottom","--ph-point"], "13":["pp_up","--ph-up"],
                 "20":["rp_flat","--ph-flat"], "21":["rp_up","--ph-demi"], "22":["rp_top","--ph-point"], "23":["rp_down","--ph-up"] };
// ---------- moves ----------
// Every move lives in its own file under js/moves/ and registers itself here. A move describes:
//   id, name (i18n key mod_<id>), live / rep / rate check keys, dirs, dirLabel(d), dirShort(d),
//   analyze(lm, wlm) per video frame, framing() → filming-hint key or null, axes / snaps captions,
//   legend, tips, repEmpty, reportTitle, oneLeg, quiet (live checks not spoken), settings, thumb() and learn {…}.
const MOVES = {}, MOVE_ORDER = [];
function registerMove(m){ MOVES[m.id] = m; if (!MOVE_ORDER.includes(m.id)) MOVE_ORDER.push(m.id); }
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
function uuid(){
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); });
}
let mod = "tendu", LIVE = [], REP = [];            // the current move; set by setModule() once every move file has loaded
const M_ = () => MOVES[mod];
const rateKeys = m => (MOVES[m || mod] || MOVES.tendu).rate;
const dirLabel = (d, m = mod) => !d ? t("dirUnknown") : MOVES[m] ? MOVES[m].dirLabel(d) : d;

const $ = id => document.getElementById(id);
const video = $("video"), canvas = $("overlay"), ctx = canvas.getContext("2d"), stage = $("stage");
let landmarker = null, loadedModel = null, running = false, mode = null, stream = null, rafId = 0, lastVideoTime = -1;
let statusKey = null, statusArg = null;
const setStatus = (k, a) => { statusKey = k; statusArg = a; $("status").textContent = k ? t(k, a) : ""; };

// ---------- settings ----------
const cfg = {};
const SL = {
  demiH:[v=>v, v=>v.toFixed(2)], pointH:[v=>v, v=>v.toFixed(2)],
  liftMin:[v=>v/100, v=>v+"%"], liftMax:[v=>v/100, v=>v+"%"], heelDownMin:[v=>v/100, v=>v+"%"], demiMin:[v=>v/100, v=>v+"%"],
  kneeMin:[v=>v, v=>v+"°"], hipMax:[v=>v, v=>v+"°"], toeMax:[v=>v/100, v=>v+"%"], pathMax:[v=>v/100, v=>v+"%"],
  closeMax:[v=>v, v=>v.toFixed(1)],
  pointAngle:[v=>v, v=>v+"°"], hyperMax:[v=>v, v=>v+"°"], pDemiMin:[v=>v, v=>v+"°"], grandMin:[v=>v, v=>v+"°"], kneeTrackMin:[v=>v/100, v=>v+"%"], tiltMax:[v=>v, v=>v+"°"], evenMax:[v=>v, v=>v+"°"],
  degMin:[v=>v, v=>v+"°"], degMax:[v=>v, v=>v+"°"], gbMin:[v=>v, v=>v+"°"], brushMin:[v=>v/100, v=>v+"%"], torsoMax:[v=>v, v=>v+"°"],
  lowerRatio:[v=>v/100, v=>v+"%"], relMin:[v=>v, v=>v.toFixed(2)], relEven:[v=>v, v=>v.toFixed(2)], swayMax:[v=>v/100, v=>v+"%"], relLower:[v=>v/100, v=>v+"%"],
};
function readCfg(){
  for (const [id, [conv, show]] of Object.entries(SL)){ const v = +$(id).value; cfg[id] = conv(v); $(id + "Out").textContent = show(v); }
  cfg.leg = $("leg").value; cfg.dir = $("dir").value; cfg.voice = $("voice").checked; cfg.pPos = $("pPos").value; cfg.sound = $("sound").checked; cfg.angle3d = $("angle3d").checked; cfg.blurFace = $("blurFace").checked;
}
[...Object.keys(SL), "leg", "dir", "voice", "pPos", "sound", "angle3d", "blurFace"].forEach(id => $(id).addEventListener("input", readCfg));
readCfg();
$("speed").addEventListener("change", () => { if (mode === "file") video.playbackRate = +$("speed").value; });

// ---------- check list UI ----------
function buildList(ul, keys, withHint){
  const els = {};
  for (const k of keys){
    const li = document.createElement("li"); li.dataset.s = "na";
    li.innerHTML = `<span class="dot"></span><span><span class="name"></span>${withHint ? '<span class="hint"></span>' : ""}</span><span class="val">—</span>`;
    ul.appendChild(li); els[k] = li;
  }
  return els;
}
let liveEls = {}, repEls = {};
function labelLists(){
  for (const k of LIVE){ liveEls[k].querySelector(".name").textContent = t("n_" + k); liveEls[k].querySelector(".hint").textContent = t("h_" + k); }
  for (const k of REP) repEls[k].querySelector(".name").textContent = t("n_" + k);
  const ax = M_().axes;
  $("axS").textContent = t(ax[0]); $("axF").textContent = t(ax[1]); $("axC").textContent = t(ax[2]);
}
// touch the DOM only when a row's state or text actually changes (this runs every video frame)
function setRow(els, key, m){
  const [s, val] = fmt(m), li = els[key];
  if (li._s === s && li._v === val) return;
  li._s = s; li._v = val; li.dataset.s = s; li.querySelector(".val").textContent = val;
}
function setText(el, txt){ if (el._t !== txt){ el._t = txt; el.textContent = txt; } }

// ---------- language switch ----------
function applyLang(){
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  document.querySelectorAll("[data-i]").forEach(el => el.textContent = t(el.dataset.i));
  document.querySelectorAll("[data-ph]").forEach(el => el.placeholder = t(el.dataset.ph));
  document.querySelectorAll(".lang button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));
  labelLists();
  if (statusKey) setStatus(statusKey, statusArg);
  $("legInfo").textContent = lastLeg ? t("legInfo", t(lastLeg), cfg.leg === "auto") : t("legNone");
  renderReps();
  renderRecs(); updateRecUI(); updateFrameInfo();
  if (lastRep) showRep(lastRep);
  if (typeof renderAcct === "function"){ renderAcct(); renderHistList(); renderGate(); }
  if (typeof applyMoveText === "function") applyMoveText();
  if (typeof renderLearn === "function" && document.body.classList.contains("view-learn")) renderLearn();
  if (typeof renderForm === "function" && document.body.classList.contains("view-diary")){ renderForm(); renderDiary(false); if (dMsg) setDMsg(...dMsg); }
  if (document.body.classList.contains("show-report")) renderReport(reportCtx);
  if (lastDir !== undefined) $("dirChip").querySelector("span").textContent = dirLabel(lastDir);
}
document.querySelectorAll(".lang button").forEach(b => b.addEventListener("click", () => {
  lang = b.dataset.lang;
  try { localStorage.setItem("tendu-lang", lang); } catch {}
  applyLang();
}));

// ---------- model ----------
async function ensureModel(){
  const want = $("model").value;
  if (landmarker && loadedModel === want) return;
  setStatus("loading");
  const { PoseLandmarker, FilesetResolver } = await import(VISION);
  const fs = await FilesetResolver.forVisionTasks(WASM);
  const opts = d => ({ baseOptions:{ modelAssetPath: MODELS[want], delegate:d }, runningMode:"VIDEO", numPoses:1,
                      minPoseDetectionConfidence:0.5, minTrackingConfidence:0.5 });
  try { landmarker = await PoseLandmarker.createFromOptions(fs, opts("GPU")); }
  catch { landmarker = await PoseLandmarker.createFromOptions(fs, opts("CPU")); }
  loadedModel = want;
}

// ---------- sources ----------
async function startCamera(){
  stopSource();
  try {
    await ensureModel();
    stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:$("facing").value, width:{ideal:1280}, height:{ideal:720} }, audio:false });
  } catch(e){
    if (e && e.name === "NotAllowedError") setStatus("camDenied"); else setStatus("camFail", e.message || String(e));
    return;
  }
  video.srcObject = stream; video.loop = false;
  stage.classList.toggle("mirror", $("facing").value === "user");
  await video.play();
  mode = "cam"; begin();
}
async function startFile(file){
  stopSource();
  try { await ensureModel(); } catch(e){ setStatus("modelFail", e.message || String(e)); return; }
  video.srcObject = null; video.src = URL.createObjectURL(file); video.loop = false;   // play once so every rep is counted once
  stage.classList.remove("mirror");
  await video.play(); video.playbackRate = +$("speed").value;
  mode = "file"; begin();
}
function begin(){
  $("placeholder").hidden = true; $("chips").hidden = false; $("stopBtn").disabled = false;
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  stage.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
  setStatus(mode === "cam" ? "camOn" : "fileOn");
  srcId++;
  running = true; lastVideoTime = -1; resetTracking(); updateRecUI(); loop();
}
function stopSource(){
  stopRec();
  running = false; cancelAnimationFrame(rafId); updateRecUI();
  if (stream){ stream.getTracks().forEach(tr => tr.stop()); stream = null; }
  video.pause(); $("stopBtn").disabled = true;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  $("frameGuide").hidden = true; frameShown = null;
}
video.addEventListener("ended", () => {
  if (mode !== "file" || !running) return;
  setTimeout(() => {
    stopRec();
    running = false; cancelAnimationFrame(rafId); updateRecUI();
    $("stopBtn").disabled = true;
    setStatus("fileDone", reps.length);
    if (cfg.sound && audioCtx && audioCtx.state === "running") tone(1046.5, audioCtx.currentTime, 0.4);
  }, 300);
});
$("camBtn").addEventListener("click", startCamera);
$("fileInput").addEventListener("change", e => { const f = e.target.files[0]; if (f) startFile(f); e.target.value = ""; });
$("stopBtn").addEventListener("click", () => { stopSource(); setStatus("stopped"); });

function loop(){
  if (!running) return;
  if (video.readyState >= 2 && video.currentTime !== lastVideoTime){
    lastVideoTime = video.currentTime;
    if (canvas.width !== video.videoWidth){ canvas.width = video.videoWidth; canvas.height = video.videoHeight; }
    const res = landmarker.detectForVideo(video, performance.now());
    analyze(res.landmarks && res.landmarks[0], res.worldLandmarks && res.worldLandmarks[0]);
    if (recorder && recAnnotated) drawComposite();
  }
  rafId = requestAnimationFrame(loop);
}

// ---------- geometry ----------
const W = () => canvas.width, H = () => canvas.height;
const pt = (lm, i) => ({ x: lm[i].x * W(), y: lm[i].y * H(), v: lm[i].visibility ?? 1 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function angle(a, b, c){
  const v1x = a.x-b.x, v1y = a.y-b.y, v2x = c.x-b.x, v2y = c.y-b.y;
  const d = (v1x*v2x + v1y*v2y) / (Math.hypot(v1x,v1y) * Math.hypot(v2x,v2y) || 1);
  return Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI;
}
function segDist(p, a, b){
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx*dx + dy*dy;
  const u = len2 ? Math.max(0, Math.min(1, ((p.x-a.x)*dx + (p.y-a.y)*dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + u*dx), p.y - (a.y + u*dy));
}
// how far the leg (hip -> ankle) leans away from vertical, in degrees
const legLean = (hip, ankle) => Math.abs(Math.atan2(ankle.x - hip.x, ankle.y - hip.y)) * 180 / Math.PI;
const ema = {};
const smooth = (k, v, a = 0.45) => (ema[k] = ema[k] == null ? v : ema[k] * (1 - a) + v * a);
const pct = e => Math.round(e * 100) + "%";
// Joint angle at b (a–b–c). With "3D angles" on, MediaPipe's world landmarks (metres) are used, so the angle
// doesn't change when the camera sees the leg at a slant; otherwise the on-screen 2D points are used.
function jointAngle(lm, wlm, a, b, c){
  if (cfg.angle3d && wlm){
    const A = wlm[a], B = wlm[b], C = wlm[c];
    const v1 = [A.x - B.x, A.y - B.y, A.z - B.z], v2 = [C.x - B.x, C.y - B.y, C.z - B.z];
    const d = (v1[0]*v2[0] + v1[1]*v2[1] + v1[2]*v2[2]) / (Math.hypot(...v1) * Math.hypot(...v2) || 1);
    return Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI;
  }
  return angle(pt(lm, a), pt(lm, b), pt(lm, c));
}

// ---------- per-frame analysis ----------
let workSide = "right", view = "front", facing = 0, lastLeg = null, lastRep = null, lastDir;
const VIS = 0.5;
let lastLm = null;                                         // landmarks of the frame being analyzed (for blurring the face in snapshots)
function analyze(lm, wlm){ lastLm = lm || null; checkFraming(lm); return M_().analyze(lm, wlm); }

// ---------- framing assistant (camera only) ----------
// Checks every frame where the dancer is in the picture; a hint shows only after the same problem has
// lasted ~0.8 s and clears after ~0.5 s of good framing, so it doesn't flicker.
let frameIssue = null, frameSince = 0, frameShown = null, frameOkSince = 0;
function framingProblem(lm){
  if (!lm) return "fgNobody";
  const vis = i => (lm[i].visibility ?? 1) >= 0.35;
  const inFrame = i => vis(i) && lm[i].y <= 0.985 && lm[i].y >= 0.01 && lm[i].x >= 0.01 && lm[i].x <= 0.99;
  const feet = [27, 28, 29, 30, 31, 32];
  if (feet.filter(inFrame).length < 4) return "fgFeet";
  if (!inFrame(0)) return "fgHead";
  const top = lm[0].y, bottom = Math.max(...feet.map(i => lm[i].y));
  if (bottom - top < 0.4) return "fgSmall";
  const cx = (lm[23].x + lm[24].x) / 2;
  if (cx < 0.15 || cx > 0.85) return "fgCenter";
  return M_().framing ? M_().framing() : null;
}
function checkFraming(lm){
  const box = $("frameGuide");
  if (mode !== "cam"){ if (!box.hidden) box.hidden = true; frameShown = null; return; }
  const now = performance.now(), issue = framingProblem(lm);
  if (issue !== frameIssue){ frameIssue = issue; frameSince = now; }
  if (issue && now - frameSince > 800 && frameShown !== issue){
    frameShown = issue; box.innerHTML = `${esc(t(issue))}<small>${esc(t(issue + "Hint"))}</small>`; box.hidden = false;
  } else if (!issue && frameShown && now - frameSince > 500){ frameShown = null; box.hidden = true; }
}

function setPhaseChip(ph, extra){
  const chip = $("phaseChip");
  if (ph === null){ if (chip._ph !== null){ chip._ph = null; chip.style.setProperty("--c", "#888"); } setText(chip.querySelector("span"), t("chipUnknown")); setText(chip.querySelector("small"), ""); return; }
  const [key, tok] = PHASES[ph];
  if (chip._ph !== ph){ chip._ph = ph; chip.style.setProperty("--c", `var(${tok})`); }
  phaseColor = css(tok);
  setText(chip.querySelector("span"), t(key));
  setText(chip.querySelector("small"), extra || "");
}

// ---------- drawing ----------
// colour tokens never change at runtime (single light theme), so read each one once
const cssCache = {};
const css = n => cssCache[n] ?? (cssCache[n] = getComputedStyle(document.documentElement).getPropertyValue(n).trim());

// ---------- rep tracking state (shared; each move's tracker fills it) ----------
// buf keeps the last 3 s of per-frame samples so a rep can be back-dated to when the move really began.
let rep = null, reps = [], trail = [], trailEnd = 0, buf = [];
function resetTracking(){ rep = null; buf = []; trail = []; }

// ---------- one finished rep (shared by every move) ----------
// r: the tracker's state for this rep { start, side, errors:Set, seen:Set, snapStart, hasFar }
// res: the move's judgement { R, dir, note, V, mi }
function commitRep(r, res){
  for (const k of REP) if (res.R[k][0] === "bad") r.errors.add(k);
  const segs = res.V ? compressSegs(res.V) : null;
  const peak = res.V ? res.mi / Math.max(1, res.V.length - 1) : 0;
  const measured = [...r.seen].filter(k => M_().rate.includes(k) && !REP.includes(k)).concat(REP.filter(k => res.R[k][0] !== "na"));
  const rec = { module: mod, n: reps.length + 1, side: r.side, dir: res.dir, errors: [...r.errors], R: res.R, segs, peak, measured,
                at: Date.now(), t0: r.start, t1: video.currentTime,
                snaps: { start: r.snapStart || null, far: r.hasFar ? farC.toDataURL("image/jpeg", 0.72) : null, close: null } };
  reps.push(rec);
  if (!sessionStart) sessionStart = rec.at;
  pendingClose = rec;                                      // closing frame is captured after this frame is drawn
  labelFrames(r.start, video.currentTime, rec.n);
  rec.id = uuid(); rec.sessionKey = sessionId; rec.sessionStart = sessionStart;
  rec.coords = repCoords(rec.n);
  if (reps.length === 1) sessionDancer = cloud.dancerId;
  enqueueRep(rec);
  lastRep = { ...res, note: res.note || null, side: r.side, segs, peak };
  lastDir = res.dir;
  showRep(lastRep);
  renderReps();
  $("dirChip").querySelector("span").textContent = dirLabel(res.dir);
  const firstBad = REP.find(k => res.R[k][0] === "bad");
  announceResult(!rec.errors.length, firstBad ? "c_" + firstBad : null);
  return rec;
}

// consecutive frames in the same phase -> [{ph, w}] with w = share of the rep
function compressSegs(V){
  const segs = [];
  V.forEach(s => { const last = segs[segs.length - 1]; if (last && last.ph === s.ph) last.n++; else segs.push({ ph: s.ph, n: 1 }); });
  return segs.map(sg => ({ ph: sg.ph, w: sg.n / V.length }));
}
function fillTimeline(tl, segs, peak){
  tl.innerHTML = "";
  if (!segs) return;
  for (const sg of segs){
    const el = document.createElement("span");
    el.style.width = (sg.w * 100) + "%";
    el.style.background = `var(${PHASES[sg.ph][1]})`;
    el.title = t(PHASES[sg.ph][0]);
    tl.appendChild(el);
  }
  const p = document.createElement("i"); p.className = "peak"; p.style.left = (peak * 100) + "%";
  tl.appendChild(p);
}
function showRep({ R, dir, note, segs, peak, side }){
  $("repEmpty").hidden = true; $("repBody").hidden = false;
  $("repTitle").textContent = dirLabel(dir) + " · " + t(side);
  $("repNote").textContent = note ? t(note[0], note[1]) : "";
  $("repNote").hidden = !note;
  for (const k of REP) setRow(repEls, k, R[k]);
  fillTimeline($("timeline"), segs, peak);
}

function renderReps(){
  $("repCount").textContent = reps.length;
  $("goodCount").textContent = reps.filter(r => !r.errors.length).length;
  const ul = $("reps"); ul.innerHTML = "";
  if (!reps.length){ const li = document.createElement("li"); li.className = "empty"; li.style.background = "none"; li.textContent = t("noReps"); ul.appendChild(li); return; }
  reps.slice().reverse().slice(0, 40).forEach((r, i) => {
    const li = document.createElement("li");
    const head = document.createElement("span");
    head.textContent = t("repLine", reps.length - i, r.dir ? (M_().dirShort || M_().dirLabel)(r.dir) : "?", t(r.side));
    const body = document.createElement("span");
    if (!r.errors.length){ body.className = "good"; body.textContent = t("allCorrect"); }
    else { body.className = "err"; body.textContent = r.errors.map(k => t("n_" + k)).join(t("sep")); }
    li.append(head, body); ul.appendChild(li);
  });
}
function newSession(){
  saveHistory(); cloudSummary();
  reps = []; trail = []; lastRep = null; frameLog = []; sessionId = uuid(); sessionStart = null; sessionDancer = null;
  renderReps(); updateFrameInfo();
  $("repEmpty").hidden = false; $("repBody").hidden = true; $("repTitle").textContent = "";
}
$("resetBtn").addEventListener("click", newSession);

// ---------- keyframe snapshots (start / farthest / close of each tendu) ----------
const SNAP_W = 360;
const farC = document.createElement("canvas"), farCtx = farC.getContext("2d");
const tmpC = document.createElement("canvas"), tmpCtx = tmpC.getContext("2d");
let pendingClose = null;
function snapTo(c, cx){
  const w = SNAP_W, h = Math.round(w * H() / W()) || 200;
  if (c.width !== w || c.height !== h){ c.width = w; c.height = h; }
  cx.drawImage(video, 0, 0, w, h);
  if (cfg.blurFace) pixelateHead(cx, w, h, lastLm);
  cx.drawImage(canvas, 0, 0, w, h);
}
// Keyframes for the report (and the cloud) get the head pixelated, so the child can't be recognized.
// The box is built from the face landmarks (nose, eyes, ears, mouth), widened for hair and the bun.
// Pixelating (shrink, then enlarge without smoothing) works in every browser, unlike canvas blur filters.
const pixC = document.createElement("canvas"), pixCtx = pixC.getContext("2d");
function headBox(lm, w, h){
  if (!lm) return null;
  const xs = [], ys = [];
  for (let i = 0; i <= 10; i++){ xs.push(lm[i].x * w); ys.push(lm[i].y * h); }
  const sh = { x: (lm[11].x + lm[12].x) / 2 * w, y: (lm[11].y + lm[12].y) / 2 * h }, hp = { x: (lm[23].x + lm[24].x) / 2 * w, y: (lm[23].y + lm[24].y) / 2 * h };
  const torso = Math.hypot(sh.x - hp.x, sh.y - hp.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 0.42 * torso) * 1.7;
  // reach a bit higher than the face (hair, bun) and stop above the shoulders
  const top = cy - size * 0.68, bottom = Math.min(cy + size * 0.42, sh.y - 0.04 * torso);
  return { x: cx - size / 2, y: top, w: size, h: Math.max(size * 0.6, bottom - top) };
}
function pixelateHead(cx, w, h, lm){
  const b = headBox(lm, w, h);
  if (!b) return;
  const x = Math.max(0, Math.floor(b.x)), y = Math.max(0, Math.floor(b.y));
  const bw = Math.min(w - x, Math.ceil(b.w)), bh = Math.min(h - y, Math.ceil(b.h));
  if (bw < 2 || bh < 2) return;
  const n = 5;                                             // about 5 blocks across the head
  pixC.width = n; pixC.height = Math.max(2, Math.round(n * bh / bw));
  pixCtx.drawImage(cx.canvas, x, y, bw, bh, 0, 0, pixC.width, pixC.height);
  cx.save(); cx.imageSmoothingEnabled = false;
  cx.beginPath(); cx.ellipse(x + bw / 2, y + bh / 2, bw / 2, bh / 2, 0, 0, Math.PI * 2); cx.clip();
  cx.drawImage(pixC, 0, 0, pixC.width, pixC.height, x, y, bw, bh);
  cx.restore();
}
const snapURL = () => { snapTo(tmpC, tmpCtx); return tmpC.toDataURL("image/jpeg", 0.72); };
function afterDraw(){
  if (rep && rep.needStart){ rep.snapStart = snapURL(); rep.needStart = false; }
  if (rep && rep.farDirty){ snapTo(farC, farCtx); rep.farDirty = false; rep.hasFar = true; }
  if (pendingClose){ pendingClose.snaps.close = snapURL(); pendingClose = null; }
}

// ---------- per-frame coordinates ----------
const LM_NAMES = ["nose","left_eye_inner","left_eye","left_eye_outer","right_eye_inner","right_eye","right_eye_outer","left_ear","right_ear",
  "mouth_left","mouth_right","left_shoulder","right_shoulder","left_elbow","right_elbow","left_wrist","right_wrist","left_pinky","right_pinky",
  "left_index","right_index","left_thumb","right_thumb","left_hip","right_hip","left_knee","right_knee","left_ankle","right_ankle",
  "left_heel","right_heel","left_foot_index","right_foot_index"];
const PH_CODE = { "-1":"toe_off", "0":"flat", "1":"demi_pointe", "2":"point", "10":"standing", "11":"going_down", "12":"bottom", "13":"coming_up" };
const MAX_FRAMES = 60000;                                // about 30 minutes at 30 fps
let frameLog = [], srcId = 0, sessionId = uuid(), sessionStart = null, sessionDancer = null;
function recordFrame(lm, wlm, ph, lean, heelH){
  const img = new Float32Array(99), world = wlm ? new Float32Array(99) : null;
  for (let i = 0; i < 33; i++){
    img[i*3] = lm[i].x; img[i*3+1] = lm[i].y; img[i*3+2] = lm[i].visibility ?? 1;
    if (world){ world[i*3] = wlm[i].x; world[i*3+1] = wlm[i].y; world[i*3+2] = wlm[i].z; }
  }
  frameLog.push({ src: srcId, t: video.currentTime, wall: Date.now(), rep: 0, side: workSide, ph, lean, heelH,
                vw: video.videoWidth, vh: video.videoHeight, img, world });
  if (frameLog.length > MAX_FRAMES) frameLog.shift();
  if (frameLog.length % 30 === 0) updateFrameInfo();
}
// after a tendu is judged, tag its frames with the tendu number
function labelFrames(t0, t1, n){
  for (let i = frameLog.length - 1; i >= 0; i--){
    const f = frameLog[i];
    if (f.src !== srcId || f.t > t1 + 0.001) { if (f.src !== srcId) break; continue; }
    if (f.t < t0) break;
    f.rep = n;
  }
}
function updateFrameInfo(){
  const n = frameLog.length, secs = n ? Math.round((frameLog[n-1].wall - frameLog[0].wall) / 1000) : 0;
  $("frameInfo").textContent = n ? t("frameInfo", n, secs) : "";
}
function downloadText(name, text, type){
  const blob = new Blob(["﻿" + text], { type });            // BOM so Excel reads Chinese correctly
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
const stampNow = () => { const d = new Date(), p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };
const csvCell = v => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const num = (v, d = 5) => v == null || Number.isNaN(v) ? "" : (+v).toFixed(d);

$("exportFrames").addEventListener("click", () => {
  if (!frameLog.length){ setStatus("noFrames"); return; }
  const head = ["source","frame","time_s","wall_clock","rep","working_leg","phase","leg_lean_deg","heel_height_footlen","video_w","video_h"];
  for (const n of LM_NAMES) head.push(n + "_x", n + "_y", n + "_vis");
  for (const n of LM_NAMES) head.push(n + "_wx_m", n + "_wy_m", n + "_wz_m");
  const rows = [head.join(",")];
  frameLog.forEach((f, i) => {
    const r = [f.src, i, num(f.t, 3), new Date(f.wall).toISOString(), f.rep || "", f.side, f.ph == null ? "" : PH_CODE[f.ph],
               num(f.lean, 2), num(f.heelH, 3), f.vw, f.vh];
    for (let k = 0; k < 99; k++) r.push(num(f.img[k]));
    for (let k = 0; k < 99; k++) r.push(f.world ? num(f.world[k]) : "");
    rows.push(r.join(","));
  });
  downloadText(`${mod}-coordinates-${stampNow()}.csv`, rows.join("\n"), "text/csv");
});
$("exportReps").addEventListener("click", () => {
  if (!reps.length){ setStatus("noRepsForReport"); return; }
  const keys = rateKeys(mod);
  const head = ["rep","clock_time","video_start_s","video_end_s","direction","working_leg","all_correct"];
  for (const k of keys) head.push(k, k + "_detail");
  const rows = [head.join(",")];
  for (const r of reps){
    const row = [r.n, new Date(r.at).toISOString(), num(r.t0, 2), num(r.t1, 2), r.dir || "", r.side, r.errors.length ? "no" : "yes"];
    for (const k of keys){
      const st = r.errors.includes(k) ? "bad" : r.measured.includes(k) ? "ok" : "na";
      row.push(st, r.R[k] ? fmt(r.R[k])[1] : "");
    }
    rows.push(row.map(csvCell).join(","));
  }
  downloadText(`${mod}-results-${stampNow()}.csv`, rows.join("\n"), "text/csv");
});

// ---------- history (long-term trend) ----------
const HKEY = "tendu-history";
function loadHistory(){ try { return JSON.parse(localStorage.getItem(HKEY)) || []; } catch { return []; } }
function sessionSummary(){
  const dirs = {}, fails = {}, meas = {};
  for (const r of reps){
    const k = r.dir || "unknown";
    dirs[k] = dirs[k] || [0, 0]; dirs[k][0]++; if (!r.errors.length) dirs[k][1]++;
    for (const e of r.errors) fails[e] = (fails[e] || 0) + 1;
    for (const m of r.measured) meas[m] = (meas[m] || 0) + 1;
  }
  return { id: sessionId, module: mod, start: sessionStart, end: reps.length ? reps[reps.length - 1].at : null,
           total: reps.length, good: reps.filter(r => !r.errors.length).length, dirs, fails, meas };
}
function saveHistory(){
  if (!reps.length) return;
  const h = loadHistory().filter(s => s.id !== sessionId);
  h.push(sessionSummary());
  h.sort((a, b) => a.start - b.start);
  try { localStorage.setItem(HKEY, JSON.stringify(h.slice(-200))); } catch {}
}

// ---------- sound ----------
// Short synthesized tones carry across a room better than speech. The audio context is unlocked by the
// Start camera / Upload video tap (browsers only allow sound after a user gesture).
let audioCtx = null;
function unlockAudio(){
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch {}
}
function tone(freq, start, dur, type = "sine", vol = 0.35){
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(vol, start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(audioCtx.destination); o.start(start); o.stop(start + dur + 0.05);
}
// returns true if a sound was played, so speech can wait for it
function playResult(allCorrect){
  if (!cfg.sound || !audioCtx || audioCtx.state !== "running") return false;
  const now = audioCtx.currentTime;
  if (allCorrect){ tone(1318.5, now, 0.35); tone(1760, now + 0.12, 0.5); }          // E6 → A6 "ding-dong"
  else { tone(262, now, 0.22, "triangle", 0.4); tone(196, now + 0.18, 0.3, "triangle", 0.4); }   // C4 → G3
  return true;
}
function announceResult(allCorrect, cueKey){
  const played = playResult(allCorrect);
  if (cueKey) setTimeout(() => say(t(cueKey), true), played ? 600 : 0);
}
$("camBtn").addEventListener("click", unlockAudio);
$("fileInput").addEventListener("click", unlockAudio);

// ---------- voice ----------
const badSince = {}, lastSpoke = {}; let lastAny = 0;
function say(text, force){
  if (!cfg.voice || !("speechSynthesis" in window)) return;
  const now = performance.now();
  if (!force && now - lastAny < 1800) return;
  const u = new SpeechSynthesisUtterance(text); u.lang = lang === "zh" ? "zh-CN" : "en-US"; u.rate = 1.05;
  speechSynthesis.cancel(); speechSynthesis.speak(u); lastAny = now;
}
function voice(out){
  const now = performance.now();
  const quiet = M_().quiet || [];
  for (const k of LIVE){
    if (quiet.includes(k)) continue;           // e.g. tendu floor contact is reported per rep
    if (out[k][0] !== "bad"){ badSince[k] = 0; continue; }
    if (!badSince[k]) badSince[k] = now;
    if (now - badSince[k] > 500 && now - (lastSpoke[k] || 0) > 4000 && now - lastAny > 1800){
      say(t("c_" + k)); lastSpoke[k] = now; return;
    }
  }
}
