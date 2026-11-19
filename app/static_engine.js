/* Static build only (site/build_static.py adds this file to the page): the page's requests go to files and to the engine
   in the browser (engine_worker.js) instead of a server. The full program (python control_room/server.py) does not load this. */
window.WGS = (() => {
  let worker = null, seq = 0, stage = null, info = null; const wait = new Map();
  function w() {
    if (!worker) {
      worker = new Worker("engine_worker.js");
      worker.onmessage = e => {
        const m = e.data;
        if (m.progress) { stage = m.progress; if (m.progress === "ready") info = m; window.dispatchEvent(new Event("wgs")); return; }
        const p = wait.get(m.id); if (!p) return; wait.delete(m.id);
        if (m.error) p.no(new Error(m.error)); else if (m.ok && m.ok.error) p.no(new Error(m.ok.error)); else p.yes(m.ok);
      };
      worker.onerror = e => { for (const p of wait.values()) p.no(new Error("the engine could not start in this browser: " + (e.message || "worker error"))); wait.clear(); };
    }
    return worker;
  }
  const ask = (op, a) => new Promise((yes, no) => { const id = ++seq; wait.set(id, { yes, no }); w().postMessage({ id, op, a }); });
  const file = async p => { const r = await fetch(p, { cache: "no-cache" }); if (!r.ok) throw new Error("not in this build"); return r.json(); };
  async function api(path, body) {
    if (path === "/api/config") return file("api/config.json");
    if (path === "/api/shift") return ask("new", { town: body.town, lang: body.lang, seed: Math.floor(Math.random() * 1073741824) });
    if (path.startsWith("/api/shift/")) return ask("act", { sid: path.slice(11), body });
    if (path.startsWith("/api/year/")) return file("api/year/" + path.slice(10) + ".json");
    if (path === "/api/run") return { id: body.town };
    if (path.startsWith("/api/run/")) return file("api/run/" + path.slice(9) + ".json");
    throw new Error("full program only");
  }
  /* The same scripted shift the build played on the laptop (same seed, same requests): do the alarms and repairs match? */
  async function selftest(town) {
    const T = await file("engine/packs/" + town + "_selftest.json"), r = await ask("new", { town, lang: "en", seed: T.seed }); let rv = null;
    for (const v of T.requests) { const o = await ask("act", { sid: r.sid, body: Object.assign({ lang: "en" }, v) }); if (o.reveal) rv = o.reveal; }
    const got = await ask("sig", { sid: r.sid }), same = JSON.stringify(got) === JSON.stringify(T.expect);
    return { town, same, requests: T.requests.length, alarms: got.alarms.length, repairs: got.repairs.length, got, expect: T.expect };
  }
  window.addEventListener("load", () => setTimeout(() => ask("boot").catch(() => { }), 600));   // start the engine while the visitor reads
  return { api, warm: () => ask("boot"), selftest, stage: () => stage, info: () => info };
})();
