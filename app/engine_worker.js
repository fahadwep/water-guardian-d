/* The engine inside the page (static build only; site/build_static.py). A Web Worker starts Python in the browser (Pyodide),
   loads the project's own files unchanged (engine/detect_frozen_v5.py, engine/survey.py, guardian_app/shift_core.py,
   guardian_app/pack_ctx.py, guardian_app/i18n.py) and a town's data pack, and answers the page's shift requests.
   No server is involved; nothing is sent anywhere. */
const PYODIDE = self.WG_PYODIDE || "https://cdn.jsdelivr.net/pyodide/v0.28.3/full/";
const FILES = ["engine/detect_frozen_v5.py", "engine/survey.py", "guardian_app/__init__.py", "guardian_app/i18n.py", "guardian_app/shift_core.py", "guardian_app/pack_ctx.py"];
let py = null, door = null, boot = null; const towns = {};
const say = (stage, extra) => postMessage(Object.assign({ progress: stage }, extra || {}));

async function start() {
  say("python");
  importScripts(PYODIDE + "pyodide.js");
  py = await loadPyodide({ indexURL: PYODIDE });
  say("packages");
  await py.loadPackage(["numpy", "pandas", "scipy", "scikit-learn"]);
  say("code");
  py.FS.mkdirTree("/wg/engine"); py.FS.mkdirTree("/wg/guardian_app");
  const hashes = {};
  for (const f of FILES) {
    const buf = new Uint8Array(await (await fetch("engine/py/" + f, { cache: "no-cache" })).arrayBuffer());
    py.FS.writeFile("/wg/" + f, buf);
    const h = await crypto.subtle.digest("SHA-256", buf); hashes[f] = Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  py.runPython("import sys\nsys.path.insert(0, '/wg'); sys.path.insert(0, '/wg/engine')");
  door = py.pyimport("guardian_app.pack_ctx");
  say("ready", { hashes, python: py.runPython("import sys, numpy, pandas; f'Python {sys.version.split()[0]}, numpy {numpy.__version__}, pandas {pandas.__version__}'") });
}

async function town(name) {
  if (!towns[name]) towns[name] = (async () => {
    say("town", { town: name });
    const [meta, pack] = await Promise.all([fetch("engine/packs/" + name + ".json").then(r => r.text()), fetch("engine/packs/" + name + ".npz").then(r => r.arrayBuffer())]);
    const b = py.toPy(new Uint8Array(pack)); door.load_town(meta, b); b.destroy();
  })();
  return towns[name];
}

onmessage = async e => {
  const { id, op, a } = e.data;
  try {
    if (!boot) boot = start();
    await boot;
    let out;
    if (op === "boot") out = "{}";
    else if (op === "new") { await town(a.town); say("commission", { town: a.town }); out = door.new_shift(a.town, a.lang, a.seed); }
    else if (op === "act") out = door.act(a.sid, JSON.stringify(a.body));
    else if (op === "sig") out = door.signature(a.sid);
    else throw new Error("unknown request");
    postMessage({ id, ok: JSON.parse(out) });
  } catch (err) { postMessage({ id, error: String(err && err.message || err) }); }
};
