"use strict";
// ---------- move picker (Learn and Practice) ----------
// One chip per registered move, with a tiny picture of the move; scrolls sideways on phones.
function renderMoveBar(){
  $("moveBar").innerHTML = MOVE_ORDER.map(id =>
    `<button type="button" data-m="${id}" aria-pressed="${id === mod}"><span class="thumb" aria-hidden="true">${MOVES[id].thumb()}</span><span>${esc(t("mod_" + id))}</span></button>`).join("");
}
$("moveBar").addEventListener("click", e => { const b = e.target.closest("[data-m]"); if (b) setModule(b.dataset.m); });

// texts and pictures on the Practice page that depend on the move
function applyMoveText(){
  const M = M_();
  $("legend").innerHTML = M.legend.map(([c, k]) => `<span style="--c:${c.startsWith("--") ? `var(${c})` : c}">${esc(t(k))}</span>`).join("");
  $("tipsListP").innerHTML = M.tips.map(k => `<li>${esc(t(k))}</li>`).join("");
  $("repEmpty").textContent = t(M.repEmpty);
  $("moveBar").querySelectorAll("[data-m]").forEach(b => { b.setAttribute("aria-pressed", String(b.dataset.m === mod)); b.lastElementChild.textContent = t("mod_" + b.dataset.m); });
}

// ---------- switching between moves ----------
function setModule(m, force){
  if (!MOVES[m]) m = "tendu";
  if (m === mod && !force) return;
  if (reps.length) newSession();                          // a session holds one move
  resetTracking(); lastRep = null; lastDir = undefined;
  mod = m; LIVE = MOVES[m].live; REP = MOVES[m].rep;
  lsSet("ballet-module", m);
  document.body.dataset.mod = m;
  $("liveChecks").innerHTML = ""; $("repChecks").innerHTML = "";
  liveEls = buildList($("liveChecks"), LIVE, true); repEls = buildList($("repChecks"), REP, false);
  $("repEmpty").hidden = false; $("repBody").hidden = true; $("repTitle").textContent = "";
  $("dirChip").querySelector("span").textContent = "—";
  if (!force){ applyLang(); loadHistoryList(); }
  if (document.body.classList.contains("view-learn")){ animT0 = performance.now(); renderLearn(); }
  const chip = $("moveBar").querySelector(`[data-m="${m}"]`);
  if (chip && chip.scrollIntoView) chip.scrollIntoView({ block: "nearest", inline: "nearest" });
}

// ---------- tabs: Learn / Practice / Diary / Me ----------
const VIEWS_ALL = ["learn", "practice", "diary", "me"];
function setView(v){
  if (!VIEWS_ALL.includes(v)) v = "learn";
  for (const x of VIEWS_ALL) document.body.classList.toggle("view-" + x, x === v);
  if (v !== "practice" && running) stopSource();
  document.querySelectorAll(".tabs button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.view === v)));
  lsSet("ballet-view", v);
  if (v === "diary") renderDiary();
  if (v === "learn"){ renderLearn(); startAnim(); }
  if (v === "me") loadHistoryList();
  window.scrollTo(0, 0);
}
document.querySelectorAll(".tabs button").forEach(b => b.addEventListener("click", () => setView(b.dataset.view)));
$("goPractice").addEventListener("click", () => setView("practice"));

// ---------- start ----------
$("meLocal").hidden = cloud.enabled;
renderMoveBar();
setModule(lsGet("ballet-module") || "tendu", true);
applyLang();
setView(lsGet("ballet-view") || "learn");
cloudInit();
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
