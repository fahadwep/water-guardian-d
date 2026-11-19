/* Water Guardian: the live shift and the recorded year. The page only displays what the engine returns (control_room/server.py,
   guardian_app/live.py, engine/survey.py). Nothing about a leak is decided here: the hidden leak's place stays on the server
   until the shift ends. The crew's figures (logger reach, loggers a night, metres walked a day) are assumptions and the page says so.
   The crew's plan is the engine's (engine/survey.PLAN): a located alarm's circle is walked; a zone is swept with loggers, night after
   night, and the crew does not leave after its first repair. A day arrives as one reply; the page then plays it as short "beats"
   (morning read, loggers placed, the walk, the repair) so the
   sequence can be followed, and asks for the next day only when the beats are over. */
"use strict";
const Shift = (() => {
  const S = { town: null, mode: "live", more: false, sid: null, D: null, alarms: [], events: [], jobs: [], disp: {}, card: {}, pos: 0, playing: false, speed: 1, sel: null, placing: false,
    reveal: null, ended: false, q: null, leaks: [], tl: [], beats: [], say: null, auto: false, autoTail: null, gen: 0, loading: false, err: null, started: false, active: false, dirty: true, last: 0, night: 0, lastTick: 0, leakOpen: false };
  const cls = q => t("classes")[q < 0.25 ? 0 : q < 2 ? 1 : q < 6 ? 2 : 3];
  const N = () => S.D ? S.D.res.length : 0;
  const cur = () => Math.max(0, Math.min(N() - 1, Math.floor(S.pos)));
  const live = () => S.mode === "live";
  const dayLabel = i => S.D && S.D.dates ? S.D.days[Math.min(i, S.D.days.length - 1)] : t("s_dayn", { n: i });
  const visible = () => S.alarms.map((a, k) => [a, k]).filter(([a]) => a.i <= S.pos + 1e-6);
  const jobOf = k => S.jobs.find(j => j.k === k);
  const cardOf = k => S.card[k] || jobOf(k);
  const hitOf = k => { if (!S.reveal) return null; return live() ? (S.reveal.alarms[k] ? S.reveal.alarms[k].hit : null) : !!S.alarms[k].hit; };
  const lead = () => { const s = S.sel !== null ? jobOf(S.sel) : null; if (s && s.state !== "done") return s; return S.jobs.find(j => j.state !== "done") || s || S.jobs[S.jobs.length - 1] || null; };
  /* The state the screen shows. The engine's job says "walk" for a walking job that is still on its way, and "travel" for a sweep between
     two logger nights; the screen calls the first "travel" and the second "move" (the loggers are being moved). */
  const norm = (jobs, day) => (jobs || []).map(j => { const st = j.state === "walk" && day < j.arrive ? "travel" : j.state === "travel" && (j.night > 0 || j.done > 0) ? "move" : j.state; return Object.assign({}, j, { state: st, pipes: j.pipes || [] }); });
  const STATES = ["travel", "listen", "walk", "done"], stIdx = s => s === "move" ? 1 : STATES.indexOf(s);
  const stepMs = () => 1100 / S.speed, beatK = () => S.speed >= 4 ? 0.45 : S.speed >= 2 ? 0.7 : 1;

  /* ---------------- start, the day loop and the beats ---------------- */
  /* static build: what the engine in the browser is doing while it starts */
  const wgsNote = () => { const st = window.WGS && WGS.stage(); return st && st !== "ready" ? t("wgs_" + st) : ""; };
  window.addEventListener("wgs", () => { if (S.loading || live()) renderAll(); });
  async function start(opts) {
    const gen = ++S.gen;
    Object.assign(S, { sid: null, D: null, alarms: [], events: [], jobs: [], disp: {}, card: {}, pos: 0, playing: false, sel: null, placing: false, reveal: null, ended: false, leaks: [], tl: [], beats: [], say: null,
      auto: !!(opts && opts.auto), autoTail: null, loading: true, err: null, pn: null, night: 0, leakOpen: false });
    renderAll();
    try {
      if (live()) {
        const r = await api("/api/shift", { town: S.town }); if (gen !== S.gen) return;
        S.sid = r.sid; S.D = r.init; S.jobs = norm(r.init.jobs, 0); S.q = r.init.q; S.pos = N() - 1; S.speed = 1;
      } else {
        const d = await api("/api/year/" + S.town); if (gen !== S.gen) return;
        S.D = d; S.alarms = d.alarms.slice().sort((a, b) => a.i - b.i); S.speed = 8; S.pos = 0; S.playing = true;
      }
      S.loading = false; S.last = performance.now(); renderAll();
      if (live()) loop(gen);
    } catch (e) { if (gen === S.gen) { S.loading = false; S.err = e.message; renderAll(); } }
  }
  const pause = async (ms, gen) => { const t0 = performance.now(); while (performance.now() - t0 < ms * beatK() && gen === S.gen) await sleep(60); };
  async function loop(gen) {
    while (gen === S.gen && live() && !S.ended) {
      if (!S.active || S.placing) { await sleep(120); continue; }
      try {
        if (S.beats.length) { await playBeats(gen); continue; }
        if (S.auto && await autoStep(gen)) continue;
        if (!S.playing) { await sleep(100); continue; }
        const t0 = performance.now(); await tick(gen); await playBeats(gen);
        await sleep(Math.max(40, stepMs() - (performance.now() - t0)));
      } catch (e) { if (gen === S.gen) { S.err = e.message; S.playing = false; S.auto = false; renderAll(); } return; }
    }
  }
  async function tick(gen) {
    const old = S.jobs, r = await api("/api/shift/" + S.sid, { a: "tick", n: 1 }); if (gen !== S.gen) return;
    for (const d of r.days) { S.D.res.push(d.res); S.D.chg.push(d.chg); S.D.flow.push(d.flow); S.D.days.push(String(S.D.days.length)); }
    S.pos = N() - 1; S.lastTick = performance.now(); addEvents(r.events); const now = norm(r.jobs, cur()); planBeats(old, now); S.jobs = now;
    if (r.alarms.length) {
      const first = S.alarms.length; S.alarms.push(...r.alarms); r.alarms.forEach((a, i) => S.tl.push({ day: a.i, c: "alarm", s: String(first + i + 1), k: 1 }));
      S.beats.push({ dur: 900, enter: () => { select(first); if (!S.auto) S.playing = false; } });
    }
    renderBar(); renderAlarms(); renderLog(); renderTimeline(); S.dirty = true;
  }
  function addEvents(ev) { for (const e of ev || []) S.events.push(e); }
  const dispOf = j => ({ state: j.state, loggers: j.loggers || [], heard: j.heard || [], cleared: new Set(j.cleared_pipes || []), tonight: new Set(j.tonight || []), list: j.pipes, walked: j.done || 0, found: (j.found || []).map(f => f.pipe), drop: 1, pulse: 0 });
  /* What happened to each crew between two replies, as beats the screen plays in order: the morning read of last night's loggers
     (silent, or heard), the walk, each repair, the end of the job, and tonight's loggers. */
  function planBeats(old, now) {
    for (const n of now) {
      const o = old.find(j => j.k === n.k), k = n.k, a = n.first.n;
      if (!o) { S.disp[k] = dispOf(n); S.card[k] = n; continue; }
      const B = b => S.beats.push(Object.assign({ k }, b)), d = () => S.disp[k], setCard = c => { S.card[k] = c; }, day = cur();
      const more = n.pipes.length - o.pipes.length, heardNow = o.state === "listen" && more > 0;
      if (o.state === "listen" && !heardNow)                    // a silent night: the pipes beside those loggers are cleared
        B({ dur: 1500, say: () => t("say_quiet", { c: n.cleared, a }), enter: () => { d().cleared = new Set(n.cleared_pipes); d().fade = true; setCard(Object.assign({}, o, { cleared: n.cleared, cleared_pipes: n.cleared_pipes })); } });
      if (heardNow)
        B({ dur: 2000, say: () => t("say_heard", { n: more }), enter: () => { Object.assign(d(), { state: "walk", heard: n.heard, loggers: [], cleared: new Set(n.cleared_pipes), list: n.pipes, walked: o.done, fade: false, drop: 1 }); setCard(Object.assign({}, n, { state: "walk", found: o.found, done: o.done, m: o.m, next: n.pipes[o.done] })); } });
      if (n.done > o.done) {
        const list = n.pipes, from = o.done;
        B({ dur: Math.max(900, Math.min(2600, 420 * (n.done - from))), say: p => t("say_walk", { n: list.length, d: Math.round(from + (n.done - from) * (p || 0)) }),
          enter: () => { Object.assign(d(), { state: "walk", list, loggers: [], heard: n.heard }); setCard(Object.assign({}, n, { state: "walk", found: o.found, done: from, m: o.m, next: list[from] })); },
          step: p => { d().walked = from + (n.done - from) * p; const c = S.card[k], dn = Math.min(n.done, Math.floor(d().walked + 1e-6)); if (c.done !== dn) { c.done = dn; c.next = list[dn]; if (S.sel === k) renderFocus(); } } });
      }
      n.found.slice(o.found.length).forEach((f, i) => {
        const upto = n.found.slice(0, o.found.length + i + 1), last = n.state === "done" && upto.length === n.found.length;
        B({ dur: 2600, say: () => t(n.sweep && !last ? "say_found_sweep" : "say_found", { p: f.pipe, m: fmt(f.m), t: (n.first.m / 1000).toFixed(1) }),
          enter: () => { S.tl.push({ day: f.day, c: "fix", s: "✓", k: 4 }); Object.assign(d(), { walked: n.done, found: upto.map(q => q.pipe), pulse: performance.now() }); setCard(Object.assign({}, n, { state: "walk", found: upto })); } });
      });
      if (n.state === "done" && o.state !== "done")
        B({ dur: 2200, say: () => n.found.length ? t("say_done", { k: k + 1, f: n.found.length, m: fmt(n.m) }) : t("say_none", { k: k + 1 }), enter: () => { const pu = d().pulse; S.disp[k] = Object.assign(dispOf(n), { pulse: pu }); setCard(n); } });
      if (n.night > o.night)
        B({ dur: 3000, say: () => t("say_placed", { n: n.night, m: n.loggers.length }), enter: () => { S.tl.push({ day, c: "night", s: "☾", k: 3 }); Object.assign(d(), { state: "listen", loggers: n.loggers, tonight: new Set(n.tonight), heard: [], cleared: new Set(n.cleared_pipes), list: n.pipes, walked: n.done, fade: false, drop: 0 }); setCard(n); }, step: p => { d().drop = Math.min(1, p * 1.8); } });
      B({ dur: 0, enter: () => { const pu = S.disp[k] && S.disp[k].pulse; S.disp[k] = Object.assign(dispOf(n), { pulse: pu }); setCard(n); } });      // always end on exactly what the engine returned
    }
  }
  async function playBeats(gen) {
    while (S.beats.length && gen === S.gen) {
      const b = S.beats.shift(); if (b.k !== undefined && S.auto) S.sel = b.k;
      if (b.enter) b.enter(); S.say = b.say || null; S.sayP = 0; renderSay(); renderSteps(); renderFocus(); renderAlarms(); renderTimeline(); S.dirty = true;
      const dur = b.dur * beatK(), t0 = performance.now();
      while (dur > 0 && gen === S.gen) { const p = Math.min(1, (performance.now() - t0) / dur); if (b.step) b.step(p); if (b.say && b.say.length) { S.sayP = p; renderSay(); } S.dirty = true; if (p >= 1) break; await sleep(30); }
    }
    S.say = null; renderSay(); renderSteps(); renderFocus(); renderAlarms(); renderBar(); S.dirty = true;
  }
  const best = a => a.kind === "flow" ? "crew" : a.act ? { recheck: "retest", isolate: "isolate", pressure: "lower_crew", repair: "sched" }[a.act.rec] : null;
  /* Autoplay: hide a leak, follow Guardian's advice at each alarm, end the shift two days after the last crew has finished. */
  async function autoStep(gen) {
    if (!S.leaks.length) { await pause(1500, gen); if (S.auto && gen === S.gen) { S.q = Math.max(S.D.qmin, Math.round(S.D.demand * 0.15) / 10); await leak(null); } return true; }
    const k = S.alarms.findIndex(a => !a.dec);
    if (k >= 0) {
      const a = S.alarms[k]; if (S.sel !== k) select(k);
      if (a.kind !== "flow" && (a.act === undefined || a._req)) { await sleep(150); return true; }
      await pause(4200, gen); if (!S.auto || gen !== S.gen) return true;
      let c = best(a) || "crew"; if (c === "retest") { if (a._again) c = "sched"; a._again = true; }
      await choose(k, c, true); await pause(1500, gen); return true;
    }
    const day = cur();
    if (S.jobs.length && S.jobs.every(j => j.state === "done") && S.jobs.some(j => j.found.length)) { if (S.autoTail === null) S.autoTail = day + 2; if (day >= S.autoTail) { await pause(900, gen); if (S.auto && gen === S.gen) await end(); return true; } }
    if (day >= 75) { await end(); return true; }
    S.playing = true; return false;
  }
  function frame(now) {                                   /* called by a timer, so the shift keeps its pace when the browser slows animation frames */
    if (!S.active || !S.D) return;
    if (S.mode === "year" && S.playing) {
      const before = S.pos, dt = Math.min(0.2, (now - S.last) / 1000); S.pos = Math.min(N() - 1, S.pos + dt * S.speed);
      const hit = S.alarms.findIndex(a => a.i > before + 1e-6 && a.i <= S.pos);
      if (hit >= 0) { select(hit); S.pos = S.alarms[hit].i; S.playing = false; renderAlarms(); }
      if (S.pos >= N() - 1) S.playing = false;
      renderBar(); renderSteps(); renderSay(); renderTimeline(); S.dirty = true;
    }
    const dtn = Math.min(400, now - (S.lastN || now)); S.lastN = now; S.last = now;
    const L = lead(), dl = L && S.disp[L.k], target = live() && !S.ended && dl && dl.state === "listen" ? 1 : 0;
    if (Math.abs(S.night - target) > 0.004) { S.night += (target - S.night) * (1 - Math.exp(-dtn / 260)); S.dirty = true; } else S.night = target;
    $("s_mapwrap").classList.toggle("night", S.night > 0.5);
    const nt = $("s_night"); nt.style.opacity = S.night; if (target && L) { nt.hidden = false; nt.textContent = t("s_night", { n: (cardOf(L.k) || L).night }); } else nt.hidden = true;
    const cw = $("s_map").clientWidth + "x" + $("s_map").clientHeight; if (cw !== S.size) { S.size = cw; S.dirty = true; }      // the box changed size
    const moving = live() && !S.ended && S.jobs.some(j => j.state !== "done" || (S.disp[j.k] && S.disp[j.k].pulse && now - S.disp[j.k].pulse < 4000));
    if (S.dirty || (moving && now - (S.drawn || 0) > 40)) { S.dirty = false; S.drawn = now; drawMap(now); drawRes(); drawFlow(); }
  }

  /* ---------------- the map ---------------- */
  let MT = null;
  const mixc = (a, b, n, al) => { const m = i => Math.round(a[i] + (b[i] - a[i]) * n); return al === undefined ? `rgb(${m(0)},${m(1)},${m(2)})` : `rgba(${m(0)},${m(1)},${m(2)},${al})`; };
  function pipeByName(n) { if (!S.pn) { S.pn = {}; for (const p of S.D.pipes) if (p[5]) S.pn[p[5]] = p; } return S.pn[n]; }
  function pipeAt(u, v) {                                   /* the named pipe under the pointer, within 7 px */
    if (!MT || !S.D) return null; let bestP = null, bd = 7;
    for (const p of S.D.pipes) { if (!p[5]) continue; const [a1, b1] = MT.P(p[0], p[1]), [a2, b2] = MT.P(p[2], p[3]), dx = a2 - a1, dy = b2 - b1, L2 = dx * dx + dy * dy;
      const k = L2 ? Math.max(0, Math.min(1, ((u - a1) * dx + (v - b1) * dy) / L2)) : 0, d = Math.hypot(u - a1 - k * dx, v - b1 - k * dy); if (d < bd) { bd = d; bestP = p; } }
    return bestP;
  }
  function drawMap(now) {
    const [x, w, h] = canvasCtx($("s_map")); if (!S.D || w < 10) return;
    const n = S.night, D = S.D, M = fitBox(...pipeBox(D.pipes), w, h, [34, 34, 56, 34]), P = M.P, sc = M.s; MT = M;
    const ink = mixc([13, 34, 49], [232, 239, 244], n), bg = mixc([247, 249, 251], [10, 26, 41], n), line = (p, col, lw) => { const [u, v] = P(p[0], p[1]), [m, g] = P(p[2], p[3]); x.strokeStyle = col; x.lineWidth = lw; x.beginPath(); x.moveTo(u, v); x.lineTo(m, g); x.stroke(); };
    $("s_nameswrap").hidden = !D.pipes.some(p => p[5]);
    x.fillStyle = bg; x.fillRect(0, 0, w, h); x.lineCap = "round"; const pc = mixc([176, 191, 204], [52, 78, 102], n);
    for (const p of D.pipes) line(p, pc, p[4] >= 300 ? 2.8 : p[4] >= 150 ? 1.9 : 1.2);
    const sel = S.sel !== null ? S.alarms[S.sel] : null, selOn = sel && sel.i <= S.pos + 1e-6, selJob = selOn && live() ? S.disp[S.sel] : null;
    if (selOn && !(selJob && selJob.state !== "travel")) {                      /* the alarm's search: its zone, or its 300 m circle */
      if (sel.plan) for (const [nm] of sel.plan) { const p = pipeByName(nm); if (p) line(p, sel.zone_xy ? "rgba(226,83,43,.20)" : "rgba(226,83,43,.30)", 7); }
      else if (sel.zone_xy) { x.fillStyle = "rgba(226,83,43,.16)"; for (const q of sel.zone_xy) { const [u, v] = P(q[0], q[1]); x.beginPath(); x.arc(u, v, 5, 0, 7); x.fill(); } }
      if (!sel.zone_xy) { const [u, v] = P(sel.xy[0], sel.xy[1]); x.fillStyle = "rgba(226,83,43,.10)"; x.strokeStyle = "#E2532B"; x.lineWidth = 1.6; x.setLineDash([7, 5]); x.beginPath(); x.arc(u, v, 300 * sc, 0, 7); x.fill(); x.stroke(); x.setLineDash([]); }
    } else if (selOn && !sel.zone_xy) { const [u, v] = P(sel.xy[0], sel.xy[1]); x.strokeStyle = "rgba(226,83,43,.45)"; x.lineWidth = 1.2; x.setLineDash([7, 5]); x.beginPath(); x.arc(u, v, 300 * sc, 0, 7); x.stroke(); x.setLineDash([]); }
    const marks = [];
    if (live()) for (const j of S.jobs) {                                     /* the crews */
      const d = S.disp[j.k]; if (!d) continue; const on = S.sel === j.k || (lead() === j && d.state !== "done"), al = S.alarms[j.k], reach = (D.crew ? D.crew.reach_m : 100) * sc;
      if (on && d.state !== "travel") for (const nm of d.cleared) { const p = pipeByName(nm); if (p) line(p, mixc([160, 214, 189], [28, 96, 74], n), 2.6); }
      if (d.state === "listen") {
        const cnt = Math.ceil(d.loggers.length * d.drop);
        x.fillStyle = n > 0.5 ? "rgba(246,216,122,.10)" : "rgba(20,99,214,.07)"; for (let i = 0; i < cnt; i++) { const [u, v] = P(d.loggers[i][0], d.loggers[i][1]); x.beginPath(); x.arc(u, v, reach, 0, 7); x.fill(); }
        if (on) for (const nm of d.tonight) { const p = pipeByName(nm); if (p && !d.cleared.has(nm)) line(p, n > 0.5 ? "rgba(246,216,122,.55)" : "rgba(20,99,214,.5)", 2.2); }
        for (let i = 0; i < cnt; i++) { const [u, v] = P(d.loggers[i][0], d.loggers[i][1]), tw = 0.6 + 0.4 * Math.sin(now / 420 + i * 1.7); x.fillStyle = d.fade ? mixc([169, 181, 191], [70, 90, 108], n) : n > 0.5 ? `rgba(246,216,122,${tw})` : "#fff"; x.strokeStyle = ink; x.lineWidth = 1.5; x.fillRect(u - 5, v - 5, 10, 10); x.strokeRect(u - 5, v - 5, 10, 10); }
      }
      if (d.list && d.state !== "travel") d.list.forEach((nm, i) => {
        const p = pipeByName(nm); if (!p) return; const hit = d.found.includes(nm), done = i < Math.floor(d.walked + 1e-6), at = !hit && d.state === "walk" && i === Math.floor(d.walked + 1e-6);
        if ((d.state === "done" && !hit && !done) || (!on && !hit && d.state === "done")) return;
        line(p, hit || done ? "#17865B" : "#E2532B", hit ? 7 : done ? 3.2 : 4.2);
        if (at) { const f = d.walked - Math.floor(d.walked), [u, v] = P(p[0] + (p[2] - p[0]) * f, p[1] + (p[3] - p[1]) * f); marks.push(["crew", u, v, j.k]); }
        if (hit) { const [u, v] = P((p[0] + p[2]) / 2, (p[1] + p[3]) / 2); marks.push(["fix", u, v, j.k, d.pulse]); }
      });
      if (d.state === "walk" || (on && d.state === "done" && d.found.length)) for (const g of d.heard) { const [u, v] = P(g[0], g[1]); const ph = (now / 900) % 1;
        if (d.state === "walk") { x.strokeStyle = `rgba(23,134,91,${1 - ph})`; x.lineWidth = 2; x.beginPath(); x.arc(u, v, 8 + ph * reach, 0, 7); x.stroke(); }
        x.fillStyle = "#17865B"; x.strokeStyle = bg; x.lineWidth = 2; x.fillRect(u - 6, v - 6, 12, 12); x.strokeRect(u - 6, v - 6, 12, 12); }
      if (d.state === "travel" && al) {                                        /* on the way: from the edge of the map to the alarm's spot */
        const [u, v] = P(al.xy[0], al.xy[1]), day0 = al.decDay == null ? j.arrive - 3 : al.decDay, f = Math.max(0, Math.min(1, (cur() + Math.min(1, (now - S.lastTick) / stepMs()) * (S.playing ? 1 : 0) - day0) / Math.max(1, j.arrive - day0)));
        const sx = u < w / 2 ? 16 : w - 16; x.strokeStyle = mixc([118, 136, 154], [118, 136, 154], n, .7); x.lineWidth = 1.5; x.setLineDash([3, 5]); x.beginPath(); x.moveTo(sx, v); x.lineTo(u, v); x.stroke(); x.setLineDash([]);
        marks.push(["crew", sx + (u - sx) * f, v, j.k]);
      }
    }
    if ($("s_names").checked) {
      x.font = "600 10.5px system-ui"; x.textAlign = "center"; x.textBaseline = "middle"; const used = D.sxy.map(q => { const [u, v] = P(q[0], q[1]); return [u - 9, v - 9, u + 9, v + 9]; }), c0 = selOn && !sel.zone_xy ? sel.xy : null, dl = selJob && selJob.list ? new Set(selJob.list) : null;
      const hot = p => dl ? dl.has(p[5]) : c0 && Math.hypot((p[0] + p[2]) / 2 - c0[0], (p[1] + p[3]) / 2 - c0[1]) <= 300;
      const order = D.pipes.filter(p => p[5]).map(p => [p, hot(p) ? 1 : 0, Math.hypot(p[2] - p[0], p[3] - p[1])]).sort((A, B) => (B[1] - A[1]) || (B[2] - A[2]));
      for (const [p, hp] of order) {
        const [u, v] = P((p[0] + p[2]) / 2, (p[1] + p[3]) / 2), tw = x.measureText(p[5]).width + 8, bx = [u - tw / 2, v - 8, u + tw / 2, v + 8];
        if (used.some(q => bx[0] < q[2] && bx[2] > q[0] && bx[1] < q[3] && bx[3] > q[1])) continue; used.push(bx);
        x.fillStyle = mixc([255, 255, 255], [10, 26, 41], n, .88); x.fillRect(bx[0], bx[1], tw, 16); x.fillStyle = hp ? "#E2532B" : mixc([68, 89, 107], [169, 185, 198], n); x.fillText(p[5], u, v + .5);
      }
    }
    const ch = D.chg[cur()] || [];
    D.sxy.forEach((q, i) => {                                                  /* pressure sensors: orange when their pressure has dropped */
      const [u, v] = P(q[0], q[1]), z = ch[i] || 0, m = Math.min(Math.abs(z), 9), drop = z <= -2;
      x.fillStyle = drop ? "#E2532B" : mixc([20, 99, 214], [111, 168, 245], n);
      if (drop) { x.globalAlpha = .2; x.beginPath(); x.arc(u, v, 7 + m * 1.7, 0, 7); x.fill(); x.globalAlpha = 1; }
      x.beginPath(); x.arc(u, v, 4.6 + (drop ? m * .35 : 0), 0, 7); x.fill(); x.strokeStyle = bg; x.lineWidth = 1.5; x.stroke();
    });
    for (const lk of S.leaks) if (lk.xy && !S.reveal) { const [u, v] = P(lk.xy[0], lk.xy[1]); diamond(x, u, v, 7, "rgba(116,72,200,.45)", bg); }
    x.font = "700 12px system-ui"; x.textAlign = "center"; x.textBaseline = "middle";
    for (const [al, k] of visible()) {                                         /* alarms */
      if (al.zone_xy && S.sel !== k) continue;
      const [u, v] = P(al.xy[0], al.xy[1]), on = S.sel === k, rv = hitOf(k);
      x.fillStyle = rv === true ? "#17865B" : rv === false ? "#A9B5BF" : al.dec ? mixc([68, 89, 107], [120, 140, 158], n) : "#E2532B";
      x.beginPath(); x.arc(u, v, on ? 13 : 10, 0, 7); x.fill(); x.strokeStyle = bg; x.lineWidth = on ? 3 : 1.5; x.stroke();
      if (on && !al.dec && !S.reveal) { const ph = (now / 1100) % 1; x.strokeStyle = `rgba(226,83,43,${0.8 * (1 - ph)})`; x.lineWidth = 2; x.beginPath(); x.arc(u, v, 13 + ph * 16, 0, 7); x.stroke(); S.dirty = true; }
      x.fillStyle = "#fff"; x.fillText(String(k + 1), u, v + .5);
    }
    for (const [kind, u, v, k, pulse] of marks) {
      if (kind === "crew") { x.fillStyle = ink; x.strokeStyle = bg; x.lineWidth = 2.5; x.beginPath(); x.arc(u, v, 11, 0, 7); x.fill(); x.stroke(); x.fillStyle = bg; x.font = "700 11px system-ui"; x.fillText("C" + (k + 1), u, v + .5); }
      else { const age = pulse ? (now - pulse) / 1000 : 9; if (age < 3.6) { const ph = (age % 1.2) / 1.2; x.strokeStyle = `rgba(23,134,91,${1 - ph})`; x.lineWidth = 3; x.beginPath(); x.arc(u, v, 14 + ph * 34, 0, 7); x.stroke(); }
        x.fillStyle = "#17865B"; x.strokeStyle = bg; x.lineWidth = 2.5; x.beginPath(); x.arc(u, v, 13, 0, 7); x.fill(); x.stroke(); x.strokeStyle = "#fff"; x.lineWidth = 2.6; x.beginPath(); x.moveTo(u - 5.5, v + .5); x.lineTo(u - 1.5, v + 4.5); x.lineTo(u + 6, v - 4); x.stroke(); }
    }
    if (S.reveal) { const L = live() ? S.reveal.leaks : D.truth; L.forEach((lk, i) => { const [u, v] = P(lk.xy[0], lk.xy[1]); diamond(x, u, v, 11, "#7448C8", bg); if (live()) { x.fillStyle = "#fff"; x.font = "700 10.5px system-ui"; x.fillText(String(i + 1), u, v + .5); } }); }
    const km = 300 * sc > 150 ? 100 : (M.s * 500 > w * .4 ? 200 : 500), bar = km * sc; x.strokeStyle = mixc([68, 89, 107], [169, 185, 198], n); x.lineWidth = 2; x.beginPath(); x.moveTo(w - 20 - bar, h - 18); x.lineTo(w - 20, h - 18); x.stroke();
    x.fillStyle = x.strokeStyle; x.font = "11px system-ui"; x.textAlign = "center"; x.textBaseline = "alphabetic"; x.fillText(km + " m", w - 20 - bar / 2, h - 25);
  }

  /* ---------------- the two charts of readings ---------------- */
  function axes(x, w, h, a, b, lo, hi) {
    const L = 30, R = 6, Tp = 5, B = 15, X = k => L + (b === a ? 0 : (k - a) / (b - a)) * (w - L - R), Y = v => Tp + (hi - v) / (hi - lo) * (h - Tp - B);
    x.font = "10.5px system-ui"; x.fillStyle = "#76889A"; x.strokeStyle = "#E6EBEF"; x.lineWidth = 1; x.textAlign = "left"; x.textBaseline = "alphabetic";
    for (const v of [lo, (lo + hi) / 2, hi]) { x.beginPath(); x.moveTo(L, Y(v)); x.lineTo(w - R, Y(v)); x.stroke(); x.fillText(Math.abs(v) >= 100 ? Math.round(v) : v.toFixed(1), 0, Y(v) + 3.5); }
    x.textAlign = "center"; const st = Math.max(1, Math.round((b - a) / 5));
    for (let k = a; k <= b; k += st) x.fillText(S.D.dates ? S.D.days[k].slice(5) : String(k), X(k), h - 2);
    return [X, Y, L, R];
  }
  const win = () => { const b = cur(), a = Math.max(0, b - (S.D.window || 45)); return [a, Math.max(b, a + 1)]; };
  function amarks(x, X, h, a, b) { x.setLineDash([4, 3]); x.lineWidth = 1.2; for (const [al, k] of visible()) if (al.i >= a && al.i <= b) { x.strokeStyle = S.sel === k ? "#0D2231" : "#E2532B"; x.beginPath(); x.moveTo(X(al.i), 5); x.lineTo(X(al.i), h - 15); x.stroke(); } x.setLineDash([]); }
  function drawRes() {
    const [x, w, h] = canvasCtx($("s_cres")); if (!S.D || w < 10 || !N()) return; const [a, b] = win(), e = cur(), M = S.D.res, band = S.D.band || 0.5;
    let lo = -band * 3, hi = band * 3; for (let k = a; k <= e; k++) for (const v of M[k]) if (v != null) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const pd = (hi - lo) * .06; lo = Math.floor((lo - pd) * 2) / 2; hi = Math.ceil((hi + pd) * 2) / 2; const [X, Y, L, R] = axes(x, w, h, a, b, lo, hi);
    x.fillStyle = "rgba(20,99,214,.09)"; x.fillRect(L, Y(band), w - L - R, Y(-band) - Y(band));
    const ch = S.D.chg[e] || [];
    for (let pass = 0; pass < 2; pass++) for (let j = 0; j < M[0].length; j++) {
      const hot = Math.abs(ch[j] || 0) >= 3; if (hot !== (pass === 1)) continue;
      x.strokeStyle = hot ? "#E2532B" : "rgba(20,99,214,.45)"; x.lineWidth = hot ? 2 : 1; x.beginPath();
      for (let k = a; k <= e; k++) { const v = M[k][j]; k === a ? x.moveTo(X(k), Y(v)) : x.lineTo(X(k), Y(v)); } x.stroke();
    }
    amarks(x, X, h, a, b);
  }
  function drawFlow() {
    const has = S.D && S.D.zones && S.D.zones.length; $("s_flowbox").hidden = !has; if (!has) return;
    const [x, w, h] = canvasCtx($("s_cflow")); if (w < 10 || !N()) return; const [a, b] = win(), e = cur(), F = S.D.flow, Z = S.D.zones;
    let lo = Infinity, hi = -Infinity; for (let k = a; k <= e; k++) for (const v of F[k]) if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    for (const z of Z) { const n = S.D.norm[z]; if (n != null) { lo = Math.min(lo, n); hi = Math.max(hi, n); } }
    if (!isFinite(lo)) return; const pd = Math.max((hi - lo) * .15, 1); lo -= pd; hi += pd; const [X, Y, L, R] = axes(x, w, h, a, b, lo, hi), col = ["#1463D6", "#0D2231", "#17865B", "#7448C8"];
    Z.forEach((z, j) => {
      const n = S.D.norm[z]; x.strokeStyle = col[j % 4];
      if (n != null) { x.globalAlpha = .5; x.lineWidth = 1; x.setLineDash([3, 3]); x.beginPath(); x.moveTo(L, Y(n)); x.lineTo(w - R, Y(n)); x.stroke(); x.setLineDash([]); x.globalAlpha = 1; }
      x.lineWidth = 2; x.beginPath(); let on = false;
      for (let k = a; k <= e; k++) { const v = F[k][j]; if (v == null) { on = false; continue; } on ? x.lineTo(X(k), Y(v)) : x.moveTo(X(k), Y(v)); on = true; } x.stroke();
    });
    amarks(x, X, h, a, b);
  }

  /* ---------------- the bar, the steps and the sentence ---------------- */
  function renderBar() {
    $("s_dayl").textContent = S.D && S.D.dates ? "" : t("s_dayl"); $("s_day").textContent = S.D ? (S.D.dates ? S.D.days[cur()] : cur()) : "–"; $("s_day").style.fontSize = S.D && S.D.dates ? "17px" : "";
    $("s_play").textContent = S.playing ? "❚❚ " + t("s_pause") : "▶ " + t("s_play"); $("s_play").disabled = S.ended || S.loading || !S.D || (S.mode === "year" && S.pos >= N() - 1);
    $("s_auto").hidden = !live() || S.ended; $("s_auto").textContent = S.auto ? t("s_auto_on") : "▶ " + t("s_auto"); $("s_auto").classList.toggle("on", S.auto);
    $("s_end").textContent = live() ? (S.ended ? t("s_new") : t("s_end")) : (S.reveal ? t("s_hide") : t("s_show")); $("s_end").disabled = S.loading || !S.D;
  }
  function renderTop() {
    const tw = S.more ? CFG.towns : CFG.main;
    $("s_towns").innerHTML = tw.map(k => `<button type="button" data-k="${k}" class="${k === S.town ? "on" : ""}">${t("town_" + k)}</button>`).join("") + (CFG.towns.length > CFG.main.length ? `<button type="button" data-more="1">${S.more ? "‹ " + t("s_less") : t("s_more") + " ›"}</button>` : "");
    $("s_mode").innerHTML = `<button type="button" data-m="live" class="${live() ? "on" : ""}">${t("s_live")}</button>` + (CFG.years.includes(S.town) ? `<button type="button" data-m="year" class="${!live() ? "on" : ""}">${t("s_year")}</button>` : "");
    $("s_speed").innerHTML = (live() ? [1, 2, 4] : [4, 8, 16]).map(v => `<button type="button" data-s="${v}" class="${v === S.speed ? "on" : ""}">${live() ? v : v / 4}×</button>`).join("");
    const lg = t("lg"), crew = live() && S.jobs.length, logg = crew && S.jobs.some(j => j.sweep), L = [["#1463D6", ""], ["#E2532B", ""], ["#E2532B", "al"], logg && ["#fff", "sq"], logg && ["#17865B", "sq"], logg && ["#A0D6BD", "ln"], crew && ["#E2532B", "ln"], crew && ["#17865B", "ln"], S.reveal && ["#7448C8", "di"]];
    $("s_legend").innerHTML = L.map((c, i) => c ? `<span><i class="${c[1]}" style="background:${c[0]}${c[0] === "#fff" ? ";border:1.5px solid #0D2231" : ""}${c[1] === "al" ? ";box-shadow:0 0 0 2px rgba(226,83,43,.3)" : ""}"></i>${lg[i]}</span>` : "").join("") + (logg && S.D && S.D.crew ? `<span>${t("lg_reach", { r: Math.round(S.D.crew.reach_m) })}</span>` : "");
    $("s_note").textContent = t(live() ? "s_note_live" : "s_note_year") + (S.town ? " " + t("note_" + S.town) : "") + (window.WGS && live() ? " " + t("wgs_note") + (WGS.info() ? " " + t("wgs_hash", { h: WGS.info().hashes["engine/detect_frozen_v5.py"].slice(0, 16), v: WGS.info().python }) : "") : "");
  }
  function stepNow() {
    if (!live()) return [S.reveal ? 2 : S.sel !== null ? 1 : 0, S.reveal ? "tru" : ""];
    if (S.ended) return [6, "tru"];
    const open = S.alarms.findIndex(a => !a.dec); if (open >= 0) return [3, "warm"];
    const L = lead(), c = L && cardOf(L.k);
    if (c && c.state !== "done") return [4, ""];
    if (c && c.found.length) return [5, "good"];
    return [S.leaks.length ? 1 : 0, ""];
  }
  function renderSteps() {
    const st = t(live() ? "s_steps" : "s_steps_year"), [on, c] = stepNow();
    $("s_steps").innerHTML = st.map((x, i) => `<li class="${i === on ? "on " + c : i < on ? "done" : ""}">${i + 1} · ${x}</li>`).join("");
  }
  function baseSay() {
    if (S.loading) return wgsNote() || t("say_load"); if (S.err) return S.err; if (!S.D) return "";
    if (!live()) { if (S.reveal) return t("say_year_rv"); const a = S.sel !== null && S.alarms[S.sel]; return a && a.i <= S.pos + 1e-6 ? t("say_year_al", { k: S.sel + 1, d: dayLabel(a.i) }) : t("say_year"); }
    if (S.ended) return t("say_end");
    const k = S.alarms.findIndex(a => !a.dec), day = cur();
    if (k >= 0) { const a = S.alarms[k]; return a.kind === "flow" ? t("say_alarm_flow", { k: k + 1, d: a.i, z: a.zone, q: a.size }) : t("say_alarm_p", { k: k + 1, d: a.i, n: a.node }); }
    const L = lead(), c = L && cardOf(L.k);
    if (c && c.state === "travel") return t("say_travel", { k: c.k + 1, d: c.arrive });
    if (c && c.state === "listen") return t("say_placed", { n: c.night, m: c.loggers.length });
    if (c && c.state === "move") return t("say_move", { c: c.cleared, a: c.first.n, w: c.done });
    if (c && c.state === "walk") return t("say_walk", { n: c.pipes.length, d: c.done });
    if (c && c.found.length && S.jobs.every(j => j.state === "done")) return t("say_done", { k: c.k + 1, f: c.found.length, m: fmt(c.m) });
    if (!S.leaks.length) return t("say_start");
    const d0 = Math.min(...S.leaks.map(l => l.day)), n = day - d0 + 1;
    return S.jobs.length ? t("say_watch", { d: day }) : n < 1 ? t("say_run0") : t("say_run", { d: day, n });
  }
  function renderSay() { $("s_say").textContent = S.say ? S.say(S.sayP) : baseSay(); }
  function renderTimeline() {
    const el = $("s_tline"); if (!S.D || !live()) { el.innerHTML = ""; el.hidden = !live(); return; } el.hidden = false;
    const day = cur(), max = Math.max(14, day + 2, ...S.jobs.map(j => j.state === "travel" ? j.arrive + 1 : 0)), X = d => `calc(22px + (100% - 44px) * ${d / max})`, tl = t("tl"), names = { leak: tl[0], alarm: tl[1], crew: tl[2], night: tl[3], fix: tl[4] }, seen = {};
    let h = `<div class="ax"><i style="width:${day / max * 100}%"></i></div>`; const st = max > 40 ? 10 : max > 20 ? 5 : 2;
    for (let d = 0; d <= max; d += st) h += `<span class="tk" style="left:${X(d)}">${d}</span>`;
    for (const m of S.tl.slice().sort((a, b) => a.day - b.day || a.k - b.k)) { const n = seen[m.day] = (seen[m.day] || 0) + 1; h += `<span class="mk ${m.c}" title="${esc(names[m.c])} · ${esc(t("s_dayn", { n: m.day }))}" style="left:calc(${X(m.day).slice(5, -1)} + ${(n - 1) * 17}px)">${m.s}</span>`; }
    el.innerHTML = h;
  }

  /* ---------------- the panel ---------------- */
  function renderLeak() {
    const c = $("s_leak");
    if (S.loading) { c.innerHTML = `<div class="card"><span class="spin"></span>${wgsNote() || t("say_load")}</div>`; return; }
    if (S.err) { c.innerHTML = `<div class="card"><p class="err">${esc(S.err)}</p><div class="acts"><button class="btn" id="s_retry" type="button">${t("s_retry")}</button></div></div>`; $("s_retry").onclick = () => start(); return; }
    if (!S.D || S.ended) { c.innerHTML = ""; return; }
    if (!live()) { c.innerHTML = `<div class="card"><h4>${t("ry_h")}</h4><p style="font-size:14.5px">${t("ry_p", { n: S.D.days.length, a: S.alarms.length })}</p></div>`; return; }
    if (S.auto) { c.innerHTML = `<div class="autob">${t("s_auto_note")}</div>`; return; }
    if (S.leaks.length && !S.leakOpen) { c.innerHTML = `<div class="row"><span class="tag blue">${t("lk_n", { n: S.leaks.length })}</span><span class="grow"></span><button class="btn" id="s_lkmore" type="button">+ ${t("lk_more")}</button></div>`; $("s_lkmore").onclick = () => { S.leakOpen = true; renderLeak(); }; return; }
    const d = S.D, line = () => t("lk_line", { c: cls(S.q), p: Math.round(S.q / d.demand * 100), m: fmt(S.q * 24) });
    c.innerHTML = `<div class="card lkcard"><h4>${t("lk_h")}<span>${S.leaks.length ? t("lk_n", { n: S.leaks.length }) : ""}</span></h4>
      <div class="sizeline"><label for="s_q">${t("lk_size")}</label><b dir="ltr" id="s_qv">${S.q.toFixed(1)} m³/h</b></div>
      <input type="range" id="s_q" min="${d.qmin}" max="${d.qmax}" step="0.1" value="${S.q}"><div class="hint" id="s_ql">${line()}</div>
      <div class="row" style="margin-top:10px"><button class="btn pri" id="s_hide" type="button">${t("lk_hide")}</button><button class="btn ${S.placing ? "on" : ""}" id="s_place" type="button">${S.placing ? t("lk_cancel") : t("lk_place")}</button></div></div>`;
    $("s_q").oninput = e => { S.q = parseFloat(e.target.value); $("s_qv").textContent = S.q.toFixed(1) + " m³/h"; $("s_ql").textContent = line(); };
    $("s_place").onclick = () => { S.placing = !S.placing; placingUI(); renderLeak(); };
    $("s_hide").onclick = () => leak(null);
  }
  function placingUI() { $("s_hint").hidden = !S.placing; $("s_hint").textContent = t("lk_click"); $("s_map").style.cursor = S.placing ? "crosshair" : ""; }
  async function leak(pt) {
    if (S.ended || !S.sid) return;
    try {
      await api("/api/shift/" + S.sid, Object.assign({ a: "leak", q: S.q }, pt ? { x: pt.x, y: pt.y } : {}));
      const day = cur() + 1; S.leaks.push({ day, q: S.q, xy: pt ? [pt.x, pt.y] : null }); S.tl.push({ day, c: "leak", s: "◆", k: 0 });
      S.events.push({ day: cur(), text: t(pt ? "lk_ev_place" : "lk_ev_rand", { q: S.q.toFixed(1) }) });
      S.placing = false; S.leakOpen = false; placingUI(); S.playing = true; S.dirty = true; renderAll();
    } catch (e) { S.err = e.message; renderLeak(); }
  }
  function statusOf(a, k) {
    const rv = hitOf(k); if (rv === true) return t(a.kind === "flow" ? "al_hit_zone" : "al_hit"); if (rv === false) return t("al_miss");
    if (!live()) return dayLabel(a.i); const c = cardOf(k); if (c) return t("cw_steps")[stIdx(c.state)];
    return a.dec ? t("dec_" + a.dec) : t("al_open");
  }
  function renderAlarms() {
    const v = visible(), c = $("s_alarms"); if (!S.D) { c.innerHTML = ""; return; }
    c.innerHTML = `<div class="card"><h4>${t("al_h")}<span>${v.length || ""}</span></h4>` + (v.length ? `<div class="atabs">${v.slice(live() ? 0 : Math.max(0, v.length - 12)).map(([a, k]) => `<button type="button" class="atab ${S.sel === k ? "on" : ""} ${hitOf(k) === true ? "hit" : hitOf(k) === false ? "miss" : a.dec || !live() ? "dec" : ""}" data-k="${k}"><b>${k + 1}</b>${statusOf(a, k)}</button>`).join("")}</div>` : `<div class="empty">${t(live() && !S.leaks.length ? "al_none0" : "al_none1")}</div>`) + `</div>`;
    c.querySelectorAll(".atab").forEach(b => b.onclick = () => { select(+b.dataset.k); renderAlarms(); renderSteps(); renderSay(); });
  }
  function select(k) { S.sel = k; S.dirty = true; renderFocus(); renderAlarms(); renderSay(); renderSteps(); const a = S.alarms[k]; if (live() && a && a.kind !== "flow" && a.act === undefined && !a._req) detail(k); }
  async function detail(k) {
    const a = S.alarms[k], gen = S.gen; a._req = true; renderFocus();
    try { const r = await api("/api/shift/" + S.sid, { a: "detail", k }); if (gen !== S.gen) return; a.act = r.detail.act; } catch (e) { a.act = null; }
    a._req = false; if (S.sel === k) renderFocus();
  }
  const bars = b => { const mx = Math.max(1, ...b.change.map(Math.abs)); return `<div class="mini">${b.change.map((v, i) => `<i class="${Math.abs(v) > 2 * b.noise[i] ? "hot" : ""}" style="height:${Math.max(6, Math.abs(v) / mx * 100)}%" title="${v} cm"></i>`).join("")}</div><p class="m">${t("f_bars")}</p>`; };
  const assume = () => t("cw_assume", { r: Math.round(S.D.crew.reach_m), l: S.D.crew.loggers, w: (S.D.crew.walk_m_day / 1000).toFixed(0) });
  function crewHTML(j) {
    const F = j.found, si = stIdx(j.state), names = t("cw_steps"), sweep = !!j.sweep, steps = sweep ? [0, 1, 2, 3] : [0, 2, 3], np = j.pipes.length;
    let line; if (j.state === "travel") line = t("cw_l_travel", { d: j.arrive });
    else if (j.state === "listen") line = t("cw_l_listen", { d: j.night, n: j.loggers.length, c: j.cleared, a: j.first.n });
    else if (j.state === "move") line = t("cw_l_move", { c: j.cleared, a: j.first.n, w: j.done });
    else if (j.state === "walk") line = t(j.kind === "isolate" ? "cw_l_dry" : "cw_l_walk", { d: j.done, n: np, p: esc(j.next || "–") });
    else line = F.length ? t("cw_l_done", { d: (j.finished != null ? j.finished : F[F.length - 1].day) - j.arrive + 1, f: F.length }) : t("cw_l_none", { a: j.first.n });
    const row = (c, lab, val, w, wait) => `<div class="fn ${c} ${wait ? "wait" : ""}"><div class="l"><span>${lab}</span><b>${val}</b></div><div class="t"><i style="width:${wait ? 0 : Math.max(0, Math.min(100, w))}%"></i></div></div>`;
    return `<div class="card crew ${F.length ? "found" : ""}"><h4>${t("cw_h")} · ${t("f_title", { k: j.k + 1 })}${j.rank ? `<span>${t("cw_rank", { r: j.rank, n: j.of })}</span>` : ""}</h4>
      <p class="cplan">${t(sweep ? "cw_plan_sweep" : j.kind === "isolate" ? "cw_plan_dry" : "cw_plan_walk")}</p>
      <ol class="cstep">${steps.map(i => `<li class="${i < si ? "done" : i === si ? "on" : ""}">${names[i]}</li>`).join("")}</ol>
      <div class="funnel">${row("a", t("cw_f1"), t("cw_pk", { n: j.first.n, km: (j.first.m / 1000).toFixed(1) }), 100)}
        ${sweep ? (j.night ? row("b", t("cw_f2"), t("cw_cl", { c: j.cleared, a: j.first.n }), j.cleared / j.first.n * 100) : row("b", t("cw_f2"), t("cw_wait"), 0, true)) : ""}
        ${j.m ? row("c", t("cw_f3b"), t("cw_pm", { n: j.done, m: fmt(j.m) }), j.m / j.first.m * 100) : row("c", t("cw_f3b"), t("cw_wait"), 0, true)}</div>
      ${F.length ? `<p class="cfound">✓ ${t("cw_fixed")}: <b>${F.map(f => esc(f.pipe)).join(", ")}</b></p>` : ""}
      <p class="cline">${line}</p>
      <p class="assume">${assume()}</p></div>`;
  }
  function alarmHTML(a, k, inner) {
    const flow = a.kind === "flow", kinds = t("kinds"), cf = a.confirm, act = a.act, rec = t("recs"), sec = (q, body) => `<div class="fsec"><div class="q">${q}</div>${body}</div>`;
    let h = inner ? "" : `<div class="ftitle">${t("f_title", { k: k + 1 })} · ${kinds[a.kind] || a.kind}</div><div class="fmeta">${dayLabel(a.i)} · ${flow ? t("f_zone", { z: a.zone }) : esc(a.node)}</div>`;
    let saw; if (flow) saw = t("f_saw_flow", { z: a.zone, q: a.size });
    else if (a.diag && a.diag.moved != null) saw = t(a.diag.single ? "f_saw_one" : "f_saw_many", { n: a.diag.moved });
    else if (a.bars) { const n = a.bars.change.filter((v, i) => Math.abs(v) > 2 * a.bars.noise[i]).length; saw = t(n <= 1 ? "f_saw_one" : "f_saw_many", { n }); }
    else saw = t("f_saw_early");
    h += sec(t("f_saw"), `<p>${saw}</p>${a.bars ? bars(a.bars) : ""}`);
    const np = a.plan ? a.plan.length : null, km = a.plan ? (a.plan.reduce((s, p) => s + p[1], 0) / 1000).toFixed(1) : null;
    h += sec(t("f_where"), `<p>${flow ? (np ? t("f_where_zone", { z: a.zone, n: np, km }) : t("f_saw_flow", { z: a.zone, q: a.size })) : np ? t("f_where_p", { node: esc(a.node), n: np, km }) : esc(a.node)}</p>${live() ? `<p class="m">${t(flow ? "f_plan_z" : "f_plan_p")}</p>${flow ? "" : `<p class="m">${t("f_order")}</p>`}` : ""}`);
    if (live() || cf) {
      let nt, meter = "";
      if (flow) nt = t("f_nt_zone"); else if (!cf || cf.untestable) nt = t("f_nt_un");
      else if (cf.q == null && cf.z == null) nt = t("f_nt_plan", { c: (cf.controls || []).join(", ") });
      else { nt = t(cf.ok ? "f_nt_ok" : "f_nt_no", { z: cf.z, c: (cf.controls || []).join(", "), d: cf.drop_here }); meter = `<div class="meter"><i class="${cf.ok ? "ok" : ""}" style="width:${Math.max(0, Math.min(100, cf.z / 6 * 100))}%"></i><u style="inset-inline-start:50%"></u></div><p class="m">${t("f_nt_scale")}</p>`; }
      h += sec(t("f_test"), `<p>${nt}</p>${meter}`);
    }
    if (a.prio && a.prio.m3day) h += sec(t("f_cost"), `<p>${t("f_cost_p", { m: fmt(a.prio.m3day), s: fmt(a.prio.m3day * SAR) })}</p><p class="m">${t("f_cost_s")}</p>`);
    if (live()) {
      if (!flow) {
        if (a._req) h += `<div class="fsec"><span class="spin"></span>${t("f_working")}</div>`;
        else if (act) {
          const r = act.rec, row = (key, lab, m3, cut) => `<tr class="${key === r || (key === "repair" && r === "recheck") ? "rec" : ""}"><td>${lab}</td><td>${m3}</td><td>${cut}</td></tr>`;
          h += sec(t("f_opts"), `<table class="opts"><tr>${t("f_cols").map(c => `<th>${c}</th>`).join("")}</tr>${row("repair", t("f_o_mon"), fmt(act.monitor), 0)}${act.ver ? row("pressure", t("f_o_low"), fmt(act.ver.m3day), 0) : ""}${act.iso ? row("isolate", t("f_o_iso"), 0, act.iso.junctions) : ""}</table>
            ${act.ver ? `<p class="m">${t(act.ver.ok ? "f_ver_ok" : "f_ver_no", { t: act.ver.tries })}</p>` : ""}<div class="advice"><small>${t("f_advice")}</small>${rec[r] || r}</div>`);
        }
      } else h += `<div class="fsec"><div class="advice"><small>${t("f_advice")}</small>${t("rec_zone")}</div></div>`;
      if (!S.ended && !a.dec) {
        const b = best(a), B = (cc, lab) => `<button type="button" class="btn block ${cc === b ? "rec" : ""}" data-c="${cc}"><span>${lab}</span>${cc === b ? `<span class="tag">${t("f_rec")}</span>` : ""}</button>`;
        h += sec(t("f_dec"), `<div class="acts">${B("crew", t("o_crew", { d: S.D.crew_days }))}${B("sched", t("o_sched", { d: S.D.sched_days }))}${!flow && act && act.ver ? B("lower_crew", t("o_lower", { d: S.D.sched_days })) : ""}${!flow && act && act.iso ? B("isolate", t("o_iso", { n: act.iso.junctions, d: S.D.crew_days })) : ""}${!flow && cf && !cf.untestable ? B("retest", t("o_retest")) : ""}${B("dismiss", t("o_dismiss"))}</div>`);
      } else if (a.dec && !inner) h += `<div class="chose">✓ ${t("dec_" + a.dec)}</div>`;
    }
    if (S.reveal) { const rv = hitOf(k), dd = live() ? (S.reveal.alarms[k] || {}).dist : a.dist; h += sec(t("f_truth"), `<p>${rv ? t(flow ? "f_truth_zone" : "f_truth_hit", { d: Math.round(dd || 0) }) : t(dd != null ? "f_truth_miss" : "f_truth_none", { d: Math.round(dd || 0) })}</p>`); }
    return h;
  }
  function renderFocus() {
    const c = $("s_focus"), k = S.sel, a = k !== null ? S.alarms[k] : null; if (!a || a.i > S.pos + 1e-6) { c.innerHTML = ""; return; }
    const j = live() ? cardOf(k) : null, open = c.querySelector("details.inner") && c.querySelector("details.inner").open;
    c.innerHTML = j ? crewHTML(j) + `<div class="card focus dec" style="margin-top:10px"><div class="ftitle">${t("f_title", { k: k + 1 })} · ${t("kinds")[a.kind] || a.kind}</div><div class="fmeta">${dayLabel(a.i)} · ${t("dec_" + (a.dec || "crew"))}</div><details class="inner" ${open ? "open" : ""}><summary>${t("f_more")}</summary>${alarmHTML(a, k, true)}</details></div>`
      : `<div class="card focus ${a.dec || !live() ? "dec" : ""}">${alarmHTML(a, k)}</div>`;
    c.querySelectorAll("[data-c]").forEach(b => b.onclick = () => choose(k, b.dataset.c));
  }
  async function choose(k, c, byAuto) {
    const a = S.alarms[k]; if (!byAuto) S.auto = false;
    try {
      const old = S.jobs, r = await api("/api/shift/" + S.sid, { a: "choose", k, c }); addEvents(r.events);
      if (r.retest) a.confirm = r.retest.confirm; if (r.detail) a.act = r.detail.act;
      if (c !== "retest") { a.dec = c; a.decDay = cur(); if (!S.alarms.some(x => !x.dec)) S.playing = true; }
      if (r.jobs) { const now = norm(r.jobs, cur()); planBeats(old, now); S.jobs = now; const j = jobOf(k); if (j && !old.some(o => o.k === k)) S.tl.push({ day: j.arrive, c: "crew", s: "▸", k: 2 }); S.tl = S.tl.filter((m, i, A) => A.findIndex(z => z.day === m.day && z.c === m.c && z.s === m.s) === i); }
      S.lastTick = performance.now(); renderAll();
    } catch (e) { S.err = e.message; renderLeak(); }
  }
  function renderLog() {
    const c = $("s_log"); if (!live() || !S.events.length) { c.hidden = true; return; } c.hidden = false; const open = c.open;
    c.innerHTML = `<summary>${t("s_log")} · ${S.events.length}</summary><div class="logl">${S.events.slice().reverse().map(e => `<div><b>${t("s_dayn", { n: e.day })}</b>${esc(e.text)}</div>`).join("")}</div>`; c.open = open;
  }
  async function end() {
    if (S.mode === "year") { S.reveal = S.reveal ? null : true; renderAll(); return; }
    if (S.ended) { start(); return; }
    if (!S.sid) return; S.auto = false; S.beats = [];
    try { const r = await api("/api/shift/" + S.sid, { a: "end" }); S.reveal = r.reveal; if (r.reveal.jobs) { S.jobs = r.reveal.jobs = norm(r.reveal.jobs, cur()); for (const j of S.jobs) { S.disp[j.k] = Object.assign(dispOf(j), { pulse: 0 }); S.card[j.k] = j; } } S.ended = true; S.playing = false; S.placing = false; S.say = null; placingUI(); renderAll(); $("s_panel").scrollTop = 0; }
    catch (e) { S.err = e.message; renderLeak(); }
  }
  function renderTruth() {
    const c = $("s_truth"); if (!S.reveal) { c.hidden = true; c.innerHTML = ""; return; } c.hidden = false;
    if (S.mode === "year") { const v = S.alarms, hit = v.filter(a => a.hit).length;
      c.innerHTML = `<div class="card truth"><h4>${t("tr_h")}</h4><div class="score"><div><b>${S.D.truth.length}</b><span>${t("ry_1")}</span></div><div><b>${v.length}</b><span>${t("ry_2")}</span></div><div><b>${hit}</b><span>${t("ry_3")}</span></div></div><p class="hint">${t("ry_note")}</p></div>`; return; }
    const L = S.reveal.leaks, A = S.reveal.alarms, J = S.reveal.jobs || [], found = L.filter(l => l.found != null).length, lost = L.reduce((s, l) => s + l.lost, 0), right = A.filter(x => x.hit).length, last = Math.max(1, cur());
    const X = d => Math.max(0, Math.min(100, d / last * 100));
    c.innerHTML = `<div class="card truth"><h4>${t("tr_h")}</h4><div class="score"><div><b>${found} / ${L.length}</b><span>${t("tr_1")}</span></div><div><b>${right} / ${A.length}</b><span>${t("tr_2")}</span></div><div><b>${fmt(lost)}</b><span>${t("tr_3")}</span></div></div>` +
      (L.length ? L.map((l, i) => { const e = l.end != null ? l.end : last, pts = [[l.start, "", t("tr_start") + " " + l.start]]; if (l.found != null) pts.push([l.found, "al", t("tr_alarm") + " " + l.found]); if (l.end != null) pts.push([l.end, "fx", t("tr_fix") + " " + l.end]);
        for (let q = 0; q < pts.length - 1; q++) if (X(pts[q + 1][0]) - X(pts[q][0]) < 30) { pts[q + 1][2] = pts[q][2] + " · " + pts[q + 1][2]; pts[q][2] = ""; }
        return `<div class="lrow"><div class="h">${t("tr_leak", { k: i + 1, q: l.q })}<span>${t("tr_lost", { m: fmt(l.lost) })}${l.end == null ? " · " + t("tr_running") : ""}${l.found == null ? " · " + t("tr_noalarm") : ""}</span></div>
          <div class="ltl"><i style="left:${X(l.start)}%;width:${X(e) - X(l.start)}%"></i>${pts.map(q => `<u class="${q[1]}" style="left:${X(q[0])}%">${q[2] ? `<em style="${X(q[0]) > 60 ? "left:auto;right:-7px;transform:none" : X(q[0]) < 40 ? "left:-7px;transform:none" : ""}">${q[2]}</em>` : ""}</u>`).join("")}</div></div>`; }).join("") : `<p class="hint">${t("tr_none")}</p>`) +
      (J.length ? `<h4 style="margin-top:12px">${t("tr_crews")}</h4><table class="rt"><tr>${t("tr_ccols").map(x => `<th>${x}</th>`).join("")}</tr>${J.map(j => { const F = j.found;
        return `<tr><td>${j.k + 1}</td><td>${j.first.n}</td><td>${j.sweep ? t("tr_sweep", { n: j.night }) : t("tr_walk")}</td><td>${fmt(j.m)} m</td><td>${F.length ? F.map(f => esc(f.pipe) + " · " + t("tr_cday", { d: f.day - j.arrive + 1 })).join("<br>") : j.state === "done" ? t("tr_cnone") : ""}${j.state !== "done" ? ` <span class="tag bad">${t("tr_copen")}</span>` : ""}</td></tr>`; }).join("")}</table>
        <p class="assume">${assume()}</p>` : "") +
      `<p class="hint" style="margin-top:8px">${t("tr_note")}</p><div class="acts"><button class="btn pri" id="s_again" type="button">${t("s_new")}</button></div></div>`;
    $("s_again").onclick = () => start();
  }
  function renderAll() { renderTop(); renderBar(); renderSteps(); renderSay(); renderTimeline(); renderTruth(); renderLeak(); renderAlarms(); renderFocus(); renderLog(); $("s_read").hidden = !S.D; S.dirty = true; }

  /* ---------------- wiring ---------------- */
  $("s_towns").onclick = e => { const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.more) { S.more = !S.more; if (!S.more && !CFG.main.includes(S.town)) { S.town = CFG.main[0]; start(); } else renderTop(); return; }
    if (b.dataset.k !== S.town) { S.town = b.dataset.k; if (S.mode === "year" && !CFG.years.includes(S.town)) S.mode = "live"; start(); } };
  $("s_mode").onclick = e => { const b = e.target.closest("button"); if (b && b.dataset.m !== S.mode) { S.mode = b.dataset.m; start(); } };
  $("s_speed").onclick = e => { const b = e.target.closest("button"); if (b) { S.speed = +b.dataset.s; renderTop(); } };
  $("s_play").onclick = () => { if (S.ended) return; S.auto = false; S.playing = !S.playing; S.last = performance.now(); renderBar(); renderLeak(); };
  $("s_auto").onclick = () => { S.auto = !S.auto; if (S.auto) { S.placing = false; placingUI(); } else S.playing = false; renderBar(); renderLeak(); };
  $("s_end").onclick = end;
  $("s_map").addEventListener("click", e => {
    if (!MT || !S.D) return; const r = $("s_map").getBoundingClientRect(), u = e.clientX - r.left, v = e.clientY - r.top;
    if (S.placing) { const [mx, my] = MT.inv(u, v); leak({ x: mx, y: my }); return; }
    let bestK = null, bd = 18; for (const [al, k] of visible()) { const [p, q] = MT.P(al.xy[0], al.xy[1]), d = Math.hypot(p - u, q - v); if (d < bd) { bd = d; bestK = k; } }
    if (bestK !== null) select(bestK);
  });
  $("s_names").onchange = () => { S.dirty = true; };
  $("s_map").addEventListener("mousemove", e => {
    const r = $("s_map").getBoundingClientRect(), u = e.clientX - r.left, v = e.clientY - r.top, p = S.placing ? null : pipeAt(u, v), tip = $("s_tip");
    if (!p) { tip.hidden = true; return; }
    tip.textContent = t(p[4] ? "s_pipe" : "s_pipe0", { n: p[5], d: p[4], l: Math.round(Math.hypot(p[2] - p[0], p[3] - p[1])) });
    tip.hidden = false; tip.style.left = Math.min(u + 14, r.width - tip.offsetWidth - 6) + "px"; tip.style.top = Math.max(6, v - 30) + "px";
  });
  $("s_map").addEventListener("mouseleave", () => { $("s_tip").hidden = true; });
  window.addEventListener("resize", () => { S.dirty = true; });
  window.addEventListener("keydown", e => { if (S.active && e.code === "Space" && !/INPUT|SELECT|BUTTON|TEXTAREA|SUMMARY/.test(document.activeElement.tagName)) { e.preventDefault(); $("s_play").click(); } });
  setInterval(() => frame(performance.now()), 33);
  return {
    enter(o) {
      S.active = true; if (!CFG.towns.length) return;
      const auto = !!(o && o.auto); if (auto) history.replaceState(null, "", "#/shift");
      if (!S.started || (auto && (S.ended || S.mode !== "live" || !S.leaks.length))) { S.started = true; if (!S.town) S.town = CFG.main[0] || CFG.towns[0]; if (auto) S.mode = "live"; start({ auto }); }
      else if (auto) { S.auto = true; renderBar(); renderLeak(); }
      S.last = performance.now(); S.dirty = true;
    },
    leave() { S.active = false; },
    texts() { if (S.started) renderAll(); },
    state: S,
  };
})();
