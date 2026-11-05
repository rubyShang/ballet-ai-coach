"use strict";
// ---------- Learn page (shared engine) ----------
// Each move supplies move.learn = {
//   title, intro (i18n keys), tabs: [...], tabLabel(tab), badge(tab) → i18n key, track: [phase codes],
//   frame(tab, sec) → { svg, ph, caption }   one animation frame (sec = seconds since the animation started)
//   paused(tab)      → { svg, ph, caption }   the still picture shown when the animation is paused
//   tips(tab) → [i18n keys], steps(tab) → [{ svg, text }], mistakes(tab) → [{ bad, good, badText, goodText }] }
// Drawings are computed SVG (an original cartoon dancer), shared helpers live here.

const FL = 238, FOOT = 26;                                       // floor line and foot length in the drawings
const rad = a => a * Math.PI / 180;
const r1 = v => Math.round(v * 10) / 10;
const ease = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
// one stretch of an animation: between a and b seconds, go from → to (eased); null outside
const span = (tt, a, b, from, to, st) => tt >= a && tt < b ? [from + (to - from) * ease((tt - a) / (b - a)), st] : null;
function arrowSVG(x1, x2, y, color){
  const dir = Math.sign(x2 - x1) || 1;
  return `<path d="M${r1(x1)} ${y} L${r1(x2 - dir * 6)} ${y}" stroke="${color}" stroke-width="3" stroke-linecap="round"/>` +
         `<path d="M${r1(x2)} ${y} L${r1(x2 - dir * 9)} ${y - 6} L${r1(x2 - dir * 9)} ${y + 6} Z" fill="${color}"/>`;
}
function vArrowSVG(x, y1, y2, color = "#cf3577"){
  const dir = Math.sign(y2 - y1) || 1;
  return `<path d="M${r1(x)} ${r1(y1)} L${r1(x)} ${r1(y2 - dir * 6)}" stroke="${color}" stroke-width="3" stroke-linecap="round"/>` +
         `<path d="M${r1(x)} ${r1(y2)} L${r1(x - 6)} ${r1(y2 - dir * 9)} L${r1(x + 6)} ${r1(y2 - dir * 9)} Z" fill="${color}"/>`;
}
// dashed ring around the body part in question + a ✓ / ✗ badge in the corner
function markSVG(kind, c, vb, r = 17){
  const col = kind === "bad" ? "#dc3550" : "#239063", bx = vb[0] + 16, by = vb[1] + 16;
  return `<circle cx="${r1(c.x)}" cy="${r1(c.y)}" r="${r}" fill="none" stroke="${col}" stroke-width="2.5" stroke-dasharray="5 4"/>` +
         `<circle cx="${bx}" cy="${by}" r="14" fill="${col}"/><text x="${bx}" y="${by + 6}" text-anchor="middle" font-size="16" font-weight="700" fill="#fff">${kind === "bad" ? "✗" : "✓"}</text>`;
}
const legPath = (a, b, c) => `<path d="M${r1(a.x)} ${r1(a.y)} L${r1(b.x)} ${r1(b.y)} L${r1(c.x)} ${r1(c.y)}" stroke="#ffd2df" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
const floorSVG = () => `<ellipse cx="120" cy="${FL + 5}" rx="84" ry="6" fill="#fdeaf2"/>`;
// a captioned frame of the animation; ph = phase code to light up in the track (null = none)
const caption = (stageKey, ph) => t(stageKey) + (ph == null ? "" : " · " + t(PHASES[ph][0]));

// --- page state ---
const learnTab = {};                                             // selected tab per move
let animOn = !matchMedia("(prefers-reduced-motion: reduce)").matches, animT0 = performance.now(), animRaf = 0, animLast = 0;
function curTab(){
  const L = M_().learn, cur = learnTab[mod];
  return L.tabs.includes(cur) ? cur : L.tabs[0];
}
function drawAnim(sec){
  const L = M_().learn, tab = curTab();
  const f = sec == null ? L.paused(tab) : L.frame(tab, sec);
  $("animStage").innerHTML = f.svg;
  $("phaseTrack").querySelectorAll("span").forEach(sp => sp.classList.toggle("on", f.ph != null && +sp.dataset.ph === f.ph));
  $("animCaption").textContent = f.caption;
}
function animLoop(now){
  if (!document.body.classList.contains("view-learn") || !animOn){ animRaf = 0; return; }
  if (now - animLast > 33){ animLast = now; drawAnim((now - animT0) / 1000); }
  animRaf = requestAnimationFrame(animLoop);
}
function startAnim(){ if (animOn && !animRaf) animRaf = requestAnimationFrame(animLoop); }
$("animToggle").addEventListener("click", () => {
  animOn = !animOn;
  if (animOn){ animT0 = performance.now(); startAnim(); } else drawAnim(null);
  $("animToggle").textContent = t(animOn ? "lPause" : "lPlay");
});

function renderLearn(){
  const L = M_().learn, tab = curTab();
  $("learnTitle").textContent = t(L.title);
  $("learnIntro").textContent = t(L.intro);
  $("dirTabs").innerHTML = L.tabs.map(d => `<button role="tab" data-dir="${d}" aria-selected="${d === tab}">${esc(L.tabLabel(d))}</button>`).join("");
  $("viewBadge").textContent = t(L.badge(tab));
  $("phaseTrack").innerHTML = L.track.map(p => `<span data-ph="${p}" style="--c:var(${PHASES[p][1]})">${esc(t(PHASES[p][0]))}</span>`).join("");
  $("animToggle").textContent = t(animOn ? "lPause" : "lPlay");
  drawAnim(animOn ? (performance.now() - animT0) / 1000 : null);
  $("tipsList").innerHTML = L.tips(tab).map(k => `<li>${esc(t(k))}</li>`).join("");
  $("stepsRow").innerHTML = L.steps(tab).map((s, i) => `<div class="step">${s.svg}<span class="n">${i + 1}</span><p>${esc(s.text)}</p></div>`).join("");
  const ms = L.mistakes(tab);
  $("mistakesGrid").style.setProperty("--cols", ms.length === 4 ? 2 : 3);
  $("mistakesGrid").innerHTML = ms.map(m => `<div class="mistake">
      <figure>${m.bad}<figcaption class="bad">${esc(m.badText)}</figcaption></figure>
      <figure>${m.good}<figcaption class="good">${esc(m.goodText)}</figcaption></figure>
    </div>`).join("");
}
$("dirTabs").addEventListener("click", e => {
  const b = e.target.closest("button[data-dir]"); if (!b) return;
  learnTab[mod] = b.dataset.dir;
  animT0 = performance.now(); renderLearn();
});
