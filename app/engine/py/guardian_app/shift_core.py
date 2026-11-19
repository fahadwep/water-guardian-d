"""The live control room: days are made one at a time and the frozen v5 detector judges only the days so far, so the future does not exist yet.
Leaks start when the operator starts them, and work orders change the following days. Readings are simulated in the twin's world (the leak's
twin pattern + recorded day-to-day noise, as instant mode), not real sensors. Assumed, not measured: a crew reaches any spot in CREW_DAYS, then
walks a located alarm's 300 m circle nearest pipe first (2 km of pipe a day); for a zone alarm it places 30 acoustic loggers a night, nearest the
spot first (a logger hears a leak on a pipe within 100 m), and walks the pipes beside each logger that heard one and repairs a leak when it checks the leaking pipe (engine/survey.py); a pressure plan scales the leak by the plan's own water ratio.

This file holds the shift itself and nothing that needs a server: it imports numpy, pandas, the frozen detector and
engine/survey.py only, so the same file runs in the control room's server and inside a browser (site/build_static.py).
What it needs from a town comes through `ctx` (guardian_app/core.Ctx on the server, a data pack in the browser):
  J, JI, sens, F, D, xy, zone_of, pipes, noise, Cn, Cnoise, demand, V5, nearest(x, y), plen(pipe), pdiam(pipe),
  test_plan(node) and Wp for the night test, act(node, q) for stages 6-8 (None where there is no hydraulic model)."""
import copy
import numpy as np, pandas as pd
import survey as SV
from detect_frozen_v5 import Guardian
from guardian_app.i18n import t, LANG


def rnd(M, n=1): return np.round(np.asarray(M, float), n).tolist()

def week_change(res):
    """Map colours: what changed this week (last 3 days vs the week before), in units of each sensor's usual wandering (as the year replay)."""
    Rw = res.rolling(3, min_periods=1).mean() - res.shift(4).rolling(7, min_periods=3).mean()
    noise = 1.4826 * (Rw - Rw.median()).abs().median()
    return (Rw / noise.clip(lower=0.3)).fillna(0).clip(-9, 9)

def band(res_cm): return float(np.nanmedian(1.4826 * (res_cm - res_cm.median()).abs().median()) * 2)     # about the usual day-to-day range

def change_bars(R, day, w=7):
    """Stage 2: each sensor's change (cm) over the last w days vs the w before, against its own noise."""
    i = R.index.get_loc(day); y = (R.iloc[i - w + 1:i + 1].mean() - R.iloc[i - 2 * w + 1:i - w + 1].mean()) * 100
    sig = (R.iloc[:28].diff().std() / np.sqrt(2)) * 100 * np.sqrt(2 / w)
    return pd.DataFrame(dict(sensor=R.columns, change=y.values, noise=sig.values))

def night_test(ctx, alarm_node, leak_node, q, seed=0):
    """Stage 3 in the twin world: the test lowers the zone's controls; the measured change is your leak's response plus
    test noise (1.5 cm per sensor per night, 3 nights); judged along the response a leak at the alarm's spot would give."""
    tpa = ctx.test_plan(alarm_node); tpl = ctx.test_plan(leak_node)
    if tpa is None: return dict(untestable=True)
    rng = np.random.default_rng(seed); C = np.linalg.inv(ctx.Wp)
    y = (tpl["g"] * q if tpl is not None else 0.0) + rng.multivariate_normal(np.zeros(len(C)), C)
    g = tpa["g"]; den = float(g @ ctx.Wp @ g); qhat = float(g @ ctx.Wp @ y) / den; z = qhat * np.sqrt(den)
    return dict(controls=tpa["controls"], drop_here=tpa["drop_here"], z=round(z, 1), q=round(qhat, 1), ok=bool(z > 3.0))


CREW_DAYS, SCHEDULED_DAYS = 3, 7
NCOM = 28

class Shift:
    def texts(self): return None            # the Streamlit page's own words (guardian_app/live.py)

    def __init__(self, ctx, spec, name, seed):
        self.ctx, self.spec, self.name = ctx, spec, name; self.rng = np.random.default_rng(seed)
        N = ctx.noise; self.N = N.values; self.i0 = int(self.rng.integers(0, max(1, len(N) - NCOM)))
        self.C = None; self.zones = []
        if ctx.Cn is not None: self.C = ctx.Cnoise.values; self.zones = list(ctx.Cnoise.columns)
        idx = [(self.i0 + i) % len(N) for i in range(NCOM)]
        self.dates = list(pd.date_range(N.index[self.i0], periods=NCOM)); self.R = [self.N[i].copy() for i in idx]; self.Cn = [self.C[i].copy() for i in idx] if self.C is not None else None
        self.base = np.median(np.array(self.R), axis=0); self.cbase = {z: float(np.nanmedian(np.array(self.Cn)[:, k])) for k, z in enumerate(self.zones)}
        self.g0 = Guardian(ctx.F, ctx.sens, ctx.J, ctx.zone_of, flow=self.C is not None, D=ctx.D, **ctx.V5); self.g0.commission(self.frame(), self.cframe())
        self.fresh = []; self.leaks = []; self.orders = []; self.alarms = []; self.keys = set(); self.events = []; self.rows = []; self.seq = 0; self.reply = None; self.ended = False
        self.jobs = []; xy = lambda n: ctx.xy[ctx.JI[n]]             # the crews' surveys; every pipe as (name, x1, y1, x2, y2, length) and its two ends
        self.ends = {str(p): (u, v) for u, v, p in ctx.pipes if u in ctx.JI and v in ctx.JI}
        self.lines = [(str(p), *xy(u), *xy(v), float(ctx.plen(p))) for u, v, p in ctx.pipes if u in ctx.JI and v in ctx.JI]
        self.day()

    def frame(self): return pd.DataFrame(np.array(self.R), index=pd.DatetimeIndex(self.dates), columns=self.ctx.sens)
    def cframe(self): return pd.DataFrame(np.array(self.Cn), index=pd.DatetimeIndex(self.dates), columns=self.zones) if self.Cn is not None else None
    def say(self, text, day=None): e = dict(day=len(self.rows) if day is None else day, text=text); self.events.append(e); self.fresh.append(e)

    def running(self): return [L for L in self.leaks if L["end"] is None]
    def inside(self, order):
        ctx = self.ctx
        if order.get("zone") is not None: return [L for L in self.running() if ctx.zone_of.get(L["node"]) == order["zone"]]
        return [L for L in self.running() if ctx.D[ctx.JI[order["node"]], ctx.JI[L["node"]]] <= 300]

    def day(self):
        """One new day: work orders arrive, the leaks and the noise make the reading, and Guardian judges everything so far. Returns its row and any new alarm."""
        ctx = self.ctx
        self.field()
        i = (self.i0 + NCOM + len(self.rows)) % len(self.N); y = self.N[i].copy(); c = self.C[i].copy() if self.C is not None else None
        for L in self.running():
            q = L["q"] * L["f"]; y = y + q * ctx.F[ctx.JI[L["node"]]]; L["lost"] += q * 24; zc = f"zone{ctx.zone_of.get(L['node'])}"
            if c is not None and zc in self.zones: c[self.zones.index(zc)] += q
        self.dates.append(self.dates[-1] + pd.Timedelta(days=1)); self.R.append(y)
        if c is not None: self.Cn.append(c)
        R = self.frame(); cn = self.cframe(); dist = lambda a, b: ctx.D[ctx.JI[a], ctx.JI[b]]
        res = (R.iloc[NCOM:] - self.base) * 100; chg = week_change(res).iloc[-1]
        row = dict(res=rnd((y - self.base) * 100), chg=rnd(chg.values), flow=[None if np.isnan(v) else round(float(v), 1) for v in c] if c is not None else [])
        self.rows.append(row)
        al, _, _ = copy.deepcopy(self.g0).run(R, dist=dist, Cn=cn); today = self.dates[-1]; new = []
        for a in al:
            key = (a["date"], a["node"], a.get("kind"))
            if a["date"] == today and key not in self.keys: self.keys.add(key); new.append(self.alarm(a, R))
        return row, new

    def field(self):
        """The crews' day: each crew that has arrived surveys its list in order and repairs the leaks on the pipes it checks."""
        today = len(self.rows)
        for o in list(self.orders):
            job = o["job"]; k = o["alarm"]
            def find(pipe):
                got = [L for L in self.running() if L["node"] in self.ends[pipe]]
                for L in got: L["end"] = today; L["found_by"] = k
                return got
            hear = {p for p, e in self.ends.items() for L in self.running() if L["f"] > 0 and L["node"] in e}      # an isolated leak does not flow, so no logger hears it
            for e in job.step(today, hear, find):
                a, n = k + 1, job.first["n"]
                if e["e"] == "placed": self.say(t("lv_e_log", k=a, n=e["n"], d=e["night"]))
                elif e["e"] == "heard": self.say(t("lv_e_heard", k=a, h=e["h"], a=n, n=e["n"], m=e["m"]))
                elif e["e"] == "quiet": self.say(t("lv_e_quiet", k=a, c=e["c"], a=n))
                elif e["e"] == "found": self.say(t("lv_e_found", k=a, p=e["pipe"], pos=e["pos"], m=e["m"], d=today - job.arrive + 1))
                elif e["e"] == "progress": self.say(t("lv_e_prog", k=a, a=job.done, n=len(job.walk), p=job.next_pipe()))
                elif e["e"] == "done": self.say(t("lv_e_done", k=a, f=e["f"], m=round(job.metres), d=today - job.arrive + 1))
                elif e["e"] == "none": self.say(t("lv_e_iso_none" if o.get("iso") else "lv_e_none", k=a, n=n))
            if job.finished is not None: self.orders.remove(o)

    def plan(self, node, zone=None):
        """The survey list of an alarm: the pipes inside its 300 m circle, or of its whole zone, nearest to the spot first."""
        ctx = self.ctx; lines = self.lines if zone is None else [p for p in self.lines if zone in (ctx.zone_of.get(self.ends[p[0]][0]), ctx.zone_of.get(self.ends[p[0]][1]))]
        return SV.near_order(ctx.xy[ctx.JI[node]], lines, SV.RADIUS if zone is None else None)

    def job_views(self, truth=False):
        """Every crew job for the screen, with its place in the queue by estimated water lost (largest first). truth=True (end of the
        shift only) adds, for a job still running, where in its order the nearest leak that is still running sits."""
        open_ = sorted((j for j in self.jobs if j.finished is None), key=lambda j: -self.alarms[j.alarm]["prio"]["m3day"]); out = []
        for j in self.jobs:
            v = j.view(); v["rank"] = open_.index(j) + 1 if j in open_ else None; v["of"] = len(open_)
            if truth and j.finished is None:
                nodes = {L["node"] for L in self.running()}; pos = [i + 1 for i, (p, _) in enumerate(j.plan) if nodes & set(self.ends[p])]
                v["leak_pos"] = min(pos) if pos else None
            out.append(v)
        return out

    def alarm(self, a, R):
        ctx = self.ctx; node = a["node"]; flow = a.get("kind") == "flow"; zone = a.get("zone", ctx.zone_of.get(node)); size = max(float(a.get("size") or 0), 0); est = size if size > 0.1 else 1.0
        XY = lambda n: [round(float(v), 1) for v in ctx.xy[ctx.JI[n]]]; m3 = round(est * 24)
        x = dict(i=len(self.rows) - 1, node=node, xy=XY(node), kind=a.get("kind"), size=round(size, 1), zone=None if zone is None else int(zone), diag=None, est=est, date=a["date"],
                 prio=dict(m3day=m3, cost=round(m3 * self.spec["price"]) if self.spec["price"] else None, currency=self.spec["currency"]), confirm=None if flow else self.test(node))
        if flow: x["zone_xy"] = [XY(n) for n in ctx.J if ctx.zone_of.get(n) == zone]; x["act"] = None
        else:
            x["area"] = [XY(n) for n in ctx.J if ctx.D[ctx.JI[node], ctx.JI[n]] <= 300]
            x["km"] = round(sum(ctx.plen(p) for u, v, p in ctx.pipes if ctx.JI.get(u) is not None and ctx.D[ctx.JI[node], ctx.JI[u]] <= 300) / 1000, 1)
        x["plan"] = [[p, round(L)] for p, L in self.plan(node, zone if flow else None)]
        b = change_bars(R, a["date"]); x["bars"] = dict(change=rnd(b.change.values), noise=rnd(b.noise.values))
        self.alarms.append(x); return x

    def test(self, node):
        """Stage 3: the night test on what is really leaking now (the nearest running leak; nothing, if nothing is)."""
        ctx = self.ctx; run = self.running(); L = min(run, key=lambda L: ctx.D[ctx.JI[node], ctx.JI[L["node"]]]) if run else None
        return night_test(ctx, node, L["node"] if L else node, L["q"] * L["f"] if L else 0.0, seed=int(self.rng.integers(1 << 30)))

    def view(self, x): return {k: v for k, v in x.items() if k not in ("est", "date", "rec0")}

    def order(self, k, kind, days):
        a = self.alarms[k]; o = dict(day=len(self.rows) - 1 + days, node=a["node"], zone=a["zone"] if a["kind"] == "flow" else None, alarm=k, kind=kind, iso=kind == "isolate")
        plan = [(p, L) for p, L in a["plan"]]; names = {p for p, _ in plan}        # the adopted plan: a located circle is walked, a zone is swept with loggers
        o["job"] = SV.crew_job(k, plan, o["day"], kind, a["kind"] == "flow", a["xy"], [x for x in self.lines if x[0] in names]); self.jobs.append(o["job"]); self.orders.append(o); return o

    def choose(self, k, c, how=None):
        a = self.alarms[k]; act = a.get("act") or {}; out = {}; today = len(self.rows) - 1; a["dec"], a["how"] = c, how
        if c in ("lower", "lower_crew") and not act.get("ver") or c == "isolate" and not act.get("iso"): return out   # this town has no such plan; the screen does not offer it
        if c == "crew": self.order(k, "crew", CREW_DAYS); self.say(t("lv_e_crew", k=k + 1, d=CREW_DAYS), today)
        elif c == "sched": self.order(k, "crew", SCHEDULED_DAYS); self.say(t("lv_e_sched", k=k + 1, d=SCHEDULED_DAYS), today)
        elif c in ("lower", "lower_crew"):
            v = act["ver"]; f = v["m3day"] / max(v["m3day0"], 1e-6); z = self.ctx.zone_of.get(a["node"])
            for L in self.running():
                if self.ctx.zone_of.get(L["node"]) == z: L["f"] = min(L["f"], f)
            self.say(t("lv_e_low", k=k + 1, p=round(100 * (1 - f))), today)
            if c == "lower_crew": self.order(k, "crew", SCHEDULED_DAYS); self.say(t("lv_e_sched", k=k + 1, d=SCHEDULED_DAYS), today)
        elif c == "isolate":
            for L in self.inside(dict(node=a["node"])): L["f"] = 0.0
            self.order(k, "isolate", CREW_DAYS); self.say(t("lv_e_iso", k=k + 1, n=act["iso"]["junctions"], d=CREW_DAYS), today)
        elif c == "retest":
            a["confirm"] = self.test(a["node"]); out["retest"] = dict(k=k, confirm=a["confirm"]); self.advise(a); out["detail"] = dict(k=k, act=a.get("act")); self.say(t("lv_e_test", k=k + 1, z=a["confirm"].get("z", "-")), today)
        elif c == "dismiss": self.say(t("lv_e_dismiss", k=k + 1), today)
        return out

    def advise(self, x):
        """The engine's rule 1: the night test ran and said no, so re-check first; a repeat test that says yes brings back stage 6's own advice."""
        if x.get("act"):
            c = x.get("confirm") or {}; x["act"] = dict(x["act"], rec="recheck" if c.get("z") is not None and c.get("ok") is False else x["rec0"])

    def start_leak(self, node, q):
        self.leaks.append(dict(node=node, q=float(q), f=1.0, start=len(self.rows), end=None, lost=0.0))

    def finish(self):
        """End of the shift: only now the browser receives where the leaks were."""
        ctx = self.ctx; XY = lambda n: [round(float(v), 1) for v in ctx.xy[ctx.JI[n]]]; res = []
        for x in self.alarms:
            act = [L for L in self.leaks if L["start"] <= x["i"] and (L["end"] is None or x["i"] <= L["end"])]; flow = x["kind"] == "flow"
            d = min((float(ctx.D[ctx.JI[x["node"]], ctx.JI[L["node"]]]) for L in act), default=None)
            hit = any(ctx.zone_of.get(L["node"]) == x["zone"] for L in act) if flow else (d is not None and d <= 300)
            res.append(dict(hit=bool(hit), dist=d))
        leaks = []
        for L in self.leaks:
            hits = [x["i"] for x, r in zip(self.alarms, res) if r["hit"] and x["i"] >= L["start"] and (x["kind"] == "flow" and x["zone"] == ctx.zone_of.get(L["node"]) or x["kind"] != "flow" and ctx.D[ctx.JI[x["node"]], ctx.JI[L["node"]]] <= 300)]
            leaks.append(dict(xy=XY(L["node"]), start=L["start"], q=round(L["q"], 1), end=L["end"], found=min(hits) if hits else None, lost=round(L["lost"])))
        self.ended = True
        return dict(alarms=res, leaks=leaks, jobs=self.job_views(truth=True))

    def init(self):
        ctx = self.ctx; XY = lambda n: [round(float(v), 1) for v in ctx.xy[ctx.JI[n]]]
        pipes = [[*XY(u), *XY(v), round(ctx.pdiam(p) * 1000), str(p)] for u, v, p in ctx.pipes if u in ctx.JI and v in ctx.JI]; dem = ctx.demand   # last value: the pipe's name in the model
        return dict(live=True, name=self.name, note=t("lv_note"), guide=t("lv_guide"), dates=False, days=[str(i) for i in range(len(self.rows))], sensors=list(ctx.sens), sxy=[XY(s) for s in ctx.sens], pipes=pipes,
                    res=[r["res"] for r in self.rows], chg=[r["chg"] for r in self.rows], flow=[r["flow"] for r in self.rows], band=round(band((pd.DataFrame(np.array(self.R[:NCOM]), columns=ctx.sens) - self.base) * 100), 1), zones=self.zones, norm=self.cbase,
                    alarms=[self.view(x) for x in self.alarms], events=self.events, truth=[], leak=None, window=45, speeds=[1, 2, 4, 8], speed=2, qmin=round(0.01 * dem, 1), qmax=round(0.2 * dem, 1), q=round(0.08 * dem, 1), crew_days=CREW_DAYS, sched_days=SCHEDULED_DAYS, survey_m_day=SV.RATE_M_DAY, jobs=self.job_views())

    def handle(self, v):
        """One request from the screen. Returns the reply; only new days go back, never days ahead of what was asked."""
        self.fresh = []; a = v.get("a"); out = dict(seq=v["seq"])
        if a == "hello":
            out["init"] = self.init(); out["text"] = self.texts()
            if self.ended: out["reveal"] = self.finish()
            return out
        if a == "tick":
            days = []; alarms = []
            for _ in range(max(1, min(int(v.get("n", 1)), 8))):
                row, new = self.day(); days.append(row); alarms += new
                if new: break
            out.update(days=days, alarms=[self.view(x) for x in alarms])
        elif a == "leak":
            ctx = self.ctx; node = ctx.nearest(float(v["x"]), float(v["y"])) if v.get("x") is not None else str(self.rng.choice(ctx.J))
            self.start_leak(node, v["q"]); out["ok"] = "leak"
        elif a == "detail":
            k = int(v["k"]); x = self.alarms[k]
            if x.get("act") is None and x["kind"] != "flow" and "act" not in x:
                x["act"] = self.ctx.act(x["node"], x["est"])          # stages 6-8 need the hydraulic model: None where there is none (the engine in the browser)
                x["rec0"] = (x["act"] or {}).get("rec"); self.advise(x)
            out["detail"] = dict(k=k, act=x.get("act"))
        elif a == "choose": out.update(self.choose(int(v["k"]), v["c"], v.get("how"))); out["ok"] = "choose"
        elif a == "end": out["reveal"] = self.finish()
        out["events"] = self.fresh; out["jobs"] = self.job_views()
        return out


# ---- one shift behind a request/reply door: used by the control room's server and by the engine in the browser ----
CHOICES = ("crew", "sched", "lower", "lower_crew", "isolate", "retest", "dismiss")

def crew_extras(sh, views):
    """More of each crew's own state for the screen (engine/survey.Job): which pipes the silent loggers cleared (walked
    pipes are not counted as cleared, as in the job's own view), which pipes tonight's loggers cover, and whether the job
    uses loggers at all (a located alarm's circle is walked; a zone is swept). Read from the job; nothing is decided here."""
    for v, j in zip(views or [], sh.jobs):
        v["cleared_pipes"] = sorted(j.cleared - set(j.past))
        v["tonight"] = sorted(set().union(*[s["pipes"] for s in j.out])) if j.out else []
        v["sweep"] = bool(j.sweep)
    return views

def reveal_extras(sh, rv):
    """End of the shift only: which alarm's crew repaired each leak."""
    for x, L in zip(rv.get("leaks") or [], sh.leaks): x["by"] = L.get("found_by")
    crew_extras(sh, rv.get("jobs"))

def open_shift(sh):
    """The first reply of a new shift for the control room page."""
    ctx = sh.ctx; init = sh.init()
    for k in ("note", "guide", "name"): init.pop(k, None)          # the page has its own words
    init["demand"] = round(float(ctx.demand), 1); init["junctions"] = len(ctx.J)
    init["km"] = round(sum(p[5] for p in sh.lines) / 1000, 1)
    init["crew"] = dict(reach_m=SV.REACH_M, loggers=SV.MAX_LOGGERS, walk_m_day=SV.RATE_M_DAY, radius_m=SV.RADIUS, plan=dict(SV.PLAN))   # the crew mode's assumed settings, shown on the page as assumptions
    return init

def act(sh, seq, v):
    """One request from the control room page, checked. Returns the reply (or dict(error=...))."""
    a = v.get("a")
    if a not in ("tick", "leak", "detail", "choose", "end"): return dict(error="unknown action")
    q = dict(a=a, seq=seq)
    if a == "tick": q["n"] = int(v.get("n", 1))
    elif a == "leak":
        dem = float(sh.ctx.demand); q["q"] = float(min(max(float(v.get("q", 0.08 * dem)), round(0.01 * dem, 1)), round(0.2 * dem, 1)))       # 1-20% of the town's demand, as the old page
        if v.get("x") is not None: q["x"], q["y"] = float(v["x"]), float(v["y"])
    elif a in ("detail", "choose"):
        k = int(v.get("k", -1))
        if not 0 <= k < len(sh.alarms): return dict(error="no such alarm")
        q["k"] = k
        if a == "choose":
            if v.get("c") not in CHOICES: return dict(error="unknown choice")
            q["c"] = v["c"]
    if sh.ended and a != "end": return dict(error="shift ended")
    out = sh.handle(q)
    out["crews"] = len(sh.orders); out["day"] = len(sh.rows) - 1
    crew_extras(sh, out.get("jobs"))
    if out.get("reveal"): reveal_extras(sh, out["reveal"])
    return out
