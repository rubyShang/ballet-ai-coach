"use strict";
// ---------- cloud: accounts, dancers, sync (Supabase) ----------
// Turned on when config.js has a Supabase URL and anon key; otherwise the app runs device-only.
// Each family signs in with an email code; row-level security keeps every family's data private.
// Synced per tendu: the judged results, three keyframe JPEGs (private bucket) and leg coordinates.
// Videos are never uploaded.
const SUPA_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.js";
const CONF = window.BALLET_CONFIG || {};
const cloud = { enabled: !!(CONF.supabaseUrl && CONF.supabaseAnonKey), sb: null, user: null, dancers: [], dancerId: null,
                queue: [], busy: false, errored: false };
const cloudReady = () => !!(cloud.enabled && cloud.sb && cloud.user && cloud.dancerId);
const iso = ts => new Date(ts).toISOString();
function loadScript(src){
  return new Promise((res, rej) => { const el = document.createElement("script"); el.src = src; el.onload = res; el.onerror = () => rej(new Error("network")); document.head.appendChild(el); });
}
let acctMsg = null;
function setAcctMsg(key, arg){ acctMsg = key ? [key, arg] : null; $("acctMsg").textContent = key ? t(key, arg) : ""; }

// sign-in gate: "loading" | "email" | "code" | "child" | null (app visible)
let gateStep = null, gateMsg = null, lastEmail = "", resendAt = 0, resendTimer = 0;
function gate(step){
  gateStep = step;
  document.body.classList.toggle("show-gate", !!step);
  for (const [id, st] of [["gLoading", "loading"], ["gEmail", "email"], ["gCode", "code"], ["gChild", "child"]]) $(id).hidden = st !== step;
  const focus = { email: "email", code: "code", child: "childName" }[step];
  if (focus) setTimeout(() => $(focus).focus(), 50);
}
function setGateMsg(key, arg, ok){
  gateMsg = key ? [key, arg, ok] : null;
  $("gateMsg").textContent = key ? t(key, arg) : "";
  $("gateMsg").classList.toggle("ok", !!ok);
}
function renderGate(){
  if (gateMsg) setGateMsg(...gateMsg);
  if (lastEmail) $("codeSentMsg").textContent = t("codeSent", lastEmail);
  tickResend();
}
function tickResend(){
  const left = Math.ceil((resendAt - Date.now()) / 1000), b = $("resendCode");
  b.disabled = left > 0;
  b.textContent = left > 0 ? t("resendIn", left) : t("resend");
  clearTimeout(resendTimer);
  if (left > 0) resendTimer = setTimeout(tickResend, 1000);
}
async function sendCodeTo(email){
  const { error } = await cloud.sb.auth.signInWithOtp({ email, options: { shouldCreateUser: CONF.allowSignup !== false } });
  if (error){
    const invite = /signup|not allowed|not found/i.test(error.message || "");
    setGateMsg(invite ? "inviteOnly" : "authErr", error.message);
    return false;
  }
  lastEmail = email; resendAt = Date.now() + 60000; tickResend();
  return true;
}

async function cloudInit(){
  if (!cloud.enabled) return;
  gate("loading");
  try { if (!window.supabase) await loadScript(SUPA_JS); }
  catch(e){ gate(null); setAcctMsg("authErr", e.message); return; }       // offline: let the app work device-only
  cloud.sb = window.supabase.createClient(CONF.supabaseUrl, CONF.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  // run Supabase calls outside the auth callback (calling it from inside can deadlock)
  cloud.sb.auth.onAuthStateChange((_ev, session) => setTimeout(() => onUser(session ? session.user : null), 0));
}
async function onUser(user){
  const changed = (user && user.id) !== (cloud.user && cloud.user.id);
  cloud.user = user;
  if (!user){
    if (reps.length) newSession();
    cloud.dancers = []; cloud.dancerId = null; renderAcct(); loadHistoryList(); gate("email"); return;
  }
  if (changed){ gate("loading"); await loadDancers(); } else renderAcct();
  gate(cloud.dancers.length ? null : "child");
}
async function loadDancers(){
  const { data, error } = await cloud.sb.from("dancers").select("id,name").order("created_at");
  if (error){ setAcctMsg("authErr", error.message); setGateMsg("authErr", error.message); return; }
  cloud.dancers = data || [];
  const saved = lsGet("ballet-dancer");
  cloud.dancerId = (cloud.dancers.find(d => d.id === saved) || cloud.dancers[0] || {}).id || null;
  renderAcct(); loadHistoryList(); flushSoon();
  if (document.body.classList.contains("view-diary")) renderDiary();
}
function renderAcct(){
  if (!cloud.enabled) return;
  const inn = !!cloud.user;
  $("acctCard").hidden = !inn; $("acctIn").hidden = !inn;
  if (inn){
    $("whoami").textContent = t("signedInAs", cloud.user.email || "");
    const sel = $("dancerSel"); sel.innerHTML = "";
    for (const d of cloud.dancers){ const o = document.createElement("option"); o.value = d.id; o.textContent = d.name; sel.appendChild(o); }
    sel.value = cloud.dancerId || ""; sel.disabled = !cloud.dancers.length;
    if (!cloud.dancers.length) setAcctMsg("needDancer");
    else if (acctMsg && acctMsg[0] === "needDancer") setAcctMsg(null);
  }
  if (acctMsg) $("acctMsg").textContent = t(acctMsg[0], acctMsg[1]);
  renderSync();
}
function renderSync(){
  const el = $("syncState");
  el.className = "";
  if (!cloudReady()){ el.textContent = ""; return; }
  if (cloud.errored){ el.textContent = t("syncErr"); el.className = "err"; }
  else if (cloud.queue.length) el.textContent = t("syncPending", cloud.queue.length);
  else { el.textContent = t("syncOk"); el.className = "ok"; }
}

$("sendCode").addEventListener("click", async () => {
  const email = $("email").value.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ setGateMsg("badEmail"); return; }
  if (!cloud.sb) return;
  $("sendCode").disabled = true;
  const ok = await sendCodeTo(email);
  $("sendCode").disabled = false;
  if (!ok) return;
  setGateMsg(null); $("code").value = "";
  $("codeSentMsg").textContent = t("codeSent", email);
  gate("code");
});
$("resendCode").addEventListener("click", async () => {
  if (Date.now() < resendAt || !lastEmail) return;
  if (await sendCodeTo(lastEmail)) setGateMsg("codeResent", null, true);
});
$("changeEmail").addEventListener("click", () => { setGateMsg(null); gate("email"); });
$("verifyCode").addEventListener("click", async () => {
  const token = $("code").value.replace(/\s/g, "");
  if (!lastEmail || !token) return;
  $("verifyCode").disabled = true;
  const { error } = await cloud.sb.auth.verifyOtp({ email: lastEmail, token, type: "email" });
  $("verifyCode").disabled = false;
  if (error){ setGateMsg("badCode"); return; }
  setGateMsg(null); gate("loading");                      // onAuthStateChange takes it from here
});
$("addChild").addEventListener("click", async () => {
  const name = $("childName").value.trim();
  if (!name) return;
  $("addChild").disabled = true;
  const { data, error } = await cloud.sb.from("dancers").insert({ name }).select("id,name").single();
  $("addChild").disabled = false;
  if (error){ setGateMsg("authErr", error.message); return; }
  $("childName").value = ""; setGateMsg(null);
  cloud.dancers.push(data);
  switchDancer(data.id);
  gate(null);
});
// Enter key moves each gate step forward
[["email", "sendCode"], ["code", "verifyCode"], ["childName", "addChild"]].forEach(([inp, btn]) =>
  $(inp).addEventListener("keydown", e => { if (e.key === "Enter"){ e.preventDefault(); $(btn).click(); } }));
$("signOut").addEventListener("click", async () => { await cloud.sb.auth.signOut(); });
$("addDancer").addEventListener("click", async () => {
  const name = $("dancerName").value.trim();
  if (!name) return;
  const { data, error } = await cloud.sb.from("dancers").insert({ name }).select("id,name").single();
  if (error){ setAcctMsg("authErr", error.message); return; }
  $("dancerName").value = "";
  cloud.dancers.push(data);
  switchDancer(data.id);
});
$("dancerSel").addEventListener("change", e => switchDancer(e.target.value));
function switchDancer(id){
  if (id === cloud.dancerId){ renderAcct(); return; }
  if (reps.length) newSession();              // a session belongs to one dancer
  cloud.dancerId = id; lsSet("ballet-dancer", id);
  renderAcct(); loadHistoryList(); flushSoon();
  if (document.body.classList.contains("view-diary")) renderDiary();
}

// --- per-tendu leg coordinates (shoulders, hips, knees, ankles, heels, toes) ---
const COORD_IDX = [11, 12, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
function repCoords(n){
  const fs = frameLog.filter(f => f.src === srcId && f.rep === n);
  if (!fs.length) return null;
  const r4 = v => Math.round(v * 1e4) / 1e4;
  return {
    points: COORD_IDX.map(i => LM_NAMES[i]),
    t: fs.map(f => Math.round(f.t * 1000) / 1000),
    phase: fs.map(f => f.ph == null ? null : PH_CODE[f.ph]),
    img: fs.map(f => COORD_IDX.flatMap(i => [r4(f.img[i*3]), r4(f.img[i*3+1]), r4(f.img[i*3+2])])),       // x, y (0-1), visibility
    world: fs[0].world ? fs.map(f => COORD_IDX.flatMap(i => [r4(f.world[i*3]), r4(f.world[i*3+1]), r4(f.world[i*3+2])])) : null, // metres
  };
}

// --- upload queue (runs in order; retries every 30 s on failure) ---
function enqueueRep(rec){
  if (!cloudReady() || sessionDancer !== cloud.dancerId) return;
  rec.dancerId = cloud.dancerId;
  cloud.queue.push({ kind: "rep", rec });
  renderSync(); flushSoon();
}
function cloudSummary(){
  if (!cloudReady() || !reps.length || !sessionDancer) return;
  cloud.queue.push({ kind: "summary", s: { ...sessionSummary(), dancerId: sessionDancer } });
  renderSync(); flushSoon();
}
let flushTimer = 0;
function flushSoon(ms = 400){ clearTimeout(flushTimer); flushTimer = setTimeout(flush, ms); }
async function flush(){
  if (cloud.busy || !cloud.sb || !cloud.user || !cloud.queue.length) return;
  cloud.busy = true;
  let summaries = 0;
  try {
    while (cloud.queue.length){
      const item = cloud.queue[0];
      if (item.kind === "rep"){
        await uploadRep(item.rec);
        if (item.rec.sessionKey === sessionId) await uploadSummary({ ...sessionSummary(), dancerId: item.rec.dancerId });
      } else { await uploadSummary(item.s); summaries++; }
      cloud.queue.shift(); renderSync();
    }
    cloud.errored = false;
  } catch(e){
    console.warn("sync failed", e);
    cloud.errored = true; flushSoon(30000);
  }
  cloud.busy = false; renderSync();
  if (summaries) loadHistoryList();
}
function dataURLtoBlob(u){
  const [head, b64] = u.split(","), bin = atob(b64), arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: head.slice(5, head.indexOf(";")) });
}
async function uploadSummary(s){
  const { error } = await cloud.sb.from("sessions").upsert({
    id: s.id, dancer_id: s.dancerId, started_at: iso(s.start), ended_at: s.end ? iso(s.end) : null,
    total: s.total, good: s.good, module: s.module || "tendu", summary: { dirs: s.dirs, fails: s.fails, meas: s.meas } }, { onConflict: "id" });
  if (error) throw error;
}
async function uploadRep(rec){
  const sb = cloud.sb;
  // make sure the session row exists before the tendu that points at it
  let { error } = await sb.from("sessions").upsert(
    { id: rec.sessionKey, dancer_id: rec.dancerId, module: rec.module || "tendu", started_at: iso(rec.sessionStart || rec.at) }, { onConflict: "id", ignoreDuplicates: true });
  if (error) throw error;
  const keyframes = {};
  for (const k of ["start", "far", "close"]){
    if (!rec.snaps[k] || !rec.snaps[k].startsWith("data:")) continue;
    const path = `${cloud.user.id}/${rec.sessionKey}/${rec.id}-${k}.jpg`;
    ({ error } = await sb.storage.from("keyframes").upload(path, dataURLtoBlob(rec.snaps[k]), { contentType: "image/jpeg", upsert: true }));
    if (error) throw error;
    keyframes[k] = path;
  }
  ({ error } = await sb.from("reps").upsert({
    id: rec.id, session_id: rec.sessionKey, dancer_id: rec.dancerId, n: rec.n, at: iso(rec.at),
    module: rec.module || "tendu", direction: rec.dir, side: rec.side, all_correct: !rec.errors.length, errors: rec.errors, measured: rec.measured,
    results: rec.R, segs: rec.segs, peak: rec.peak, keyframes, coords: rec.coords }, { onConflict: "id" }));
  if (error) throw error;
}

// --- history from the cloud ---
// m = a move id for the report's trend; null = every move (the history list on the Me page)
async function cloudHistory(m = mod){
  let q = cloud.sb.from("sessions").select("id,module,started_at,ended_at,total,good,summary").eq("dancer_id", cloud.dancerId);
  if (m) q = q.eq("module", m);
  const { data, error } = await q.order("started_at", { ascending: true }).limit(m ? 200 : 400);
  if (error){ console.warn(error); return loadHistory().filter(h => !m || (h.module || "tendu") === m); }
  const hs = (data || []).filter(r => r.total > 0).map(r => ({ id: r.id, start: Date.parse(r.started_at), end: r.ended_at ? Date.parse(r.ended_at) : null,
    module: r.module || "tendu", total: r.total, good: r.good, ...(r.summary || {}) }));
  if (reps.length && sessionDancer === cloud.dancerId && (!m || m === mod)){   // include the session in progress
    const cur = sessionSummary(), i = hs.findIndex(h => h.id === cur.id);
    if (i >= 0) hs[i] = cur; else hs.push(cur);
  }
  return hs;
}
let histCache = [], histLoading = false;
async function loadHistoryList(){
  if (!cloudReady()){ $("histCard").hidden = true; return; }
  $("histCard").hidden = false;
  histLoading = true; renderHistList();
  const hs = await cloudHistory(null);
  histCache = hs.filter(h => h.id !== sessionId).reverse().slice(0, 30);
  histLoading = false; renderHistList();
}
function renderHistList(){
  const ul = $("histList"); if (!ul) return;
  ul.innerHTML = "";
  const msg = histLoading ? t("loadingHist") : !histCache.length ? t("historyEmpty") : null;
  if (msg){ const li = document.createElement("li"); li.className = "empty"; li.textContent = msg; ul.appendChild(li); return; }
  for (const h of histCache){
    const li = document.createElement("li");
    const info = document.createElement("div"); info.className = "info";
    info.textContent = `${fDate(h.start)} ${fTime(h.start)}`;
    const sm = document.createElement("small"); sm.textContent = (MOVES[h.module] ? t("mod_" + h.module) + " · " : "") + t("sessionRow", h.total, h.good); info.appendChild(sm);
    const b = document.createElement("button"); b.textContent = t("viewReport");
    b.addEventListener("click", () => openPastReport(h, b));
    li.append(info, b); ul.appendChild(li);
  }
}
async function openPastReport(h, btn){
  btn.disabled = true;
  try {
    const { data, error } = await cloud.sb.from("reps").select("*").eq("session_id", h.id).order("n");
    if (error) throw error;
    const paths = (data || []).flatMap(r => Object.values(r.keyframes || {}));
    const urls = {};
    if (paths.length){
      const { data: su, error: e2 } = await cloud.sb.storage.from("keyframes").createSignedUrls(paths, 3600);
      if (e2) throw e2;
      (su || []).forEach(x => { if (x.signedUrl) urls[x.path] = x.signedUrl; });
    }
    const kf = (r, k) => (r.keyframes && urls[r.keyframes[k]]) || null;
    const list = (data || []).map(r => ({ n: r.n, side: r.side, dir: r.direction, errors: r.errors || [], R: r.results || {},
      segs: r.segs, peak: r.peak || 0, measured: r.measured || [], at: Date.parse(r.at),
      snaps: { start: kf(r, "start"), far: kf(r, "far"), close: kf(r, "close") } }));
    if (!list.length){ setAcctMsg("historyEmpty"); return; }
    await openReport({ reps: list, module: h.module || "tendu", sid: h.id, start: h.start, cloud: true, hist: await cloudHistory(h.module || "tendu") });
  } catch(e){ setAcctMsg("authErr", e.message || String(e)); }
  finally { btn.disabled = false; }
}
