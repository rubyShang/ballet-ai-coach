"use strict";
// ---------- recording ----------
// "with overlay" records a canvas that combines the video, the skeleton/trail and the labels;
// "raw" records the camera stream directly (better for analyzing again later).
// Frames are stored unmirrored so left/right stay correct when a recording is analyzed again.
// While recording, each second of video is written to this device's storage (IndexedDB) instead of being
// kept in memory, so long sessions don't fill the phone's RAM and what was recorded survives a reload.
// Recordings split into 5-minute parts automatically. Bitrate 2.5 Mbps ≈ 19 MB per minute.
const comp = document.createElement("canvas"), cctx = comp.getContext("2d");
let recorder = null, recAnnotated = true, recStartAt = 0, recTimer = 0, recordings = [], phaseColor = "#888";
let recGroup = null, recSeg = null, SEG_SEC = 300;
const REC_BPS = 2.5e6;
function pickMime(){
  const c = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return c.find(m => MediaRecorder.isTypeSupported(m)) || "";
}

// --- small IndexedDB store: "recs" (one row per recording part) and "chunks" (1-second pieces) ---
let idbP = null, idbOK = true;
const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
function idb(){
  if (!idbP) idbP = new Promise((res, rej) => {
    let q; try { q = indexedDB.open("ballet-rec", 1); } catch(e){ rej(e); return; }
    q.onupgradeneeded = () => { const db = q.result; db.createObjectStore("recs", { keyPath: "id" }); db.createObjectStore("chunks", { autoIncrement: true }).createIndex("rec", "rec"); };
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
  return idbP;
}
const idbPut = async (store, v) => reqP((await idb()).transaction(store, "readwrite").objectStore(store).put(v));
const idbAdd = async (store, v) => reqP((await idb()).transaction(store, "readwrite").objectStore(store).add(v));
const idbAll = async store => reqP((await idb()).transaction(store).objectStore(store).getAll());
const idbChunks = async id => reqP((await idb()).transaction("chunks").objectStore("chunks").index("rec").getAll(id));
async function idbRemove(id){
  const tr = (await idb()).transaction(["recs", "chunks"], "readwrite");
  tr.objectStore("recs").delete(id);
  const cur = tr.objectStore("chunks").index("rec").openKeyCursor(IDBKeyRange.only(id));
  cur.onsuccess = () => { const c = cur.result; if (c){ tr.objectStore("chunks").delete(c.primaryKey); c.continue(); } };
  return new Promise((res, rej) => { tr.oncomplete = res; tr.onerror = () => rej(tr.error); });
}
const recMeta = m => { const { blob, ...rest } = m; return rest; };      // what gets stored (no in-memory blob)

function recFileName(g, part, multi, type){
  return `${mod}-${g.stamp}${g.annotated ? "-overlay" : ""}${multi ? "-part" + part : ""}.${type.includes("mp4") ? "mp4" : "webm"}`;
}
function startRec(){
  if (!window.MediaRecorder){ setStatus("recUnsupported"); return; }
  recAnnotated = $("recMode").value === "annotated" || mode === "file";
  if (mode === "file" && $("recMode").value === "raw") setStatus("recRawOnlyCam");
  let src;
  if (recAnnotated){ comp.width = video.videoWidth; comp.height = video.videoHeight; drawComposite(); src = comp.captureStream(30); }
  else src = stream;
  const d = new Date();
  recGroup = { src, mime: pickMime(), annotated: recAnnotated, part: 0, doneBytes: 0,
               stamp: `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}` };
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  recStartAt = performance.now();
  if (!startSegment()) { recGroup = null; return; }
  clearInterval(recTimer); recTimer = setInterval(recTick, 500);
  updateRecUI();
}
function startSegment(){
  const g = recGroup;
  let r;
  // a keyframe every second makes MP4 recorders hand over data each second instead of holding it all until stop,
  // which is what lets an interrupted recording be recovered (browsers that don't know the option ignore it)
  const opts = { videoBitsPerSecond: REC_BPS, videoKeyFrameIntervalDuration: 1000 };
  if (g.mime) opts.mimeType = g.mime;
  try { r = new MediaRecorder(g.src, opts); }
  catch(e){ setStatus("recFail", e.message || String(e)); return false; }
  g.part++;
  const type = (r.mimeType || g.mime || "video/webm").split(";")[0];
  const seg = { g, part: g.part, bytes: 0, started: performance.now(), mem: [], useIdb: idbOK, write: Promise.resolve(),
                meta: { id: uuid(), name: "", type, dur: 0, annotated: g.annotated, created: Date.now(), size: 0, saved: false, done: false, part: g.part } };
  const toMemory = () => { if (seg.useIdb){ seg.useIdb = false; idbOK = false; setStatus("recMemOnly"); } };
  if (seg.useIdb) seg.write = seg.write.then(() => idbPut("recs", recMeta(seg.meta))).catch(toMemory);   // so a crash can be recovered
  r.ondataavailable = e => {
    if (!e.data || !e.data.size) return;
    seg.bytes += e.data.size;
    const piece = e.data;
    seg.write = seg.write.then(async () => {
      if (seg.useIdb){ try { await idbAdd("chunks", { rec: seg.meta.id, data: await piece.arrayBuffer() }); return; } catch { toMemory(); } }
      seg.mem.push(piece);
    });
  };
  r.onstop = () => finishSegment(seg);
  r.start(1000);
  recorder = r; recSeg = seg;
  return true;
}
async function finishSegment(seg){
  const g = seg.g;
  seg.meta.dur = (performance.now() - seg.started) / 1000;
  seg.meta.size = seg.bytes; seg.meta.done = true;
  seg.meta.name = recFileName(g, seg.part, g.part > 1, seg.meta.type);
  g.doneBytes += seg.bytes;
  await seg.write;
  if (seg.mem.length) seg.meta.blob = new Blob(seg.mem, { type: seg.meta.type });
  if (seg.useIdb && !seg.mem.length) await idbPut("recs", recMeta(seg.meta)).catch(() => {});
  if (!seg.bytes){ if (seg.useIdb) idbRemove(seg.meta.id).catch(() => {}); return; }
  recordings = [seg.meta, ...recordings.filter(x => x.id !== seg.meta.id)];
  renderRecs(); setStatus("recDone");
  if (cfg.autoDl) saveRecording(seg.meta);
}
// every 0.5 s: update the REC badge and roll over to a new part at 5 minutes
function recTick(){
  if (recorder && recSeg && performance.now() - recSeg.started >= SEG_SEC * 1000){
    const old = recorder;
    if (startSegment()) old.stop();                 // start the next part first so almost nothing is missed
  }
  updateRecUI();
}
function stopRec(){
  if (recorder && recorder.state !== "inactive") recorder.stop();
  recorder = null; recGroup = null; recSeg = null; clearInterval(recTimer); updateRecUI();
}
$("recBtn").addEventListener("click", () => recorder ? stopRec() : startRec());

const mmss = s => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
const mb = n => (n / 1048576).toFixed(n < 10485760 ? 1 : 0);
function updateRecUI(){
  const b = $("recBtn");
  b.textContent = t(recorder ? "recStop" : "recStart");
  b.classList.toggle("on", !!recorder);
  b.disabled = !running && !recorder;
  $("recMode").disabled = !!recorder;
  $("recChip").hidden = !recorder;
  if (recorder && recGroup){
    const total = recGroup.doneBytes + (recSeg ? recSeg.bytes : 0);
    $("recChip").querySelector("span").textContent = `REC ${mmss((performance.now() - recStartAt) / 1000)} · ${mb(total)} MB` + (recGroup.part > 1 ? ` · ${t("recPart", recGroup.part)}` : "");
  }
}

function drawComposite(){
  const w = comp.width, h = comp.height;
  if (!w || !h) return;
  cctx.drawImage(video, 0, 0, w, h);
  cctx.drawImage(canvas, 0, 0, w, h);
  const fs = Math.max(16, Math.round(h / 24)), pad = Math.round(fs * 0.45);
  cctx.font = `600 ${fs}px "PingFang SC","Noto Sans SC","Microsoft YaHei",system-ui,sans-serif`;
  cctx.textBaseline = "middle";
  const chip = $("phaseChip");
  const rows = [
    { text: chip.querySelector("span").textContent + "  " + chip.querySelector("small").textContent, dot: phaseColor },
    { text: $("dirChip").querySelector("span").textContent },
  ];
  if (lastRep && !rep){
    const bad = REP.filter(k => lastRep.R[k][0] === "bad");
    rows.push({ text: bad.length ? "✗ " + bad.map(k => t("n_" + k)).join(t("sep")) : "✓ " + t("allCorrect"), dot: bad.length ? css("--bad") : css("--ok") });
  }
  let y = pad;
  for (const r of rows){
    const tw = cctx.measureText(r.text).width, dotW = r.dot ? fs * 0.9 : 0, bh = fs + pad;
    cctx.fillStyle = "rgba(0,0,0,.6)";
    cctx.fillRect(pad, y, tw + dotW + pad * 2, bh);
    if (r.dot){ cctx.fillStyle = r.dot; cctx.beginPath(); cctx.arc(pad * 2 + fs * 0.3, y + bh / 2, fs * 0.3, 0, Math.PI * 2); cctx.fill(); }
    cctx.fillStyle = "#fff"; cctx.fillText(r.text, pad * 2 + dotW, y + bh / 2);
    y += bh + pad / 2;
  }
}

// --- the recordings list (kept on this device across reloads) ---
async function recBlob(m){
  if (m.blob) return m.blob;
  const parts = await idbChunks(m.id);
  return new Blob(parts.map(c => c.data), { type: m.type });
}
async function saveRecording(m){
  const blob = await recBlob(m), url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = m.name || `recording.${m.type.includes("mp4") ? "mp4" : "webm"}`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  m.saved = true;
  if (!m.blob) idbPut("recs", recMeta(m)).catch(() => {});
  renderRecs();
}
async function loadRecordings(){
  try {
    const metas = await idbAll("recs");
    for (const m of metas.filter(x => !x.done)){            // a part interrupted by a reload or crash: recover what was written
      const parts = await idbChunks(m.id);
      if (!parts.length){ idbRemove(m.id).catch(() => {}); continue; }
      m.size = parts.reduce((s, c) => s + c.data.byteLength, 0); m.dur = m.dur || parts.length;   // ~1 s per piece
      m.done = true; m.recovered = true;
      m.name = m.name || `${mod}-recovered-${new Date(m.created).toISOString().slice(0, 19).replace(/[-:T]/g, "")}.${m.type.includes("mp4") ? "mp4" : "webm"}`;
      await idbPut("recs", m);
    }
    recordings = metas.filter(x => x.done && x.size).sort((a, b) => b.created - a.created);
  } catch { idbOK = false; }
  renderRecs();
}
function renderRecs(){
  const ul = $("recs"); ul.innerHTML = "";
  if (!recordings.length){ const li = document.createElement("li"); li.className = "empty"; li.textContent = t("recsEmpty"); ul.appendChild(li); }
  for (const r of recordings){
    const li = document.createElement("li");
    const info = document.createElement("div"); info.className = "info";
    const d = new Date(r.created), when = (ymd(d) === todayStr() ? "" : fShort(d) + " ") + `${p2(d.getHours())}:${p2(d.getMinutes())}`;
    info.textContent = `${when} · ${r.dur ? mmss(r.dur) : "—"} · ${mb(r.size)} MB`;
    const sm = document.createElement("small");
    sm.textContent = [t(r.annotated ? "tagAnnotated" : "tagRaw"), r.part > 1 || /-part\d/.test(r.name) ? t("recPart", r.part) : null,
                      r.type.includes("mp4") ? "MP4" : "WEBM", r.recovered ? t("recRecovered") : null, r.saved ? t("recSaved") : null].filter(Boolean).join(" · ");
    info.appendChild(sm);
    const mk = (key, fn) => { const b = document.createElement("button"); b.textContent = t(key); b.addEventListener("click", fn); return b; };
    li.append(info,
      mk("recAnalyze", async () => startFile(await recBlob(r))),
      mk("recSave", () => saveRecording(r)),
      mk("recDelete", async () => {
        if (recorder && recSeg && recSeg.meta.id === r.id) return;
        if (!confirm(t("recConfirmDelete"))) return;
        if (!r.blob) await idbRemove(r.id).catch(() => {});
        recordings = recordings.filter(x => x !== r); renderRecs();
      }));
    ul.appendChild(li);
  }
  const total = recordings.reduce((s, r) => s + (r.size || 0), 0);
  $("recStore").textContent = recordings.length ? t(idbOK ? "recStoreNote" : "recMemOnly", mb(total)) : "";
}
$("recAutoDl").addEventListener("change", e => { cfg.autoDl = e.target.checked; lsSet("ballet-autodl", e.target.checked ? "1" : ""); });
cfg.autoDl = !!lsGet("ballet-autodl"); $("recAutoDl").checked = cfg.autoDl;
loadRecordings();
window.addEventListener("beforeunload", e => {
  saveHistory();
  if (recorder || recordings.some(r => r.blob && !r.saved) || cloud.queue.length){ e.preventDefault(); e.returnValue = t("leaveWarn"); }
});
