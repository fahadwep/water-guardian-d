"""A town for the live shift, read from a data pack instead of the hydraulic model, and the door the browser knocks on.

The control room's server builds a town with guardian_app/core.Ctx (EPANET twin, stages 2-8). A browser has no EPANET,
so site/export_engine_pack.py writes down what a shift needs from the town (the twin's leak patterns, recorded
day-to-day noise, pipe distances, the night-test responses of every junction) and this file hands it to the SAME shift
code (guardian_app/shift_core.py) and the SAME frozen detector (engine/detect_frozen_v5.py).
Not available without the model: stages 6-8 (pressure plan, isolation, second-model check); act() returns None.
Needs numpy and pandas only."""
import io, json, math
import numpy as np, pandas as pd
from guardian_app import shift_core
from guardian_app.i18n import LANG


class PackCtx:
    def __init__(self, meta, arrays):
        """meta: the pack's JSON as a dict. arrays: the pack's .npz (a mapping of arrays)."""
        self.town = meta["town"]; self.J = list(meta["J"]); self.JI = {n: i for i, n in enumerate(self.J)}; self.sens = list(meta["sens"])
        self.zone_of = dict(zip(self.J, meta["zone_of"])); self.demand = float(meta["demand"]); self.V5 = dict(meta["V5"])
        self.spec = dict(price=meta["price"], currency=meta["currency"])
        self.pipes = [(u, v, name) for u, v, name, _, _ in meta["pipes"]]
        self._len = {name: float(L) for _, _, name, L, _ in meta["pipes"]}; self._diam = {name: float(d) for _, _, name, _, d in meta["pipes"]}
        self.F = np.asarray(arrays["F"], float); self.D = np.asarray(arrays["D"], float); self.xy = np.asarray(arrays["xy"], float)
        idx = pd.DatetimeIndex(meta["noise_index"])
        self.noise = pd.DataFrame(np.asarray(arrays["noise"], float), index=idx, columns=self.sens)
        self.Cn = self.Cnoise = None
        if meta.get("zones"):
            self.Cnoise = pd.DataFrame(np.asarray(arrays["Cnoise"], float), index=idx, columns=meta["zones"]); self.Cn = self.Cnoise
        self.Wp = np.asarray(arrays["Wp"], float)
        self._g = np.asarray(arrays["tp_g"], float); self._ok = np.asarray(arrays["tp_ok"], bool); self._drop = np.asarray(arrays["tp_drop"], float)
        self._controls = meta["tp_controls"]

    def nearest(self, x, y): return self.J[int(np.argmin(np.hypot(self.xy[:, 0] - x, self.xy[:, 1] - y)))]
    def plen(self, pipe): return self._len[str(pipe)]
    def pdiam(self, pipe): return self._diam[str(pipe)]
    def test_plan(self, node):
        j = self.JI[node]
        return dict(g=self._g[j], controls=self._controls[j], drop_here=round(float(self._drop[j]), 1)) if self._ok[j] else None
    def act(self, node, q): return None


def clean(o):
    """JSON-safe: numpy numbers, timestamps and NaN."""
    if isinstance(o, dict): return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple, set)): return [clean(v) for v in o]
    if isinstance(o, np.ndarray): return clean(o.tolist())
    if isinstance(o, (np.bool_,)): return bool(o)
    if isinstance(o, (np.integer,)): return int(o)
    if isinstance(o, (float, np.floating)): return None if (math.isnan(o) or math.isinf(o)) else float(o)
    if isinstance(o, (pd.Timestamp,)): return str(o.date())
    return o


# ---- the door: JSON text in, JSON text out (called from the page's worker; also from site/test_pack.py) ----
TOWNS, SHIFTS = {}, {}

def load_town(meta_json, npz_bytes):
    meta = json.loads(meta_json); TOWNS[meta["town"]] = PackCtx(meta, np.load(io.BytesIO(bytes(npz_bytes)))); return meta["town"]

def new_shift(town, lang, seed):
    LANG["v"] = "ar" if lang == "ar" else "en"; ctx = TOWNS[town]
    sh = shift_core.Shift(ctx, ctx.spec, town, int(seed)); sid = f"s{len(SHIFTS) + 1}"; SHIFTS[sid] = dict(sh=sh, seq=1)
    return json.dumps(clean(dict(sid=sid, init=shift_core.open_shift(sh))), ensure_ascii=False)

def act(sid, body_json):
    s = SHIFTS.get(sid)
    if s is None: return json.dumps(dict(error="shift not found; start a new one"))
    v = json.loads(body_json); LANG["v"] = "ar" if v.get("lang") == "ar" else "en"; s["seq"] += 1
    return json.dumps(clean(shift_core.act(s["sh"], s["seq"], v)), ensure_ascii=False)

def signature(sid):
    """What a shift produced, for the self-test: its alarms (day, junction, kind) and its repairs (alarm, pipe, day)."""
    sh = SHIFTS[sid]["sh"]
    return json.dumps(clean(dict(alarms=[[x["i"], x["node"], x["kind"]] for x in sh.alarms], repairs=[[j.alarm, f["pipe"], f["day"]] for j in sh.jobs for f in j.found])))
