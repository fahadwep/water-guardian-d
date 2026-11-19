/* Water Guardian site: the shell and every page except the live shift (shift.js). No build step, no libraries.
   Every number on the Story, Evidence and Value pages is from docs/approved_numbers.md (words in i18n.js), or from the
   server (/api/config: the ten L-Town years and the calculator's inputs). The Bristol page only displays the frozen test
   BR1 (bristol_data.js); the feed page only displays what live/nightly.py wrote. */
"use strict";
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (n, d = 0) => Number(n).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let LANG = new URLSearchParams(location.search).get("lang") || (() => { try { return localStorage.getItem("wg_lang"); } catch (e) { return null; } })() || "en";
if (LANG !== "ar") LANG = "en";
function t(k, v) {
  const e = T[k]; if (e === undefined) return k;
  let s = e[LANG === "ar" ? 1 : 0];
  if (typeof s === "string" && v) for (const [a, b] of Object.entries(v)) s = s.split("{" + a + "}").join(b);
  return s;
}
async function api(path, body) {
  if (window.WGS) return window.WGS.api(path, body ? Object.assign({ lang: LANG }, body) : null);   // static build: files and the engine in the browser
  const r = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ lang: LANG }, body)) } : { cache: "no-store" });
  const j = await r.json().catch(() => ({ error: "bad reply" }));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
let CFG = { towns: [], main: [], years: [], ltown_years: [], econ: null };
const SAR = 5.3;                                     // SAR per m3: production + transmission (approved numbers, claim 9)
const REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* A canvas sized to its box, cleared, with a left-to-right drawing context (maps are geography: never mirrored). */
function canvasCtx(c) {
  const r = c.getBoundingClientRect(), d = window.devicePixelRatio || 1, W = Math.round(r.width * d), H = Math.round(r.height * d);
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const x = c.getContext("2d"); x.direction = "ltr"; x.setTransform(d, 0, 0, d, 0, 0); x.clearRect(0, 0, r.width, r.height);
  return [x, r.width, r.height];
}
/* Fit a box of model coordinates (a, b)-(c, d) into w x h pixels with padding; returns the point mapper and the scale. */
function fitBox(a, b, c, d, w, h, pad) {
  const p = Array.isArray(pad) ? pad : [pad, pad, pad, pad], s = Math.min((w - p[1] - p[3]) / Math.max(c - a, 1), (h - p[0] - p[2]) / Math.max(d - b, 1));
  const ox = p[3] + (w - p[1] - p[3] - (c - a) * s) / 2, oy = p[2] + (h - p[0] - p[2] - (d - b) * s) / 2;
  return { s, P: (u, v) => [ox + (u - a) * s, h - oy - (v - b) * s], inv: (px, py) => [a + (px - ox) / s, b + (h - oy - py) / s] };
}
function pipeBox(pipes) { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const p of pipes) { a = Math.min(a, p[0], p[2]); c = Math.max(c, p[0], p[2]); b = Math.min(b, p[1], p[3]); d = Math.max(d, p[1], p[3]); } return [a, b, c, d]; }
function diamond(x, u, v, r, fill, stroke) { x.fillStyle = fill; x.strokeStyle = stroke || "#fff"; x.lineWidth = 1.6; x.beginPath(); x.moveTo(u, v - r); x.lineTo(u + r, v); x.lineTo(u, v + r); x.lineTo(u - r, v); x.closePath(); x.fill(); x.stroke(); }

/* ---------------- the pair of bars: Guardian beside chance ---------------- */
const TAGS = { clear: ["tag_clear", "ok"], unclear: ["tag_unclear", "dim"], chance: ["tag_chance", "bad"], weak: ["tag_weak", "dim"], ns: ["tag_ns", "dim"] };
function pair(label, sub, g, c, max, gt, ct, tag, fewer, ck) {
  const tg = TAGS[tag];
  return `<div class="pair"><div class="pl"><b>${label}</b>${sub ? `<small>${sub}</small>` : ""}${tg ? `<span class="tag ${tg[1]}">${t(tg[0])}</span>` : ""}${fewer ? ` <span class="tag dim">${t("k_fewer")}</span>` : ""}</div>
    <div class="pb"><div class="bar"><div class="tr"><i style="width:${Math.min(100, g / max * 100)}%"></i></div><b dir="ltr">${gt}</b></div>
    <div class="bar c"><div class="tr"><i style="width:${Math.min(100, c / max * 100)}%"></i></div><b><span dir="ltr">${ct}</span><small>${ck || t("k_c_short")}</small></b></div></div></div>`;
}
const keyRow = () => `<div class="key"><span><i></i>${t("k_g")}</span><span><i class="c"></i>${t("k_c")}</span></div>`;

/* ---------------- Story ---------------- */
const HOW_SVG = [
  `<svg viewBox="0 0 200 74"><g fill="none" stroke="#A9B5BF" stroke-width="2" stroke-dasharray="4 3"><path d="M22 20h70v36H22zM92 20h50l30 18-30 18H92"/></g><g fill="none" stroke="#1463D6" stroke-width="2.5"><path d="M14 14h70v36H14zM84 14h50l30 18-30 18H84"/></g><g fill="#1463D6"><circle cx="14" cy="14" r="4"/><circle cx="84" cy="50" r="4"/><circle cx="164" cy="32" r="4"/></g></svg>`,
  `<svg viewBox="0 0 200 74"><path d="M8 26H86C120 26 130 58 192 60V26z" fill="#FCEAE4"/><path d="M8 26h184" stroke="#A9B5BF" stroke-width="2" stroke-dasharray="5 4" fill="none"/><path d="M8 26H86C120 26 130 58 192 60" stroke="#E2532B" stroke-width="3" fill="none"/><circle cx="192" cy="60" r="4" fill="#E2532B"/></svg>`,
  `<svg viewBox="0 0 200 74"><g fill="none" stroke="#C3CED8" stroke-width="2"><path d="M10 14h180M10 38h180M10 62h180M40 6v62M100 6v62M160 6v62"/></g><circle cx="100" cy="38" r="27" fill="#FCEAE4" fill-opacity=".7" stroke="#E2532B" stroke-width="2" stroke-dasharray="5 4"/><circle cx="100" cy="38" r="9" fill="#E2532B"/><text x="100" y="42" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">1</text></svg>`,
  `<svg viewBox="0 0 200 74"><path d="M10 38h180" stroke="#C3CED8" stroke-width="3"/><path d="M118 38h34" stroke="#17865B" stroke-width="7" stroke-linecap="round"/><g fill="#fff" stroke="#0D2231" stroke-width="2"><rect x="24" y="31" width="14" height="14" rx="2"/><rect x="62" y="31" width="14" height="14" rx="2"/><rect x="170" y="31" width="14" height="14" rx="2"/></g><rect x="100" y="31" width="14" height="14" rx="2" fill="#17865B" stroke="#17865B" stroke-width="2"/><g fill="none" stroke="#17865B" stroke-width="1.5"><path d="M94 22a18 18 0 0 1 26 0M88 14a28 28 0 0 1 38 0"/></g></svg>`];
const SCENE = `<svg viewBox="0 0 560 360" role="img">
  <rect width="560" height="160" fill="#E9F0F5"/><circle cx="476" cy="52" r="24" fill="#F7D774"/>
  <g fill="#fff" stroke="#C3CED8" stroke-width="1.5"><rect x="36" y="78" width="96" height="82"/><rect x="166" y="54" width="110" height="106"/><rect x="316" y="92" width="88" height="68"/><rect x="430" y="70" width="100" height="90"/></g>
  <g fill="#B7C5D1"><rect x="54" y="62" width="30" height="16" rx="3"/><rect x="190" y="38" width="34" height="16" rx="3"/><rect x="232" y="38" width="30" height="16" rx="3"/><rect x="338" y="76" width="30" height="16" rx="3"/><rect x="456" y="54" width="34" height="16" rx="3"/></g>
  <g fill="#D8E2EA"><rect x="52" y="98" width="20" height="24"/><rect x="92" y="98" width="20" height="24"/><rect x="184" y="76" width="22" height="26"/><rect x="232" y="76" width="22" height="26"/><rect x="184" y="118" width="22" height="26"/><rect x="232" y="118" width="22" height="26"/><rect x="334" y="110" width="20" height="24"/><rect x="368" y="110" width="20" height="24"/><rect x="448" y="92" width="22" height="26"/><rect x="490" y="92" width="22" height="26"/></g>
  <rect y="160" width="560" height="16" fill="#55626E"/><path d="M0 168h560" stroke="#F2F5F7" stroke-width="2" stroke-dasharray="18 14"/>
  <rect y="176" width="560" height="184" fill="#3B4854"/><rect y="176" width="560" height="44" fill="#465460"/>
  <ellipse id="sc_wet" cx="330" cy="262" rx="8" ry="6" fill="#1463D6" fill-opacity=".55"/>
  <rect y="250" width="560" height="24" fill="#9FB3C4"/><rect y="250" width="560" height="6" fill="#C9D6E0"/>
  <g fill="#7F95A8"><rect x="120" y="246" width="8" height="32"/><rect x="330" y="246" width="8" height="32"/><rect x="480" y="246" width="8" height="32"/></g>
  <g fill="#6FA8F5" class="drops"><circle cx="336" cy="282" r="3"/><circle cx="326" cy="290" r="2.5"/><circle cx="344" cy="296" r="2.5"/></g>
</svg>`;
let sceneTimer = null;
function renderStory() {
  const p = t("st_p"), how = t("st_how"), res = t("st_res"), ws = t("st_watch_steps"), cls = ["t", "", "w", "w", "", "g", "t"];
  const R = [[73, 52, 100, "73%", "52%", "clear"], [51, 37, 100, "51%", "37%", "clear"], [88, 82, 100, "88%", "82%", "clear"], [63.6, 1.7, 100, "7 " + t("of") + " 11", "1.7%", "", t("k_rand_pt")], [16, 11, 21, "16 " + t("of") + " 21", "11", "ns"]];
  $("p-story").innerHTML = `
  <div class="hero">
    <div class="txt"><div class="eyebrow">${t("st_eye")}</div><h1 class="h1">${t("st_h1")}</h1><p class="lead">${t("st_lead")}</p>
      <div class="row"><a class="btn pri big" href="#/shift?auto=1">▶ ${t("st_cta1")}</a><a class="btn big" href="#/evidence">${t("st_cta2")}</a></div></div>
    <div class="scene">${SCENE}<div class="dayn" id="sc_day"></div><div class="cap">${t("st_scene_cap")}</div><div class="line" id="sc_line"></div></div>
  </div>
  <h2 class="h2">${t("st_p_h")}</h2>
  <div class="facts">${p.map((x, i) => `<div class="fact"><div class="v">${x[0]}</div><p>${x[1]}</p>${i === 1 ? `<div class="dots7"><i class="f"></i><i></i><i></i><i></i><i></i><i></i><i></i></div><div class="dots7"><i class="f"></i>${t("st_p_dots")[0]} <i></i>${t("st_p_dots")[1]}</div>` : ""}<small>${x[2]}</small></div>`).join("")}</div>
  <div class="sheet"><h2 class="h2">${t("st_how_h")}</h2>
    <div class="how">${how.map((x, i) => `<div>${HOW_SVG[i]}<b>${x[0]}</b><span>${x[1]}</span></div>`).join("")}</div>
    <p class="fine" style="margin-top:16px">${t("st_how_note")}</p></div>
  <div class="sheet watch"><h2 class="h2">${t("st_watch_h")}</h2><p class="lead">${t("st_watch_p")}</p>
    <ol class="strip">${ws.map((x, i) => `<li class="${cls[i]}">${x}</li>`).join("")}</ol>
    <div class="row"><a class="btn pri big" href="#/shift?auto=1">▶ ${t("st_watch_auto")}</a><a class="btn big" href="#/shift">${t("st_watch_btn")}</a></div>
    <p class="fine">${t("st_watch_note")}</p>
    <div class="more3">${t("st_watch_more").map(x => `<a href="#/${x[2]}"><b>${x[0]}</b><span>${x[1]}</span></a>`).join("")}</div></div>
  <div class="sheet"><div class="ghead"><h2 class="h2">${t("st_res_h")}</h2><p class="sub">${t("st_res_p")}</p>${keyRow()}</div>
    <div class="pairs">${res.map((x, i) => pair(x[0], x[1], R[i][0], R[i][1], R[i][2], R[i][3], R[i][4], R[i][5], false, R[i][6])).join("")}</div></div>
  <div class="two">
    <div class="sheet weaksheet"><h2 class="h2" style="margin-bottom:14px">${t("st_lim_h")}</h2><ul class="plain">${t("st_lim").map(x => `<li><b>${x[0]}</b> ${x[1]}</li>`).join("")}</ul>
      <a class="btn" style="margin-top:16px" href="#/evidence">${t("st_res_btn")}</a></div>
    <div class="sheet ask"><h2 class="h2">${t("st_ask_h")}</h2><p>${t("st_ask_p")}</p></div>
  </div>`;
  clearInterval(sceneTimer); let d = REDUCED ? 23 : 1, hold = 0;
  const paint = () => { const w = $("sc_wet"); if (!w) { clearInterval(sceneTimer); return; }
    $("sc_day").textContent = t("st_day", { n: d }); w.setAttribute("rx", 8 + d * 3.1); w.setAttribute("ry", 6 + d * 1.5); w.setAttribute("cy", 262 + d * 0.9);
    $("sc_line").textContent = t("st_scene")[d < 5 ? 0 : d < 17 ? 1 : 2]; };
  paint();
  if (!REDUCED) sceneTimer = setInterval(() => { if (location.hash.replace(/^#\/?/, "").split("?")[0] !== "") return; if (d >= 28) { if (++hold < 8) return; hold = 0; d = 0; } d++; paint(); }, 330);
}

/* ---------------- Evidence ---------------- */
function renderEvidence() {
  const Y = CFG.ltown_years || [], g1 = t("ev_g1"), g2 = t("ev_g2"), g3 = t("ev_g3"), g5 = t("ev_g5"), bk = t("ev_bk"), br = t("ev_br"), wx = t("ev_wx"), of = " " + t("of") + " ";
  const D1 = [[73, 52, 100, "73%", "52%", "clear"], [27.9, 49.8, 60, "27.9", "49.8", "clear", 1], [51, 37, 100, "51%", "37%", "clear"], [32, 11, 100, "32%", "11%", ""], [81, 56, 100, "81%", "56%", ""], [73, 65, 100, "73%", "65%", "weak"], [71.6, 68.1, 100, "71.6%", "68.1%", "unclear"]];
  const D2 = [[88, 82, 100, "88%", "82%", "clear"], [17.7, 23.4, 30, "17.7", "23.4", "", 1], [16, 24, 30, "16", "24", "unclear", 1], [59, 49, 100, "59%", "49%", "unclear"]];
  const D3 = [[34, 17, 100, "34%", "17%", "clear"], [4.8, 7.0, 10, "4.8", "7.0", "clear", 1], [37, 73, 80, "37", "73", "", 1], [54, 56, 100, "54%", "56%", "chance"], [75, 72, 100, "75%", "72%", "chance"]];
  const rows = (L, D) => L.map((x, i) => pair(x[0], x[1], D[i][0], D[i][1], D[i][2], D[i][3], D[i][4], D[i][5], D[i][6])).join("");
  const S4 = [["59%", "43–45%", "tag_pass", "ok"], ["56%", "43–45%", "tag_pass", "ok"], ["55%", "43–45%", "tag_pass", "ok"], ["40%", "38%", "tag_atchance", "dim"], ["36%", "25%", "tag_fail", "bad"]];
  const G5 = [[11, 45], [34, 73], [65, 83], [44, 92], [65, 86]];
  $("p-evidence").innerHTML = `
  <div class="eyebrow">${t("ev_eye")}</div><h1 class="h1">${t("ev_h1")}</h1><p class="lead">${t("ev_lead")}</p>
  <div class="sheet"><h2 class="h2" style="margin-bottom:14px">${t("ev_proto_h")}</h2><div class="proto">${t("ev_proto").map((x, i) => `<div><b><i>${i + 1}</i>${x[0]}</b><span>${x[1]}</span></div>`).join("")}</div></div>
  <div class="sheet weaksheet"><h2 class="h2">${t("ev_weak_h")}</h2><ol class="weak">${t("ev_weak").map(x => `<li><b>${x[0]}</b> ${x[1]}</li>`).join("")}</ol></div>
  <div class="sheet"><div class="ghead"><h2 class="h2">${t("ev_g1_h")}</h2><p class="sub">${t("ev_g1_c")}</p>${keyRow()}</div><div class="pairs">${rows(g1, D1)}</div>
    <p class="lim">${t("ev_g1_lim")}</p>
    ${Y.length ? `<h3 style="font-size:15px;margin-top:20px">${t("ev_g1_years")}</h3><div class="ybars">${Y.map((y, i) => `<div><span>${y.pct.toFixed(0)}</span><i style="height:${y.pct}%"></i><small>${i + 1}</small></div>`).join("")}</div>` : ""}</div>
  <div class="sheet"><div class="ghead"><h2 class="h2">${t("ev_g2_h")}</h2><p class="sub">${t("ev_g2_c")}</p>${keyRow()}</div><div class="pairs">${rows(g2, D2)}</div><p class="lim">${t("ev_g2_lim")}</p></div>
  <div class="sheet"><div class="ghead"><h2 class="h2">${t("ev_g3_h")}</h2><p class="sub">${t("ev_g3_c")}</p>${keyRow()}</div><div class="pairs">${rows(g3, D3)}</div><p class="lim">${t("ev_g3_lim")}</p></div>
  <div class="sheet"><div class="ghead"><h2 class="h2">${t("ev_g4_h")}</h2><p class="sub">${t("ev_g4_c")}</p></div>
    <div class="scroll"><table class="tbl"><tr>${t("ev_g4_cols").map(c => `<th>${c}</th>`).join("")}</tr>${t("ev_g4").map((s, i) => `<tr><td>${s}</td><td><b>${S4[i][0]}</b></td><td>${S4[i][1]}</td><td><span class="tag ${S4[i][3]}">${t(S4[i][2])}</span></td></tr>`).join("")}</table></div>
    <p class="lim" style="margin-top:12px">${t("ev_g4_lim")}</p></div>
  <div class="sheet"><div class="ghead"><h2 class="h2">${t("ev_g5_h")}</h2><p class="sub">${t("ev_g5_c")}</p>
    <div class="key"><span><i class="c" style="width:12px;height:12px;border-radius:50%"></i>${t("ev_before")}</span><span><i style="width:12px;height:12px;border-radius:50%"></i>${t("ev_after")}</span></div></div>
    ${g5.map((x, i) => `<div class="db"><div class="l"><b>${x[0]}</b><small>${x[1]}</small></div><div class="tr"><i style="left:${G5[i][0]}%;width:${G5[i][1] - G5[i][0]}%"></i><u class="a" style="left:${G5[i][0]}%"><em>${G5[i][0]}%</em></u><u class="z" style="left:${G5[i][1]}%"><em>${G5[i][1]}%</em></u></div><div class="c">${x[2]}</div></div>`).join("")}</div>
  <div class="sheet"><div class="ghead"><h2 class="h2">${t("ev_crew_h")}</h2><p class="sub">${t("ev_crew_c")}</p></div>
    <div class="scroll"><table class="tbl"><tr>${t("ev_crew_cols").map(c => `<th>${c}</th>`).join("")}</tr>${t("ev_crew").map((r, i) => `<tr><td>${r[0]}</td><td><b>${r[1]}</b></td><td>${r[2]}</td><td><span class="tag ${i ? "bad" : "ok"}">${t(i ? "tag_fail" : "tag_pass")}</span></td></tr>`).join("")}</table></div>
    <p class="lim" style="margin-top:12px">${t("ev_crew_lim")}</p></div>
  <div class="sheet"><div class="ghead"><h2 class="h2">${t("ev_real_h")}</h2><p class="sub">${t("ev_real_c")}</p></div>
    <div class="real3">
      <div><h3>${t("ev_br_h")}</h3><div class="v" dir="auto">7${of}11<small>${br[0]}</small></div>
        <div class="pb"><div class="bar"><div class="tr"><i style="width:63.6%"></i></div><b dir="ltr">7/11</b></div><div class="bar c"><div class="tr"><i style="width:1.7%"></i></div><b><span dir="ltr">1.7%</span></b></div></div>
        <p>${br[1]}</p><a class="btn" href="#/bristol">${br[2]}</a></div>
      <div><h3>${t("ev_wx_h")}</h3><div class="v" dir="auto">16${of}21<small>${wx[0]}</small></div>
        <div class="pb"><div class="bar"><div class="tr"><i style="width:76.2%"></i></div><b dir="ltr">16</b></div><div class="bar c"><div class="tr"><i style="width:52.4%"></i></div><b><span dir="ltr">11</span><small>${t("k_c_short")}</small></b></div></div>
        <p>${wx[1]}</p><a class="btn" href="#/feed">${wx[2]}</a></div>
      <div><h3>${t("ev_bk_h")}</h3><div class="v" dir="auto">4${of}17<small>${bk[0]}</small></div>
        <div class="dots17">${Array.from({ length: 17 }, (_, i) => `<i class="${i < 4 ? "a" : i < 9 ? "b" : ""}"></i>`).join("")}</div>
        <div class="dkey"><span><i class="a"></i>${bk[2][0]}</span><span><i class="b"></i>${bk[2][1]}</span><span><i></i>${bk[2][2]}</span></div><p>${bk[1]}</p></div>
    </div></div>
  <h2 class="h2">${t("ev_fail_h")}</h2>
  <div class="two"><div class="sheet"><h3 style="margin-bottom:12px">${t("ev_drop_h")}</h3><ul class="plain">${t("ev_drop").map(x => `<li><b>${x[0]}</b> ${x[1]}</li>`).join("")}</ul></div>
    <div class="sheet"><h3 style="margin-bottom:12px">${t("ev_fix_h")}</h3><ul class="plain">${t("ev_fix").map(x => `<li><b>${x[0]}</b> ${x[1]}</li>`).join("")}</ul></div></div>`;
}

/* ---------------- Value: break-even (claim 18) and the calculator of engine/economics.py (same formula) ---------------- */
const V = { basis: 1, value: 5.3, km: 100, nrw: 35, real: 50, hidden: 50, lpk: 0.75, lprice: 6000, scr: 50, meters: false };
const KM = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 134700];
const SL = [["value", "v_g1", 1, 15, 0.1, x => x.toFixed(1) + " " + t("u_sarm3")], ["km", "v_g1", 0, KM.length - 1, 1, x => fmt(KM[x]) + " " + t("u_km")],
["nrw", "v_g2", 5, 60, 1, x => x + "%"], ["real", "v_g2", 20, 90, 5, x => x + "%"], ["hidden", "v_g2", 10, 90, 5, x => x + "%"],
["lpk", "v_g3", 0.2, 3, 0.05, x => x.toFixed(2)], ["lprice", "v_g3", 500, 20000, 500, x => fmt(x) + " " + t("u_sar")], ["scr", "v_g3", 0, 90, 5, x => x + "%"]];
function econ(value) {
  const s = CFG.econ.src, d = CFG.econ.det[{ 0: V.meters ? 1 : 0, 1: 2, 2: 3 }[V.basis]], km = V.km;
  const hidden = s.distributed_m3 * (V.nrw / 100) * (V.real / 100) * (V.hidden / 100) / s.network_km * km;
  const share = d.found * Math.max(0, 1 - (d.days + s.repair_days) / s.baseline_days), m3 = hidden * share, benefit = m3 * value;
  const nlog = V.lpk * km; let capex = nlog * V.lprice; if (V.meters && V.basis === 0) capex += s.meter_share * s.customers_per_km * km * s.meter_sar;
  const checks = s.wrong_per_km_yr * km * (1 - V.scr / 100) * s.check_sar, opex = nlog * s.telemetry_sar_yr + s.software_sar_yr + checks + 0.03 * capex;
  let df = 0; for (let i = 1; i <= s.years; i++) df += 1 / Math.pow(1 + s.rate, i);
  const net = benefit - opex;
  return { m3, share, benefit, capex, opex, payback: net > 0 ? capex / net : null, npv: -capex + net * df, bc: benefit * df / (capex + opex * df), mwh: m3 * s.energy_kwh_m3 / 1000, co2: m3 * s.energy_kwh_m3 * s.co2_kg_kwh / 1000, det: d };
}
function renderValue(rebuild) {
  if (rebuild || !$("v_out")) {
    const be = t("v_be"), W = [51, 16.5, 8];
    let h = `<div class="eyebrow">${t("v_eye")}</div><h1 class="h1">${t("v_h1")}</h1><p class="lead">${t("v_lead")}</p>
    <div class="sheet"><h3>${t("v_be_must")}</h3>
      <div class="be">${be.map((x, i) => `<div class="berow"><div class="p"><b>${x[0]}</b><small>${x[1]}</small></div><div class="betr"><i style="width:${W[i]}%"></i><span style="inset-inline-start:${W[i]}%">${x[2]}</span></div></div>`).join("")}
        <div class="berow"><div class="p"></div><div class="fine">↔ ${t("v_be_bar")}</div></div></div>
      <p class="sub" style="margin-top:14px">${t("v_be_cost")}</p><p class="lim" style="margin-top:12px">${t("v_be_note")}</p></div>`;
    if (CFG.econ) {
      h += `<div class="sheet"><div class="ghead"><h2 class="h2">${t("v_calc_h")}</h2><p class="sub">${t("v_calc_p")}</p></div><p class="lim" style="margin:10px 0 18px;border-color:var(--leak)">${t("v_calc_warn")}</p>
      <div class="valgrid"><div class="inputs">
        <label class="fld"><span>${t("v_basis")}</span><select id="v_basis">${t("v_bases").map((b, i) => `<option value="${i}" ${i === V.basis ? "selected" : ""}>${b}</option>`).join("")}</select></label>
        <div class="fld"><span>${t("v_water")}</span><div class="seg" id="v_presets">${[1.7, 5.3, 11].map((x, i) => `<button type="button" data-v="${x}">${t("v_pre")[i]}</button>`).join("")}</div></div>`;
      let g = "";
      for (const [k, grp, lo, hi, st, f] of SL) {
        if (grp !== g) { g = grp; h += `<div class="grp">${t(grp)}</div>`; }
        h += `<div class="sl"><div class="h"><label for="vi_${k}">${t("v_" + k)}</label><b id="vo_${k}"></b></div><input type="range" id="vi_${k}" min="${lo}" max="${hi}" step="${st}" value="${k === "km" ? KM.indexOf(V.km) : V[k]}"></div>`;
      }
      const names = t("v_names"), s = CFG.econ.src, pc = ["nrw", "real_loss_share", "hidden_share", "screened", "meter_share", "rate"];
      h += `<label class="chk" id="v_mwrap"><input type="checkbox" id="v_meters" ${V.meters ? "checked" : ""}><span>${t("v_meters")}</span></label></div>
        <div style="display:flex;flex-direction:column;gap:16px"><div class="outs" id="v_out"></div><div><h3 style="font-size:15px">${t("v_chart_h")}</h3><div id="v_chart"></div></div>
          <div><h3 style="font-size:15px">${t("v_how_h")}</h3><p class="sub" id="v_how"></p><p class="fine" id="v_co2"></p></div></div></div></div>
      <details class="sheet"><summary>${t("v_src_h")}</summary><div class="scroll"><table class="tbl" style="margin-top:12px"><tr>${t("v_src_c").map(c => `<th>${c}</th>`).join("")}</tr>${Object.keys(s).map(k => `<tr><td>${names[k] || k}</td><td>${pc.includes(k) ? Math.round(s[k] * 100) + "%" : Number.isInteger(s[k]) ? fmt(s[k]) : fmt(s[k], 2)}</td><td dir="ltr">${esc(CFG.econ.why[k])}</td></tr>`).join("")}</table></div><p class="fine" style="margin-top:8px">${t("v_src_note")}</p></details>`;
    }
    $("p-value").innerHTML = h; if (!CFG.econ) return;
    for (const [k] of SL) $("vi_" + k).oninput = e => { const x = parseFloat(e.target.value); V[k] = k === "km" ? KM[x] : x; renderValue(); };
    $("v_basis").onchange = e => { V.basis = +e.target.value; renderValue(); };
    $("v_meters").onchange = e => { V.meters = e.target.checked; renderValue(); };
    $("v_presets").onclick = e => { const b = e.target.closest("button"); if (b) { V.value = +b.dataset.v; $("vi_value").value = V.value; renderValue(); } };
  }
  if (!CFG.econ) return;
  for (const [k, , , , , f] of SL) $("vo_" + k).textContent = f(k === "km" ? KM.indexOf(V.km) : V[k]);
  $("v_mwrap").style.display = V.basis === 0 ? "" : "none";
  document.querySelectorAll("#v_presets button").forEach(b => b.classList.toggle("on", Math.abs(+b.dataset.v - V.value) < 0.05));
  const r = econ(V.value), o = t("v_out");
  $("v_out").innerHTML = `<div class="out ${r.bc >= 1 ? "" : "warn"}"><div class="v">${r.bc.toFixed(2)}</div><div class="k">${o[0]}</div><div class="s">${t("v_npv", { n: fmt(r.npv) })}</div></div>
  <div class="out ${r.payback !== null && r.payback <= 5 ? "" : "warn"}"><div class="v">${r.payback === null ? "—" : r.payback.toFixed(1)}</div><div class="k">${r.payback === null ? t("v_never") : o[1]}</div><div class="s">${t("v_cost", { c: fmt(r.capex), o: fmt(r.opex) })}</div></div>
  <div class="out"><div class="v" style="color:var(--ink)">${fmt(r.m3)}</div><div class="k">${o[2]}</div><div class="s">${t("v_worth", { b: fmt(r.benefit), p: Math.round(r.share * 100) })}</div></div>`;
  // benefit/cost against the value of water: where the line crosses 1, the system pays for itself
  const W = 640, H = 230, L = 34, R = 16, Tp = 22, B = 26, pts = []; let mx = 1.5;
  for (let v = 1; v <= 15.001; v += 0.25) { const b = econ(v).bc; pts.push([v, b]); mx = Math.max(mx, b); }
  mx = Math.ceil(mx); const X = v => L + (v - 1) / 14 * (W - L - R), Yy = b => H - B - b / mx * (H - B - Tp);
  let s = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;direction:ltr" role="img">`;
  for (let b = 0; b <= mx; b += Math.max(1, Math.round(mx / 5))) s += `<line x1="${L}" x2="${W - R}" y1="${Yy(b)}" y2="${Yy(b)}" stroke="#E6EBEF"/><text x="${L - 6}" y="${Yy(b) + 4}" fill="#76889A" font-size="11" text-anchor="end">${b}</text>`;
  for (const v of [1, 3, 5, 7, 9, 11, 13, 15]) s += `<text x="${X(v)}" y="${H - 8}" fill="#76889A" font-size="11" text-anchor="middle">${v}</text>`;
  s += `<line x1="${L}" x2="${W - R}" y1="${Yy(1)}" y2="${Yy(1)}" stroke="#E2532B" stroke-dasharray="5 4"/><text x="${W - R}" y="${Yy(1) - 5}" fill="#B33C16" font-size="11.5" text-anchor="end">${esc(t("v_even"))}</text>`;
  s += `<polyline fill="none" stroke="#1463D6" stroke-width="2.5" points="${pts.map(p => X(p[0]).toFixed(1) + "," + Yy(p[1]).toFixed(1)).join(" ")}"/>`;
  for (const v of [1.7, 5.3, 11]) s += `<circle cx="${X(v)}" cy="${Yy(econ(v).bc)}" r="4" fill="#fff" stroke="#1463D6" stroke-width="2"/>`;
  s += `<circle cx="${X(V.value)}" cy="${Yy(r.bc)}" r="7" fill="#1463D6" stroke="#fff" stroke-width="2"/><text x="${X(V.value)}" y="${Yy(r.bc) - 12}" fill="#0D2231" font-size="14" font-weight="700" text-anchor="middle">${r.bc.toFixed(2)}</text></svg>`;
  $("v_chart").innerHTML = s;
  $("v_how").innerHTML = t("v_how", { f: Math.round(r.det.found * 100), d: r.det.days, w: t("v_bases")[V.basis], b: CFG.econ.src.baseline_days, r: CFG.econ.src.repair_days });
  $("v_co2").innerHTML = t("v_co2", { e: fmt(r.mwh), c: fmt(r.co2) });
}

/* ---------------- Run the engine ---------------- */
const G = { town: null, job: null, busy: false, built: false };
function renderEngine() {
  if (!G.town && CFG.towns.length) G.town = CFG.towns.includes("ltown") ? "ltown" : CFG.towns[0];
  $("p-engine").innerHTML = `<div class="eyebrow">${t("g_eye")}</div><h1 class="h1">${t("g_h1")}</h1><p class="lead">${t("g_lead")}</p>
    <div class="sheet"><div class="row"><div class="seg" id="g_towns">${CFG.towns.map(k => `<button type="button" data-k="${k}" class="${k === G.town ? "on" : ""}">${t("town_" + k)}</button>`).join("")}</div><button class="btn pri" id="g_go" type="button" ${G.busy ? "disabled" : ""}>${t("g_go")}</button></div>
      <div class="prog" id="g_prog" ${G.busy ? "" : "hidden"}><div class="track"><i id="g_bar" style="width:2%"></i></div><span id="g_msg"></span></div>
      <p class="fine" style="margin-top:12px">${t("g_what")}</p></div><div id="g_out" style="display:flex;flex-direction:column;gap:22px"></div>`;
  $("g_towns").onclick = e => { const b = e.target.closest("button"); if (b && !G.busy) { G.town = b.dataset.k; renderEngine(); } };
  $("g_go").onclick = runEngine;
  if (G.job && G.job.done) showRun();
}
async function runEngine() {
  if (G.busy) return; G.busy = true; G.job = null; renderEngine(); $("g_msg").textContent = t("g_start");
  const t0 = Date.now();
  try {
    const { id } = await api("/api/run", { town: G.town });
    for (; ;) {
      await sleep(1200); const j = await api("/api/run/" + id);
      if ($("g_bar")) { $("g_bar").style.width = Math.max(2, Math.round(j.progress * 100)) + "%"; $("g_msg").textContent = j.waiting ? t("g_wait") : t("g_running", { s: Math.round((Date.now() - t0) / 1000) }); }
      if (j.done) { G.job = Object.assign(j, { id }); break; }
    }
  } catch (e) { G.job = { done: true, error: e.message }; }
  G.busy = false; renderEngine();
}
function showRun() {
  const j = G.job;
  if (j.error) { $("g_out").innerHTML = `<div class="sheet err">${esc(j.error)}</div>`; return; }
  const kinds = t("kinds"), rec = t("recs"), band = t("bands");
  $("g_out").innerHTML = (j.stored ? `<div class="sheet"><p class="lim" style="margin:0">${t("g_stored", { d: j.stored })}</p></div>` : "") + `<div class="outs"><div class="out ${j.rows.length ? "warn" : ""}" style="background:var(--card)"><div class="v">${j.rows.length}</div><div class="k">${t("g_k1")}</div><div class="s" dir="ltr">${j.window[0]} → ${j.window[1]}</div></div>
   <div class="out" style="background:var(--card)"><div class="v" style="color:var(--ink)">${j.secs} s</div><div class="k">${t("g_k2")}</div><div class="s">${t("g_k2s")}</div></div>
   <div class="out" style="background:var(--card)"><div class="v" style="color:var(--ink);font-size:21px;line-height:1.3;padding:6px 0">${j.flow ? t("g_pf") : t("g_p")}</div><div class="k">${t("g_k3")}</div><div class="s">${t("town_" + j.town)}</div></div></div>` +
    (j.rows.length ? `<div class="sheet"><h3 style="margin-bottom:10px">${t("g_list")}</h3><div class="scroll"><table class="tbl"><tr>${t("g_cols").map(c => `<th>${c}</th>`).join("")}</tr>${j.rows.map((r, i) => `<tr><td>${i + 1}</td><td>${r.date}</td><td>${esc(r.node)}</td><td>${kinds[r.kind] || r.kind}</td><td>${r.m3day != null ? fmt(r.m3day) + " m³" : "—"}</td><td>${band[r.band] || "—"}</td><td>${r.rec ? rec[r.rec] : r.kind === "flow" ? t("rec_zone") : "—"}</td></tr>`).join("")}</table></div><p class="fine" style="margin-top:8px">${t("g_list_note")}</p></div>` : `<div class="sheet">${t("g_none")}</div>`) +
    `<div class="sheet"><div class="row"><h3>${t("g_rep")}</h3><span class="grow"></span><a class="btn" href="${j.report_url || "/api/run/" + j.id + "/report"}" target="_blank" rel="noopener">${t("g_open")}</a></div><iframe class="rep" sandbox src="${j.report_url || "/api/run/" + j.id + "/report"}" title="${esc(t("g_rep"))}"></iframe></div>`;
}

/* ---------------- Real leaks: Bristol (frozen test BR1, display only) ---------------- */
const BR = { cur: -1, zoom: true, MT: null };
function renderBristol() {
  const D = BRISTOL; if (!D) return;
  if (BR.cur < 0) { BR.cur = D.stages.findIndex(s => s.lps === "5"); if (BR.cur < 0) BR.cur = 0; }
  const k = t("br_k"), S = D.summary, lg = t("br_leg"), lc = ["#7448C8", "#E2532B", "rgba(226,83,43,.35)", "#E2532B", "#1463D6"];
  $("p-bristol").innerHTML = `<div class="eyebrow">${t("br_eye")}</div><h1 class="h1">${t("br_h1")}</h1><p class="lead" style="max-width:92ch">${t("br_lead")}</p>
  <div class="kpis"><div class="kpi"><b>${S.within300.replace("/", " / ")}</b><span>${k[0]}</span></div><div class="kpi"><b>${S.chance300}%</b><span>${k[1]}</span></div><div class="kpi"><b>${S.median} m</b><span>${t("br_k")[2].replace("{m}", fmt(S.chance_median))}</span></div><div class="kpi bad"><b>1 L/s</b><span>${k[3]}</span></div></div>
  <div class="mapside"><div class="mapbox"><canvas id="br_map"></canvas><div class="mapbar"><span id="br_stages" style="display:contents"></span>
      <span class="pill">${t("br_view")} <button type="button" id="br_vz">${t("br_zoom")}</button><button type="button" id="br_va">${t("br_all")}</button></span></div>
      <div class="legend">${lg.map((x, i) => `<span><i class="${i === 0 ? "di" : ""}" style="background:${lc[i]}${i === 3 ? ";box-shadow:0 0 0 3px rgba(226,83,43,.25)" : ""}"></i>${x}</span>`).join("")}</div><div class="maptip" id="br_tip" hidden></div></div>
    <aside id="br_side"></aside></div>
  <p class="fine">${t("br_foot")}</p>`;
  $("br_stages").onclick = e => { const b = e.target.closest("button"); if (b) { BR.cur = +b.dataset.i; brUpdate(); } };
  $("br_vz").onclick = () => { BR.zoom = true; brUpdate(); }; $("br_va").onclick = () => { BR.zoom = false; brUpdate(); };
  $("br_map").addEventListener("mousemove", e => {
    if (!BR.MT) return; const r = $("br_map").getBoundingClientRect(), u = e.clientX - r.left, v = e.clientY - r.top, tip = $("br_tip"); let best = null, bd = 7;
    for (const p of D.pipes) { const [a1, b1] = BR.MT.P(p[0], p[1]), [a2, b2] = BR.MT.P(p[2], p[3]), dx = a2 - a1, dy = b2 - b1, L2 = dx * dx + dy * dy, kk = L2 ? Math.max(0, Math.min(1, ((u - a1) * dx + (v - b1) * dy) / L2)) : 0, d = Math.hypot(u - a1 - kk * dx, v - b1 - kk * dy); if (d < bd) { bd = d; best = p; } }
    if (!best) { tip.hidden = true; return; } tip.textContent = t("s_pipe", { n: best[5], d: best[4], l: Math.round(Math.hypot(best[2] - best[0], best[3] - best[1])) }); tip.hidden = false;
    tip.style.left = Math.min(u + 14, r.width - tip.offsetWidth - 6) + "px"; tip.style.top = Math.max(6, v - 30) + "px";
  });
  $("br_map").addEventListener("mouseleave", () => { $("br_tip").hidden = true; });
  brUpdate();
}
function brUpdate() {
  const D = BRISTOL, by = {}; D.stages.forEach((s, i) => (by[s.leak] = by[s.leak] || []).push([s, i]));
  $("br_stages").innerHTML = Object.entries(by).map(([k, L]) => `<span class="pill">${t("br_leak", { k })} ` + L.map(([s, i]) => `<button type="button" data-i="${i}" class="${i === BR.cur ? "on" : ""} ${s.err <= 300 ? "hit" : "miss"}" title="${s.err} m"><span dir="ltr">${s.lps} L/s</span></button>`).join("") + `</span>`).join("");
  $("br_vz").classList.toggle("on", BR.zoom); $("br_va").classList.toggle("on", !BR.zoom);
  const s = D.stages[BR.cur], hit = s.err <= 300;
  const sens = Object.keys(s.chg).map(k => [k, s.chg[k], s.z[k]]).sort((A, B) => A[2] - B[2]).slice(0, 6), mx = Math.max(1, ...sens.map(q => Math.abs(q[1])));
  $("br_side").innerHTML = `<h2>${t("br_title", { k: s.leak, l: s.lps })}</h2><p class="fine">${t("br_when", { d: s.date, q: (s.lps * 3.6).toFixed(1) })}</p>
    <div><span class="tag ${hit ? "ok" : "bad"}" style="font-size:13.5px;padding:3px 12px">${t(hit ? "br_hit" : "br_miss")}</span></div>
    <div class="q">${t("br_q1")}</div><p><b>${t("br_err", { m: fmt(s.err) })}</b></p><p>${t("br_rand", { m: fmt(s.cmed), p: s.c300 })}</p><p class="fine">${t("br_rank", { r: s.rank, n: fmt(D.junctions) })}</p>
    <div class="q">${t("br_q2")}</div>${sens.map(q => `<div class="rowb"><span>${esc(q[0])}</span><div><i style="width:${Math.min(100, Math.abs(q[1]) / mx * 100)}%;background:${q[2] <= -2 ? "#E2532B" : "#A9B5BF"}"></i></div><span>${q[1]} cm</span></div>`).join("")}
    <p class="fine">${t("br_logs")}</p>
    <div class="q">${t("br_q3")}</div><p class="fine">${t(hit ? "br_read_hit" : "br_read_miss")} ${t("br_size", { s: s.size })}</p>`;
  brDraw();
}
function brDraw() {
  const D = BRISTOL, c = $("br_map"); if (!c || !D) return; const [x, w, h] = canvasCtx(c), s = D.stages[BR.cur]; if (w < 10) return;
  let box; if (BR.zoom) { const pad = 520; box = [Math.min(s.xy[0], s.bxy[0]) - pad, Math.min(s.xy[1], s.bxy[1]) - pad, Math.max(s.xy[0], s.bxy[0]) + pad, Math.max(s.xy[1], s.bxy[1]) + pad]; } else box = pipeBox(D.pipes);
  const M = fitBox(...box, w, h, [64, 30, 50, 30]), P = M.P, sc = M.s; BR.MT = M;
  x.lineCap = "round"; x.strokeStyle = "#B4C2CE";
  for (const p of D.pipes) { const [u, v] = P(p[0], p[1]), [m, n] = P(p[2], p[3]); x.lineWidth = p[4] >= 300 ? 2.6 : p[4] >= 150 ? 1.6 : 1; x.beginPath(); x.moveTo(u, v); x.lineTo(m, n); x.stroke(); }
  x.fillStyle = "rgba(226,83,43,.28)"; for (const q of s.top) { const [u, v] = P(q[0], q[1]); x.beginPath(); x.arc(u, v, 6, 0, 7); x.fill(); }
  { const [u, v] = P(s.xy[0], s.xy[1]); x.strokeStyle = "#7448C8"; x.lineWidth = 1.5; x.setLineDash([6, 5]); x.beginPath(); x.arc(u, v, 300 * sc, 0, 7); x.stroke(); x.setLineDash([]); }
  { const [u, v] = P(s.xy[0], s.xy[1]), [m, n] = P(s.bxy[0], s.bxy[1]); x.strokeStyle = s.err <= 300 ? "#17865B" : "#E2532B"; x.lineWidth = 1.8; x.beginPath(); x.moveTo(u, v); x.lineTo(m, n); x.stroke(); }
  for (const g of D.sensors) { const [u, v] = P(g.xy[0], g.xy[1]), z = s.z[g.id] || 0, m = Math.min(Math.abs(z), 9);
    x.fillStyle = z <= -2 ? "#E2532B" : "#1463D6"; if (m >= 2 && z < 0) { x.globalAlpha = .2; x.beginPath(); x.arc(u, v, 6 + m * 1.6, 0, 7); x.fill(); x.globalAlpha = 1; }
    x.beginPath(); x.arc(u, v, 4.5 + (z < 0 ? m * .3 : 0), 0, 7); x.fill(); x.strokeStyle = "#fff"; x.lineWidth = 1.4; x.stroke(); }
  { const [u, v] = P(s.bxy[0], s.bxy[1]); x.fillStyle = "#E2532B"; x.beginPath(); x.arc(u, v, 9, 0, 7); x.fill(); x.strokeStyle = "#fff"; x.lineWidth = 2.5; x.stroke(); }
  { const [u, v] = P(s.xy[0], s.xy[1]); diamond(x, u, v, 10, "#7448C8"); }
  const bar = 500 * sc; x.strokeStyle = "#44596B"; x.lineWidth = 2; x.beginPath(); x.moveTo(w - 24 - bar, h - 22); x.lineTo(w - 24, h - 22); x.stroke(); x.fillStyle = "#44596B"; x.font = "11px system-ui"; x.textAlign = "center"; x.fillText("500 m", w - 24 - bar / 2, h - 30);
}

/* ---------------- Day-by-day feed (live/nightly.py state, display only) ---------------- */
const LF = { S: null, MAP: null, FOR: null, pts: [], hot: -1, timer: null, on: false };
function renderFeed() {
  if (window.WGS) { $("p-feed").innerHTML = `<div class="eyebrow">${t("lf_eye")}</div><h1 class="h1">${t("lf_h1")}</h1><p class="lead" style="max-width:92ch">${t("lf_sub")}</p><div class="sheet"><p class="lim" style="margin:0">${t("lf_static")}</p></div>`; return; }
  const lg = t("lf_leg");
  $("p-feed").innerHTML = `<div class="eyebrow">${t("lf_eye")}</div><h1 class="h1">${t("lf_h1")}</h1><p class="lead" style="max-width:92ch">${t("lf_sub")}</p>
  <div id="lf_src" class="src"></div><div class="kpis" id="lf_kpis"></div>
  <div class="mapside"><div class="mapbox"><canvas id="lf_map"></canvas>
      <div class="mapbar" id="lf_ctl" hidden><span class="pill"><button type="button" id="lf_start" class="pri">${t("lf_start")}</button><button type="button" id="lf_stop">${t("lf_stop")}</button><button type="button" id="lf_again">${t("lf_restart")}</button></span>
        <span class="pill"><label for="lf_every">${t("lf_speed")}</label> <select id="lf_every"><option value="1">1 s</option><option value="3" selected>3 s</option><option value="6">6 s</option><option value="15">15 s</option><option value="60">60 s</option></select></span><span class="pill" id="lf_rstate" style="padding:5px 12px"></span></div>
      <div class="legend">${lg.map((x, i) => `<span><i style="background:${["#E2532B", "#7448C8", "#1463D6"][i]}"></i>${x}</span>`).join("")}</div><div class="maptip" id="lf_tip" hidden></div></div>
    <aside><div class="q" style="margin-top:0">${t("lf_alarms_h")}</div><div id="lf_alarms" style="display:flex;flex-direction:column;gap:6px"></div><div class="q">${t("lf_checks_h")}</div><div id="lf_checks" style="display:flex;flex-direction:column;gap:8px"></div></aside></div>
  <p class="fine">${t("lf_foot")}</p>`;
  const post = async action => { try { await api("/api/live/replay", { action, every: +$("lf_every").value }); } catch (e) { } lfPoll(); };
  $("lf_start").onclick = () => post("start"); $("lf_stop").onclick = () => post("stop"); $("lf_again").onclick = () => { if (confirm(t("lf_restart_q"))) post("restart"); };
  $("lf_every").onchange = () => { if (LF.S && LF.S.replay.running) post("start"); };
  $("lf_map").addEventListener("mousemove", e => { const r = $("lf_map").getBoundingClientRect(), u = e.clientX - r.left, v = e.clientY - r.top, tip = $("lf_tip"); let best = null, bd = 14;
    for (const [a, b, q] of LF.pts) { const d = Math.hypot(u - a, v - b); if (d < bd) { bd = d; best = q; } }
    if (!best) { tip.hidden = true; return; } tip.textContent = `#${best.k} · ${best.date} · ${best.node || ""} · ${best.size} m³/h`; tip.hidden = false; tip.style.left = Math.min(u + 14, r.width - tip.offsetWidth - 6) + "px"; tip.style.top = Math.max(6, v - 30) + "px"; });
  $("lf_map").addEventListener("mouseleave", () => { $("lf_tip").hidden = true; });
  $("lf_alarms").addEventListener("mouseover", e => { const el = e.target.closest(".al"), k = el ? +el.dataset.k : -1; if (k !== LF.hot) { LF.hot = k; lfDraw(); } });
  $("lf_alarms").addEventListener("mouseleave", () => { if (LF.hot !== -1) { LF.hot = -1; lfDraw(); } });
  lfShow();
}
const lfAlarms = () => { const S = LF.S; return ((S && S.state && S.state.alarms) || []).map((a, i) => Object.assign({ k: i + 1, fresh: a.seen_on === S.state.day_reached && S.state.engine_day === S.state.day_reached }, a)); };
function lfShow() {
  const S = LF.S; if (!$("lf_src")) return;
  if (!S) { $("lf_src").className = "src"; $("lf_src").innerHTML = `<b>${esc(t("lf_src_none"))}</b>`; return; }
  const st = S.state, f = S.feed, src = (st && st.source) || (f && f.source), rep = src === "replay of recorded data", kinds = t("kinds");
  $("lf_src").className = "src " + (!src ? "" : rep ? "replay" : "live");
  $("lf_src").innerHTML = !src ? `<b>${esc(t("lf_src_none"))}</b><p>${esc(t(S.can_replay ? "lf_empty" : "lf_empty_real"))}</p>` :
    `<b>${esc(t(rep ? "lf_src_replay" : "lf_src_live"))}</b><span dir="ltr">${esc((st && st.town) || f.name || "")}</span>` + (((st && st.dataset) || (f && f.dataset)) ? `<span>${esc(t("lf_dataset"))}: <span dir="ltr">${esc((st && st.dataset) || f.dataset)}</span></span><span>${esc(t("lf_licence"))}: <span dir="ltr">${esc((st && st.licence) || f.licence)}</span></span>` : "") + `<p>${esc(t(rep ? "lf_replay_note" : "lf_real_note"))}</p>`;
  const ev = $("lf_every"); if (S.replay.running && S.replay.every != null && document.activeElement !== ev && [...ev.options].some(o => +o.value === S.replay.every)) ev.value = String(S.replay.every);
  $("lf_ctl").hidden = !S.can_replay; const run = S.replay.running, total = S.replay.recorded_days, got = st ? st.days_in_store + (st.held_days || []).length : 0, done = total && got >= total;
  $("lf_start").disabled = run || done; $("lf_stop").disabled = !run; $("lf_rstate").textContent = done ? t("lf_done") : run ? t("lf_running") : t("lf_idle");
  const al = lfAlarms(), fc = (st && st.findings_count) || { blocking: 0, warning: 0 };
  $("lf_kpis").innerHTML = [[st && st.day_reached || "–", t("lf_k_day"), ""], [st ? st.days_in_store + (total ? " / " + total : "") : "–", t("lf_k_days"), ""], [al.length, t("lf_k_alarms"), ""],
  [fc.blocking + " / " + fc.warning, t("lf_k_checks"), fc.blocking ? "bad" : ""], [st && st.run_seconds != null ? st.run_seconds : "–", t("lf_k_run"), ""]].map(k => `<div class="kpi ${k[2]}"><b>${esc(k[0])}</b><span>${esc(k[1])}</span></div>`).join("");
  $("lf_alarms").innerHTML = al.length ? al.slice().reverse().map(a => `<div class="al ${a.fresh ? "new" : ""}" data-k="${a.k}"><span class="n">${a.k}</span><span><b dir="ltr">${esc(a.date)}</b>${a.fresh ? ` <span class="tag bad">${esc(t("lf_new"))}</span>` : ""} · ${esc(kinds[a.kind] || a.kind)}
    <small>${a.node ? esc(t("lf_near")) + " " + esc(a.node) : esc(t("lf_zone")) + " " + esc(a.zone)} · <span dir="ltr">${esc(a.size)} m³/h</span> · ${esc(t("lf_seen"))} <span dir="ltr">${esc(a.seen_on)}</span></small></span></div>`).join("") : `<p class="fine">${esc(t("lf_no_alarms"))}</p>`;
  const B = (st && st.blocking) || [], F = ((st && st.findings) || []).filter(x => x.severity === "warning").slice(-40).reverse();
  $("lf_checks").innerHTML = (B.length ? `<p class="err">${esc(t("lf_blocked"))}</p>` + B.map(x => `<div class="fd blocking"><b>${esc(x.day || "")} · ${esc(x.check)}${x.sensor ? " · " + esc(x.sensor) : ""}</b><br>${esc(x.text)}</div>`).join("") : "") +
    (F.length ? F.map(x => `<div class="fd"><b>${esc(x.day || "")} · ${esc(x.check)}${x.sensor ? " · " + esc(x.sensor) : ""}</b><br>${esc(x.text)}</div>`).join("") : (B.length ? "" : `<p class="fine">${esc(t(st ? "lf_no_checks" : "lf_no_alarms"))}</p>`)) +
    (st && st.engine_note && !B.length ? `<p class="fine" dir="ltr">${esc(st.engine_note)}</p>` : "");
  lfDraw();
}
function lfDraw() {
  const c = $("lf_map"); if (!c) return; const [x, w, h] = canvasCtx(c), MAP = LF.MAP; LF.pts = []; if (!MAP || w < 10) return;
  const box = pipeBox(MAP.pipes), M = fitBox(...box, w, h, [60, 30, 46, 30]), P = M.P, sc = M.s;
  x.lineCap = "round"; x.strokeStyle = "#B4C2CE"; for (const p of MAP.pipes) { const [u, v] = P(p[0], p[1]), [m, n] = P(p[2], p[3]); x.lineWidth = p[4] >= 300 ? 2.6 : p[4] >= 150 ? 1.6 : 1; x.beginPath(); x.moveTo(u, v); x.lineTo(m, n); x.stroke(); }
  for (const g of MAP.sensors) { const [u, v] = P(g.xy[0], g.xy[1]); x.fillStyle = "#1463D6"; x.beginPath(); x.arc(u, v, 5, 0, 7); x.fill(); x.strokeStyle = "#fff"; x.lineWidth = 1.4; x.stroke(); }
  const al = lfAlarms().filter(q => q.xy);
  for (const q of al) { const [u, v] = P(q.xy[0], q.xy[1]); x.fillStyle = q.fresh ? "rgba(116,72,200,.16)" : "rgba(226,83,43,.12)"; x.beginPath(); x.arc(u, v, Math.max(300 * sc, 12), 0, 7); x.fill(); }
  for (const q of al) { const [u, v] = P(q.xy[0], q.xy[1]), hot = q.k === LF.hot; x.fillStyle = q.fresh ? "#7448C8" : "#E2532B"; x.beginPath(); x.arc(u, v, hot ? 13 : 10, 0, 7); x.fill(); x.strokeStyle = "#fff"; x.lineWidth = hot ? 3 : 1.6; x.stroke();
    x.fillStyle = "#fff"; x.font = "700 11px system-ui"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(q.k, u, v + .5); LF.pts.push([u, v, q]); }
  const km = (box[2] - box[0]) > 8000 ? 2000 : 500, bar = km * sc; x.strokeStyle = "#44596B"; x.lineWidth = 2; x.beginPath(); x.moveTo(w - 24 - bar, h - 22); x.lineTo(w - 24, h - 22); x.stroke(); x.fillStyle = "#44596B"; x.font = "11px system-ui"; x.textAlign = "center"; x.textBaseline = "alphabetic"; x.fillText(km >= 1000 ? km / 1000 + " km" : km + " m", w - 24 - bar / 2, h - 30);
}
async function lfPoll() {
  if (!LF.on) return;
  try { LF.S = await api("/api/live"); } catch (e) { LF.S = null; }
  const S = LF.S, id = S && S.state && S.state.engine_day ? (S.state.feed + "|" + S.state.town) : null;
  if (!id) { LF.MAP = null; LF.FOR = null; } else if (LF.FOR !== id) { try { LF.MAP = await api("/api/live/map"); LF.FOR = id; } catch (e) { } }
  lfShow();
}
function feedActive(on) { LF.on = on; clearInterval(LF.timer); if (on) { lfPoll(); LF.timer = setInterval(lfPoll, 1500); } }

/* ---------------- shell: language and pages ---------------- */
const PAGES = { "": "story", shift: "shift", room: "shift", evidence: "evidence", value: "value", bristol: "bristol", feed: "feed", engine: "engine" };
let ROUTE = null;
function applyLang() {
  document.documentElement.lang = LANG; document.documentElement.dir = LANG === "ar" ? "rtl" : "ltr";
  document.title = t("brand");
  document.querySelectorAll("[data-t]").forEach(e => { e.innerHTML = t(e.dataset.t); });
  $("lang").textContent = t("lang_other");
  renderStory(); renderEvidence(); renderValue(true); renderEngine(); renderBristol(); renderFeed();
  if (typeof Shift !== "undefined") Shift.texts();
}
function route() {
  const raw = location.hash.replace(/^#\/?/, ""), r = raw.split("?")[0], q = new URLSearchParams(raw.split("?")[1] || ""), key = PAGES[r] !== undefined ? r : "", pg = PAGES[key];
  for (const k of new Set(Object.values(PAGES))) $("p-" + k).hidden = pg !== k;
  document.querySelectorAll("#nav a").forEach(a => a.classList.toggle("on", PAGES[a.dataset.r] === pg));
  document.body.classList.toggle("inshift", pg === "shift");
  if (typeof Shift !== "undefined") { if (pg === "shift") Shift.enter({ auto: q.get("auto") === "1" }); else Shift.leave(); }
  feedActive(pg === "feed");
  if (pg === "bristol") brDraw();
  if (ROUTE !== pg) window.scrollTo(0, 0); ROUTE = pg;
}
window.addEventListener("hashchange", route);
window.addEventListener("resize", () => { if (ROUTE === "bristol") brDraw(); if (ROUTE === "feed") lfDraw(); });
window.addEventListener("DOMContentLoaded", async () => {
  $("lang").onclick = () => { LANG = LANG === "ar" ? "en" : "ar"; try { localStorage.setItem("wg_lang", LANG); } catch (e) { } applyLang(); route(); };
  applyLang();
  try { CFG = await api("/api/config"); } catch (e) { $("offline").hidden = false; $("offline").textContent = t("no_server"); route(); return; }
  applyLang(); route();
});
