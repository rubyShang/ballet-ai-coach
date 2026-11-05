"use strict";
// ---------- pain diary ----------
// One entry per dancer per day: pain 0–5, where it hurts, what she did that day, an optional note.
// Stored in the cloud (table "diary") when signed in, otherwise in this browser.
// The app never diagnoses: it only spots patterns and suggests seeing a doctor when pain is strong or keeps coming back.
const AREAS = ["heel_L", "heel_R", "knee_L", "knee_R", "ankle_L", "ankle_R", "foot_L", "foot_R", "hip", "back", "other"];
const ACTS = ["class", "home", "rehearsal", "rest"];
const PAIN_COL = ["#dff3ea", "#ffe3ea", "#ffc4d2", "#ff98ae", "#f0607c", "#dc3550"];
const p2 = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const parseDay = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return ymd(d); };
const todayStr = () => ymd(new Date());
const DKEY = "ballet-diary", SKEY = "ballet-schedule";

const diary = { entries: [], schedule: [], form: { day: todayStr(), pain: null, areas: [], acts: [], note: "" }, loaded: false, err: null };

// --- original face drawings for the 0–5 scale ---
function faceSVG(level){
  const mouth = level <= 1 ? `M14 28 Q22 ${36 - level * 2} 30 28` : level === 2 ? "M15 30 L29 30" : `M14 ${33 - (level - 3)} Q22 ${24 - (level - 3) * 2} 30 ${33 - (level - 3)}`;
  const brows = level >= 3 ? `<path d="M11 ${13 - (level - 3)} L18 ${15 + (level - 3)} M33 ${13 - (level - 3)} L26 ${15 + (level - 3)}" stroke="#5a3344" stroke-width="2" stroke-linecap="round"/>` : "";
  const eyes = level === 0 ? `<path d="M12 19 Q15 16 18 19 M26 19 Q29 16 32 19" stroke="#5a3344" stroke-width="2.2" fill="none" stroke-linecap="round"/>`
                           : `<circle cx="15" cy="19" r="2.2" fill="#5a3344"/><circle cx="29" cy="19" r="2.2" fill="#5a3344"/>`;
  const tear = level === 5 ? `<path d="M31 23 Q33 28 31 30 Q29 28 31 23 Z" fill="#7cc4ef"/>` : "";
  const blush = level <= 1 ? `<circle cx="11" cy="25" r="3" fill="#ff9fc0" opacity=".5"/><circle cx="33" cy="25" r="3" fill="#ff9fc0" opacity=".5"/>` : "";
  return `<svg viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="20" fill="#ffe8dc"/>${blush}${eyes}${brows}<path d="${mouth}" stroke="#5a3344" stroke-width="2.2" fill="none" stroke-linecap="round"/>${tear}</svg>`;
}

// --- storage ---
const diaryTableMissing = e => e && (e.code === "42P01" || e.code === "PGRST205" || /diary/i.test(e.message || "") && /exist|find|schema cache/i.test(e.message || ""));
async function diaryLoad(){
  diary.err = null;
  if (cloudReady()){
    const since = addDays(todayStr(), -120);
    const { data, error } = await cloud.sb.from("diary").select("day,pain,areas,activities,note").eq("dancer_id", cloud.dancerId).gte("day", since).order("day", { ascending: false });
    if (error){ diary.err = diaryTableMissing(error) ? "dNeedMigration" : ["authErr", error.message]; diary.entries = []; }
    else diary.entries = (data || []).map(r => ({ day: r.day, pain: r.pain, areas: r.areas || [], acts: r.activities || [], note: r.note || "" }));
    const d = cloud.dancers.find(x => x.id === cloud.dancerId);
    diary.schedule = (d && Array.isArray(d.schedule)) ? d.schedule : [];
    if (!d || d.schedule === undefined){
      const { data: dd } = await cloud.sb.from("dancers").select("schedule").eq("id", cloud.dancerId).single();
      if (dd && Array.isArray(dd.schedule)){ diary.schedule = dd.schedule; if (d) d.schedule = dd.schedule; }
    }
  } else {
    try { diary.entries = JSON.parse(lsGet(DKEY) || "[]"); } catch { diary.entries = []; }
    try { diary.schedule = JSON.parse(lsGet(SKEY) || "[]"); } catch { diary.schedule = []; }
  }
  diary.entries.sort((a, b) => b.day.localeCompare(a.day));
  diary.loaded = true;
}
async function diarySave(e){
  if (cloudReady()){
    const { error } = await cloud.sb.from("diary").upsert({ dancer_id: cloud.dancerId, day: e.day, pain: e.pain, areas: e.areas, activities: e.acts,
      note: e.note || null, updated_at: new Date().toISOString() }, { onConflict: "dancer_id,day" });
    if (error) throw error;
  }
  diary.entries = diary.entries.filter(x => x.day !== e.day).concat([{ ...e }]).sort((a, b) => b.day.localeCompare(a.day));
  if (!cloudReady()) lsSet(DKEY, JSON.stringify(diary.entries));
}
async function diaryDelete(day){
  if (cloudReady()){
    const { error } = await cloud.sb.from("diary").delete().eq("dancer_id", cloud.dancerId).eq("day", day);
    if (error) throw error;
  }
  diary.entries = diary.entries.filter(x => x.day !== day);
  if (!cloudReady()) lsSet(DKEY, JSON.stringify(diary.entries));
}
async function scheduleSave(days){
  diary.schedule = days;
  if (cloudReady()){
    const { error } = await cloud.sb.from("dancers").update({ schedule: days }).eq("id", cloud.dancerId);
    if (error) throw error;
    const d = cloud.dancers.find(x => x.id === cloud.dancerId); if (d) d.schedule = days;
  } else lsSet(SKEY, JSON.stringify(days));
}

// --- the form ---
const entryFor = day => diary.entries.find(e => e.day === day);
function practicedOn(day){
  if (reps.some(r => ymd(new Date(r.at)) === day)) return true;
  return loadHistory().some(h => h.start && ymd(new Date(h.start)) === day);
}
function loadForm(day){
  const e = entryFor(day);
  if (e) diary.form = { day, pain: e.pain, areas: [...e.areas], acts: [...e.acts], note: e.note || "" };
  else {
    const acts = [];
    if (diary.schedule.includes(parseDay(day).getDay())) acts.push("class");
    if (practicedOn(day)) acts.push("home");
    diary.form = { day, pain: null, areas: [], acts, note: "" };
  }
  renderForm();
}
function renderForm(){
  const f = diary.form, editing = !!entryFor(f.day);
  $("dDay").value = f.day; $("dDay").max = todayStr();
  $("dFaces").innerHTML = [0, 1, 2, 3, 4, 5].map(l => `<button type="button" data-pain="${l}" aria-pressed="${f.pain === l}" style="--pc:${PAIN_COL[l]}">${faceSVG(l)}<span>${esc(t("pain" + l))}</span></button>`).join("");
  $("dWhereBox").hidden = !(f.pain > 0);
  $("dAreas").innerHTML = AREAS.map(a => `<button type="button" class="chip-btn" data-area="${a}" aria-pressed="${f.areas.includes(a)}">${esc(t("area_" + a))}</button>`).join("");
  $("dActs").innerHTML = ACTS.map(a => `<button type="button" class="chip-btn" data-act="${a}" aria-pressed="${f.acts.includes(a)}">${esc(t("act_" + a))}</button>`).join("");
  $("dNote").value = f.note;
  $("dSave").textContent = t(editing ? "dUpdate" : "dSave");
  $("dDelete").hidden = !editing;
}
$("dFaces").addEventListener("click", e => { const b = e.target.closest("[data-pain]"); if (!b) return; diary.form.pain = +b.dataset.pain; if (!diary.form.pain) diary.form.areas = []; renderForm(); });
$("dAreas").addEventListener("click", e => { const b = e.target.closest("[data-area]"); if (!b) return; const a = b.dataset.area, f = diary.form; f.areas = f.areas.includes(a) ? f.areas.filter(x => x !== a) : f.areas.concat(a); renderForm(); });
$("dActs").addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b) return; const a = b.dataset.act, f = diary.form;
  f.acts = f.acts.includes(a) ? f.acts.filter(x => x !== a) : (a === "rest" ? ["rest"] : f.acts.filter(x => x !== "rest").concat(a));   // rest excludes the others
  renderForm();
});
$("dNote").addEventListener("input", e => diary.form.note = e.target.value.slice(0, 500));
$("dDay").addEventListener("change", e => { if (e.target.value) loadForm(e.target.value > todayStr() ? todayStr() : e.target.value); });
let dMsg = null;
function setDMsg(key, arg, ok){ dMsg = key ? [key, arg, ok] : null; $("dMsg").textContent = key ? t(key, arg) : ""; $("dMsg").classList.toggle("ok", !!ok); }
$("dSave").addEventListener("click", async () => {
  const f = diary.form;
  if (f.pain == null){ setDMsg("dPickPain"); return; }
  if (f.pain > 0 && !f.areas.length){ setDMsg("dPickArea"); return; }
  $("dSave").disabled = true;
  try { await diarySave({ day: f.day, pain: f.pain, areas: f.areas, acts: f.acts, note: f.note.trim() }); setDMsg("dSaved", null, true); renderDiary(false); }
  catch(err){ setDMsg(diaryTableMissing(err) ? "dNeedMigration" : "authErr", err.message); }
  finally { $("dSave").disabled = false; }
});
$("dDelete").addEventListener("click", async () => {
  if (!confirm(t("dConfirmDelete"))) return;
  try { await diaryDelete(diary.form.day); setDMsg("dDeleted", null, true); loadForm(diary.form.day); renderDiary(false); }
  catch(err){ setDMsg("authErr", err.message); }
});
$("dSchedule").addEventListener("change", async () => {
  const days = [...$("dSchedule").querySelectorAll("input:checked")].map(i => +i.value);
  try { await scheduleSave(days); setDMsg("dScheduleSaved", null, true); } catch(err){ setDMsg("authErr", err.message); }
});

// --- patterns, alerts, technique risks ---
function diaryStats(days){
  const since = addDays(todayStr(), -(days - 1)), byDay = {};
  diary.entries.forEach(e => byDay[e.day] = e);
  const recent = diary.entries.filter(e => e.day >= since);
  const areaCount = {};
  recent.forEach(e => e.areas.forEach(a => areaCount[a] = (areaCount[a] || 0) + 1));
  const nextDay = {};                                    // pain on the day after each kind of activity
  for (const a of ACTS){
    const days_ = recent.filter(e => e.acts.includes(a) && byDay[addDays(e.day, 1)]);
    if (days_.length >= 2) nextDay[a] = { n: days_.length, rate: days_.filter(e => byDay[addDays(e.day, 1)].pain > 0).length / days_.length };
  }
  return { since, recent, painDays: recent.filter(e => e.pain > 0).length, areaCount, nextDay, byDay };
}
function diaryAlerts(){
  const out = [], t3 = addDays(todayStr(), -2), t14 = addDays(todayStr(), -13);
  if (diary.entries.some(e => e.day >= t3 && e.pain >= 4)) out.push(["alertSevere"]);
  const c = {};
  diary.entries.filter(e => e.day >= t14 && e.pain > 0).forEach(e => e.areas.forEach(a => c[a] = (c[a] || 0) + 1));
  for (const [a, n] of Object.entries(c)) if (n >= 5) out.push(["alertRepeat", t("area_" + a), n]);
  return out;
}
// technique patterns that are linked to sore knees and heels; get(key) → { fail, meas }
function riskNotes(get){
  const out = [], r = k => { const x = get(k); return x && x.meas >= 3 ? x.fail / x.meas : null; };
  const kt = r("kneeTrack"); if (kt != null && kt > 0.3) out.push(["riskTurnout", pct(kt)]);
  const hy = r("hyperext"); if (hy != null && hy > 0.3) out.push(["riskHyper", pct(hy)]);
  const dp = r("depth"), hl = r("heels");
  if (dp != null || hl != null){ const m = Math.max(dp ?? 0, hl ?? 0); if (m > 0.4) out.push(["riskCalf", pct(m)]); }
  return out;
}
async function allRecentHistory(days){
  const since = Date.now() - days * 864e5;
  if (cloudReady()){
    const { data, error } = await cloud.sb.from("sessions").select("id,module,started_at,total,good,summary").eq("dancer_id", cloud.dancerId).gte("started_at", new Date(since).toISOString());
    if (!error) return (data || []).map(r => ({ id: r.id, start: Date.parse(r.started_at), ...(r.summary || {}) }));
  }
  return loadHistory().filter(h => h.start && h.start >= since);
}
async function recentRisks(){
  const hs = await allRecentHistory(30), cur = reps.length ? sessionSummary() : null;
  const list = hs.filter(h => !cur || h.id !== cur.id).concat(cur ? [cur] : []);
  const agg = {};
  for (const h of list) for (const k of Object.keys(h.meas || {})) { agg[k] = agg[k] || { fail: 0, meas: 0 }; agg[k].meas += h.meas[k]; agg[k].fail += (h.fails || {})[k] || 0; }
  return { notes: riskNotes(k => agg[k]), enough: Object.values(agg).some(x => x.meas >= 3) };
}
const riskHTML = notes => notes.map(([k, p]) => `<div class="risk-item"><b>${esc(t(k + "Title"))}</b><span class="cnt">${esc(t("riskRate", p))}</span><p>${esc(t(k))}</p></div>`).join("");

// --- page ---
function calHTML(days, big){
  const st = diaryStats(days), start = addDays(todayStr(), -(days - 1)), first = parseDay(start).getDay();
  const pad = (first + 6) % 7;                             // weeks start on Monday
  let h = `<div class="cal${big ? " big" : ""}">` + [1, 2, 3, 4, 5, 6, 0].map(d => `<span class="cal-h">${esc(t("wd" + d))}</span>`).join("");
  for (let i = 0; i < pad; i++) h += `<span class="cal-pad"></span>`;
  for (let i = 0; i < days; i++){
    const day = addDays(start, i), e = st.byDay[day], dd = parseDay(day).getDate();
    const tip = e ? `${day} · ${t("pain" + e.pain)}${e.areas.length ? " · " + e.areas.map(a => t("area_" + a)).join(", ") : ""}${e.acts.length ? " · " + e.acts.map(a => t("act_" + a)).join(", ") : ""}` : day;
    h += `<button type="button" class="cal-d${e ? "" : " empty"}${day === todayStr() ? " today" : ""}" data-day="${day}" title="${esc(tip)}" style="${e ? `background:${PAIN_COL[e.pain]};${e.pain >= 4 ? "color:#fff" : ""}` : ""}">${dd}${e && e.acts.includes("rehearsal") ? "<i>★</i>" : ""}</button>`;
  }
  return h + `</div>`;
}
function insightsHTML(st){
  const lines = [];
  lines.push(t("insDays", st.recent.length, st.painDays));
  const top = Object.entries(st.areaCount).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (top.length) lines.push(t("insAreas", top.map(([a, n]) => `${t("area_" + a)} (${n})`).join(t("sep"))));
  for (const a of ["rehearsal", "class", "home", "rest"]) if (st.nextDay[a]) lines.push(t("insNext", t("act_" + a), pct(st.nextDay[a].rate), st.nextDay[a].n));
  return lines.map(l => `<li>${esc(l)}</li>`).join("");
}
async function renderDiary(reload = true){
  if (reload || !diary.loaded){ $("dCal").innerHTML = `<p class="note-sm">${esc(t("loadingHist"))}</p>`; await diaryLoad(); loadForm(diary.form.day || todayStr()); }
  if (diary.err) setDMsg(...(Array.isArray(diary.err) ? diary.err : [diary.err]));
  $("dSchedule").querySelectorAll("input").forEach(i => i.checked = diary.schedule.includes(+i.value));
  $("dCal").innerHTML = calHTML(28, false);
  $("dInsights").innerHTML = insightsHTML(diaryStats(28));
  const al = diaryAlerts();
  $("dAlert").hidden = !al.length;
  $("dAlert").innerHTML = al.map(([k, a, n]) => `<p><b>${esc(t(k, a, n))}</b></p>`).join("") + `<p>${esc(t("alertWhen"))}</p>`;
  $("dRiskBody").innerHTML = `<p class="note-sm">${esc(t("loadingHist"))}</p>`;
  const rr = await recentRisks();
  $("dRiskBody").innerHTML = rr.notes.length ? riskHTML(rr.notes) : `<p class="note-sm">${esc(t(rr.enough ? "riskNone" : "riskNotEnough"))}</p>`;
}
$("dCal").addEventListener("click", e => { const b = e.target.closest("[data-day]"); if (!b) return; setDMsg(null); loadForm(b.dataset.day); $("dDay").scrollIntoView({ behavior: "smooth", block: "center" }); });

// --- 8-week report for the doctor or physical therapist (printable) ---
$("dReport").addEventListener("click", async () => {
  const days = 56, st = diaryStats(days), rr = await recentRisks();
  const name = cloudReady() ? (cloud.dancers.find(d => d.id === cloud.dancerId) || {}).name : "";
  const top = Object.entries(st.areaCount).sort((a, b) => b[1] - a[1]);
  let h = `<div class="rp-bar no-print"><button id="rpBack">${esc(t("rpBack"))}</button><button class="primary" id="rpPrint">${esc(t("rpPrint"))}</button></div>`;
  h += `<article class="rp"><h1>${esc(t("drTitle"))}</h1><p class="sub">${name ? esc(name) + " · " : ""}${esc(fDate(parseDay(st.since)))} – ${esc(fDate(new Date()))}</p>`;
  h += `<h2>${esc(t("drSummary"))}</h2><ul class="ins">${insightsHTML(st)}</ul>`;
  if (top.length) h += `<p class="note-sm">${esc(t("drAllAreas"))}: ${esc(top.map(([a, n]) => `${t("area_" + a)} ${n}`).join(" · "))}</p>`;
  h += `<h2>${esc(t("drCalendar"))}</h2>${calHTML(days, true)}<div class="cal-legend">${[0, 1, 2, 3, 4, 5].map(l => `<span><i style="background:${PAIN_COL[l]}"></i>${esc(l + " " + t("pain" + l))}</span>`).join("")}<span>★ ${esc(t("act_rehearsal"))}</span></div>`;
  h += `<h2>${esc(t("dRisk"))}</h2>${rr.notes.length ? riskHTML(rr.notes) : `<p class="note-sm">${esc(t(rr.enough ? "riskNone" : "riskNotEnough"))}</p>`}`;
  h += `<h2>${esc(t("drEntries"))}</h2><div class="tbl-wrap"><table class="dtable"><tr><th>${esc(t("dDate"))}</th><th>${esc(t("drPain"))}</th><th>${esc(t("dWhereQ"))}</th><th>${esc(t("dActQ"))}</th><th>${esc(t("drNote"))}</th></tr>`;
  for (const e of st.recent) h += `<tr><td>${esc(e.day)}</td><td><span class="pdot" style="background:${PAIN_COL[e.pain]}"></span>${e.pain}</td><td>${esc(e.areas.map(a => t("area_" + a)).join(", "))}</td><td>${esc(e.acts.map(a => t("act_" + a)).join(", "))}</td><td>${esc(e.note || "")}</td></tr>`;
  h += `</table></div><div class="rp-foot">${esc(t("drFoot"))} · ${esc(t("generated", new Date().toLocaleString(locale())))}</div></article>`;
  $("report").innerHTML = h;
  document.body.classList.add("show-report"); window.scrollTo(0, 0);
  $("rpBack").addEventListener("click", () => document.body.classList.remove("show-report"));
  $("rpPrint").addEventListener("click", () => window.print());
});
