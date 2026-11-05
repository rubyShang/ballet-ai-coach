"use strict";
// ---------- report ----------
const locale = () => lang === "zh" ? "zh-CN" : "en-US";
const fTime = ts => new Date(ts).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
const fDate = ts => new Date(ts).toLocaleDateString(locale(), { year: "numeric", month: "long", day: "numeric" });
const fShort = ts => new Date(ts).toLocaleDateString(locale(), { month: "numeric", day: "numeric" });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));

// ctx = { reps, sid, start, hist, cloud }; without ctx the current session is reported
let reportCtx = null;
async function openReport(ctx){
  if (!ctx){
    if (!reps.length){ setStatus("noRepsForReport"); return; }
    saveHistory();
    const useCloud = cloudReady() && sessionDancer === cloud.dancerId;
    ctx = { reps, module: mod, sid: sessionId, start: sessionStart || reps[0].at, cloud: useCloud,
            hist: useCloud ? await cloudHistory() : loadHistory().filter(h => (h.module || "tendu") === mod) };
  }
  reportCtx = ctx;
  renderReport(ctx);
  document.body.classList.add("show-report");
  window.scrollTo(0, 0);
}
$("reportBtn").addEventListener("click", () => openReport());

function trendSVG(hs, sid){
  const Wd = 640, Ht = 220, L = 44, R = 24, T = 18, B = 34, iw = Wd - L - R, ih = Ht - T - B;
  const x = i => L + (hs.length === 1 ? iw / 2 : i * iw / (hs.length - 1));
  const y = v => T + (1 - v) * ih;
  let s = `<svg viewBox="0 0 ${Wd} ${Ht}" role="img" aria-label="${esc(t("trendChart"))}">`;
  for (const g of [0, 0.5, 1]){
    s += `<line x1="${L}" x2="${Wd - R}" y1="${y(g)}" y2="${y(g)}" style="stroke:var(--line)" stroke-width="1"/>`;
    s += `<text x="${L - 8}" y="${y(g) + 4}" text-anchor="end" font-size="11" style="fill:var(--muted)">${g * 100}%</text>`;
  }
  const rate = h => h.total ? h.good / h.total : 0;
  s += `<path d="${hs.map((h, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(rate(h)).toFixed(1)).join(" ")}" fill="none" style="stroke:var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  const every = hs.length > 8 ? 2 : 1;
  hs.forEach((h, i) => {
    const cur = h.id === sid;
    s += `<circle cx="${x(i)}" cy="${y(rate(h))}" r="${cur ? 5 : 4}" style="fill:var(--accent);stroke:var(--surface)" stroke-width="2"><title>${esc(fDate(h.start))}: ${Math.round(rate(h) * 100)}% (${h.good}/${h.total})</title></circle>`;
    if (i % every === 0 || i === hs.length - 1)
      s += `<text x="${x(i)}" y="${Ht - 10}" text-anchor="middle" font-size="11" style="fill:var(--muted)">${esc(cur ? t("thisSession") : fShort(h.start))}</text>`;
  });
  const li = hs.length - 1;
  s += `<text x="${x(li)}" y="${y(rate(hs[li])) - 10}" text-anchor="middle" font-size="12" font-weight="600" style="fill:var(--fg)">${Math.round(rate(hs[li]) * 100)}%</text>`;
  return s + "</svg>";
}

function renderReport(ctx = reportCtx){
  if (!ctx) return;
  const reps = ctx.reps, sessionId = ctx.sid, sessionStart = ctx.start;
  const n = reps.length, good = reps.filter(r => !r.errors.length).length;
  const P = v => Math.round(v * 100) + "%";
  const start = sessionStart || reps[0].at, end = reps[n - 1].at;
  const lc = reps.filter(r => r.side === "left").length;
  const M = MOVES[ctx.module] ? ctx.module : "tendu", MV = MOVES[M], dirName = d => dirLabel(d, M);
  let h = `<div class="rp-bar no-print"><button id="rpBack">${esc(t("rpBack"))}</button><button class="primary" id="rpPrint">${esc(t("rpPrint"))}</button></div>`;
  h += `<article class="rp"><h1>${esc(t(MV.reportTitle))}</h1>`;
  h += `<p class="sub">${esc(fDate(start))} · ${esc(fTime(start))}–${esc(fTime(end))} · ${esc(t("minutes", Math.max(1, Math.round((end - start) / 60000))))} ${MV.oneLeg ? "· " + esc(t("legsLine", lc, n - lc)) : ""}</p>`;

  // 1. summary
  h += `<h2>${esc(t("rpSummary"))}</h2><div class="rp-tiles">`;
  h += `<div class="tile"><div class="k">${esc(t("tTotal"))}</div><div class="v">${n}</div></div>`;
  h += `<div class="tile"><div class="k">${esc(t("tGood"))}</div><div class="v">${good}<small>${P(good / n)}</small></div></div>`;
  for (const d of MV.dirs){
    const rs = reps.filter(r => r.dir === d);
    if (!rs.length) continue;
    const g = rs.filter(r => !r.errors.length).length;
    h += `<div class="tile"><div class="k">${esc(dirLabel(d))}</div><div class="v">${P(g / rs.length)}<small>${esc(t("dirTile", rs.length, g))}</small></div></div>`;
  }
  h += `</div>`;

  // 2. what to work on
  const stats = rateKeys(M).map(k => {
    const meas = reps.filter(r => r.measured.includes(k)).length;
    const fails = reps.filter(r => r.errors.includes(k)).length;
    return { k, meas, fails, rate: meas ? (meas - fails) / meas : null };
  });
  const top = stats.filter(s => s.fails > 0).sort((a, b) => b.fails / b.meas - a.fails / a.meas).slice(0, 3);
  h += `<h2>${esc(t("rpFocus"))}</h2>`;
  if (!top.length) h += `<div class="good-msg">✓ ${esc(t("rpAllGood"))}</div>`;
  else {
    h += `<div class="focus">`;
    for (const s of top) h += `<div class="item"><b>${esc(t("n_" + s.k))}</b><span class="cnt">${esc(t("failCount", s.fails, s.meas, P(s.fails / s.meas)))}</span><p>${esc(t("t_" + s.k))}</p></div>`;
    h += `</div>`;
  }

  // injury-risk patterns in this session
  const statMap = {}; stats.forEach(x => statMap[x.k] = { fail: x.fails, meas: x.meas });
  const risks = riskNotes(k => statMap[k]);
  if (risks.length) h += `<h2>${esc(t("dRisk"))}</h2>${riskHTML(risks)}<p class="note-sm">${esc(t("dRiskNote"))}</p>`;

  // 3. pass rate per check
  h += `<h2>${esc(t("rpRates"))}</h2><div class="rates">`;
  for (const s of stats){
    const low = s.rate != null && s.rate < 0.7;
    h += `<div>${esc(t("n_" + s.k))}</div><div class="bar"><span style="width:${s.rate == null ? 0 : s.rate * 100}%"></span></div>`;
    h += `<div class="pct${low ? " low" : ""}">${s.rate == null ? esc(t("notMeasured")) : P(s.rate) + (low ? " · " + esc(t("needWork")) : "")}</div>`;
  }
  h += `</div>`;

  // 4. long-term trend
  const hist = ctx.hist || [];
  h += `<h2>${esc(t("rpTrend"))}</h2><div class="trend">`;
  if (hist.length < 2) h += `<p class="note-sm">${esc(t("trendNeedMore"))}</p>`;
  else {
    const hs = hist.slice(-12);
    h += `<p class="cap">${esc(t("trendChart"))}</p>${trendSVG(hs, sessionId)}`;
    const cols = hist.slice(-8);
    h += `<div class="heat-wrap"><p class="cap">${esc(t("trendTable"))}</p><table class="heat"><tr><th></th>`;
    for (const c of cols) h += `<th>${esc(c.id === sessionId ? t("thisSession") : fShort(c.start))}</th>`;
    h += `</tr>`;
    for (const k of rateKeys(M)){
      h += `<tr><td>${esc(t("n_" + k))}</td>`;
      for (const c of cols){
        const m = (c.meas || {})[k] || 0, f = (c.fails || {})[k] || 0;
        if (!m){ h += `<td style="color:var(--muted)">—</td>`; continue; }
        const r = (m - f) / m;
        h += `<td style="background:color-mix(in srgb, var(--accent) ${Math.round(8 + r * 50)}%, var(--surface))">${P(r)}</td>`;
      }
      h += `</tr>`;
    }
    h += `</table></div>`;
  }
  h += ctx.cloud ? `<p class="note-sm">${esc(t("cloudHistoryNote"))}</p></div>`
                 : `<p class="note-sm">${esc(t("historyNote"))} <button class="no-print" id="rpClear" style="padding:2px 8px;font-size:12px">${esc(t("clearHistory"))}</button></p></div>`;

  // 5. every tendu with keyframes
  const CAP = 40, shown = reps.slice(-CAP);
  h += `<h2>${esc(t("rpDetail"))}</h2>`;
  if (n > CAP) h += `<p class="note-sm">${esc(t("detailCap", CAP))}</p>`;
  shown.forEach((r, i) => {
    const ok = !r.errors.length;
    h += `<div class="rp-rep"><div class="hd"><span>${esc(t("repHead", r.n, dirName(r.dir), t(r.side), fTime(r.at)))}</span>`;
    h += `<span class="${ok ? "ok" : "bad"}">${ok ? "✓ " + esc(t("allPassed")) : "✗ " + r.errors.length}</span></div>`;
    if (r.snaps.start || r.snaps.far || r.snaps.close){
      h += `<div class="snaps">`;
      for (const [key, cap] of MV.snaps)
        h += `<figure>${r.snaps[key] ? `<img src="${r.snaps[key]}" alt="${esc(t(cap))}">` : ""}<figcaption>${esc(t(cap))}</figcaption></figure>`;
      h += `</div>`;
    }
    h += `<div class="timeline" data-rep="${shown.length - 1 - i}"></div>`;
    if (!ok){
      h += `<ul>`;
      for (const k of r.errors) h += `<li>${esc(t("n_" + k))}${r.R[k] ? `<span class="v">${esc(fmt(r.R[k])[1])}</span>` : ""}</li>`;
      h += `</ul>`;
    }
    h += `</div>`;
  });
  h += `<div class="rp-foot">${esc(t("generated", new Date().toLocaleString(locale())))} · ${esc(t("title"))}</div></article>`;

  const el = $("report"); el.innerHTML = h;
  el.querySelectorAll(".timeline[data-rep]").forEach(tl => { const r = shown[shown.length - 1 - +tl.dataset.rep]; fillTimeline(tl, r.segs, r.peak); });
  $("rpBack").addEventListener("click", () => document.body.classList.remove("show-report"));
  $("rpPrint").addEventListener("click", () => window.print());
  if ($("rpClear")) $("rpClear").addEventListener("click", () => {
    if (!confirm(t("confirmClear"))) return;
    try { localStorage.removeItem(HKEY); } catch {}
    saveHistory(); ctx.hist = loadHistory(); renderReport(ctx);
  });
}
