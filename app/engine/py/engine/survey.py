"""The field crew's survey of one alarm, for any town: which pipes to check, in what order, and how far the crew has got.

The order is NEAR, the rule frozen and tested as PT1 (engine/FROZEN_PT1.json): the pipe nearest to the alarm's located
junction first, by straight-line distance; pipes that meet at that junction come first of all, the longest ahead.
What PT1 showed on fresh years: this order beats a random one only modestly (median 2,261 m of pipe surveyed before the
leaking pipe, against 3,020 m), and the first pipe is almost never the leaking one. So the list is a walking order, not
a ranking by evidence, and the crew surveys the whole list.

Three plans were compared on the ten development years (engine/dev_crew.py, docs/plan_crew_19nov.md), judged by the
day on which the crew repairs the largest leak running in the alarm's list:
  WALK    walk the list in the NEAR order, RATE_M_DAY a day.
  LISTEN  acoustic loggers for a night, nearest the spot first (logger_sites: the same greedy rule as
          engine/pinpoint.loggers), moved on each night that none hears a leak ("lift and shift"); walk the pipes beside
          the logger that heard one; leave after the first repair. Dropped: it repaired the largest leak for only 68% of
          located alarms and 25% of zone alarms, because a town has several leaks running and the first one found is
          often not the one behind the alarm.
  SWEEP   as LISTEN, but the crew does not leave: it walks beside every logger that heard a leak and moves the loggers
          on until every site has been used.
ADOPTED (PLAN below, frozen as C1): a located alarm's 300 m circle is WALKED (median day 1 against day 2 for SWEEP: the
circle is small, and loggers cost a night); a zone alarm is SWEPT (median day 4 against day 6 for WALK, with a third of
the walking).

Assumed, not measured (settings below; published ranges in docs/crew_field_figures.md): a logger hears any running leak
on a pipe within REACH_M of it and nothing else; the crew surveys RATE_M_DAY metres of pipe a day and finds a leak when
it checks the leaking pipe. Used by the live shift (guardian_app/live.py); nothing here touches the detector."""
import math

RADIUS = 300.0          # m: a located alarm's search circle
RATE_M_DAY = 2000.0     # m of pipe surveyed by one crew in one day (assumed)
REACH_M = 100.0         # m: how far along the ground a logger hears a leak (assumed; 100-200 m on metal mains, less on plastic)
MAX_LOGGERS = 30        # loggers one crew carries and places in one night (assumed)
PLAN = dict(located="WALK", zone="SWEEP")     # the adopted plan per alarm type (development years; frozen as C1)


def near_order(spot, pipes, radius=RADIUS):
    """Pipes to survey, nearest first. spot: (x, y) of the alarm's junction. pipes: (name, x1, y1, x2, y2, length_m).
    radius=None keeps every pipe given (a zone alarm: the whole zone). Returns a list of (name, length_m)."""
    rows = []
    for name, x1, y1, x2, y2, length in pipes:
        dx, dy = x2 - x1, y2 - y1
        l2 = dx * dx + dy * dy
        k = max(0.0, min(1.0, ((spot[0] - x1) * dx + (spot[1] - y1) * dy) / l2)) if l2 else 0.0
        d = math.hypot(spot[0] - x1 - k * dx, spot[1] - y1 - k * dy)
        if radius is None or d <= radius:
            rows.append((0.0 if d < 0.6 else d, -math.sqrt(l2), str(name), float(length)))
    rows.sort(key=lambda r: (r[0], r[1]))
    return [(name, length) for _, _, name, length in rows]


def _to_segment(x, y, x1, y1, x2, y2):
    dx, dy = x2 - x1, y2 - y1
    l2 = dx * dx + dy * dy
    k = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / l2)) if l2 else 0.0
    return math.hypot(x - x1 - k * dx, y - y1 - k * dy)


def logger_sites(spot, pipes, reach=REACH_M):
    """Logger sites that cover a list of pipes (name, x1, y1, x2, y2, length): greedy, each new site is the pipe end that
    brings the most uncovered pipe within reach. Returned nearest to the spot first, each as dict(xy, pipes it covers)."""
    ends = sorted({(float(p[1]), float(p[2])) for p in pipes} | {(float(p[3]), float(p[4])) for p in pipes})
    cover = {e: {p[0] for p in pipes if _to_segment(e[0], e[1], *p[1:5]) <= reach} for e in ends}
    length = {p[0]: p[5] for p in pipes}
    gain = {e: sum(length[n] for n in cover[e]) for e in ends}
    got, sites = set(), []
    while len(got) < len(pipes):
        e = max(ends, key=gain.get)
        if gain[e] <= 0:
            break
        sites.append(dict(xy=[round(e[0], 1), round(e[1], 1)], pipes=cover[e]))
        new = cover[e] - got
        got |= new
        for f in ends:                                   # only sites that share a newly covered pipe lose gain
            if cover[f] & new:
                gain[f] = sum(length[n] for n in cover[f] - got)
    sites.sort(key=lambda s: math.hypot(s["xy"][0] - spot[0], s["xy"][1] - spot[1]))
    return sites


def crew_job(alarm, plan, arrive, kind, zone_alarm, spot, lines):
    """The crew job of the adopted plan. lines: (name, x1, y1, x2, y2, length) of the pipes in the plan. An isolated
    (dry) area is always walked: no logger hears a leak that does not flow."""
    if PLAN["zone" if zone_alarm else "located"] == "WALK" or kind == "isolate":
        return Job(alarm, plan, arrive, kind)
    return Job(alarm, plan, arrive, kind, logger_sites(spot, lines), sweep=True)


class Job:
    """One crew working on one alarm. Times are day numbers given by the caller.
    plan: (name, length) in survey order. sites: from logger_sites(), or None to walk the whole list without loggers."""

    def __init__(self, alarm, plan, arrive, kind="crew", sites=None, rate=RATE_M_DAY, loggers=MAX_LOGGERS, sweep=False):
        self.alarm, self.plan, self.arrive, self.kind, self.rate, self.loggers = alarm, list(plan), int(arrive), kind, float(rate), int(loggers)
        self.sweep = sweep               # True: do not leave after the first repair; listen on until every site has been used
        self.first = dict(n=len(self.plan), m=round(sum(length for _, length in self.plan)))   # the search as the alarm gave it
        self.sites = list(sites or [])   # logger sites not used yet
        self.out = []                    # loggers in the ground tonight
        self.heard = []                  # the sites that heard a leak at the last read and are not explained yet
        self.heard_xy = []               # the same sites for the map (kept after the leak is found)
        self.night = 0                   # logger nights so far
        self.nights = math.ceil(len(self.sites) / self.loggers) if self.sites else 0
        self.cleared = set()             # pipes cleared by silent loggers
        self.walk = None if self.sites else list(self.plan)      # the pipes the crew walks now, in order
        self.done = 0                    # pipes walked in the current patch
        self.past = []                   # pipes walked in earlier patches (a sweep walks several)
        self.metres = 0.0                # pipe walked
        self.found = []                  # one entry per leak found: pipe, its place in the walk, metres walked, day
        self.finished = None             # the day the job was completed

    @property
    def state(self):
        if self.finished is not None:
            return "done"
        return "walk" if self.walk is not None and (self.done or self.night or not self.nights) else "listen" if self.out else "travel"

    def step(self, day, leaking_pipes, find):
        """One day in the field. leaking_pipes: names of the pipes that carry a running leak now (what a logger can hear).
        find(pipe) -> the leaks on that pipe, which the crew repairs (may be empty). Returns the day's events as dicts
        with "e" in placed / heard / quiet / found / progress / done / none."""
        ev = []
        if day < self.arrive or self.finished is not None:
            return ev
        if self.walk is None:                                   # listening
            if self.out:                                        # this morning: read last night's loggers
                covered = set().union(*[s["pipes"] for s in self.out])
                self.heard = [s for s in self.out if leaking_pipes & s["pipes"]]
                self.out = []
                if self.heard:
                    self.heard_xy = [s["xy"] for s in self.heard]
                    near = set().union(*[s["pipes"] for s in self.heard])
                    self.cleared |= covered - near
                    self.walk = [(n, length) for n, length in self.plan if n in near]
                    ev.append(dict(e="heard", h=len(self.heard), n=len(self.walk), m=round(sum(length for _, length in self.walk)), c=len(self.cleared)))
                else:
                    self.cleared |= covered
                    ev.append(dict(e="quiet", c=len(self.cleared), left=self.first["n"] - len(self.cleared)))
            if self.walk is None:                               # this evening: the next sites
                self.sites = [s for s in self.sites if s["pipes"] - self.cleared]
                if self.sites:
                    self.out, self.sites = self.sites[:self.loggers], self.sites[self.loggers:]
                    self.night += 1
                    ev.append(dict(e="placed", n=len(self.out), night=self.night))
                    return ev
                self.walk = [(n, length) for n, length in self.plan if n not in self.cleared]     # no site left: walk what no logger covered
        before, budget, start = len(self.found), self.rate, self.done
        while self.done < len(self.walk) and budget > 0:
            name, length = self.walk[self.done]
            self.done += 1
            self.metres += length
            budget -= length
            for _ in find(name):
                self.found.append(dict(pipe=name, pos=self.done, m=round(self.metres), day=day))
            if len(self.found) > before and self.heard and not self.sweep:          # that leak explains the loggers beside it: walk on only for the others
                self.heard = [s for s in self.heard if name not in s["pipes"]]
                rest = set().union(*[s["pipes"] for s in self.heard]) if self.heard else set()
                self.walk = self.walk[:self.done] + [x for x in self.walk[self.done:] if x[0] in rest]
        for f in self.found[before:]:
            ev.append(dict(e="found", **f))
        if self.done >= len(self.walk):
            if (self.found and not self.sweep) or not self.sites:
                self.finished = day
                ev.append(dict(e="done" if self.found else "none", f=len(self.found)))
            else:                                               # sweep, or the heard leak was gone (repaired by another crew): keep listening
                self.cleared |= {n for n, _ in self.walk}
                self.past += [n for n, _ in self.walk]
                self.walk, self.done = None, 0
        elif len(self.found) == before and self.done > start:
            ev.append(dict(e="progress"))
        return ev

    def next_pipe(self):
        return self.walk[self.done][0] if self.walk is not None and self.done < len(self.walk) else None

    def view(self):
        """What the screen needs. The alarm already carries the first list; the walk list is sent once the loggers have cut it."""
        walk = [n for n, _ in (self.walk or [])]
        pipes = self.past + walk if (self.walk is not None or self.past) else None
        return dict(k=self.alarm, kind=self.kind, state=self.state, arrive=self.arrive, first=self.first, night=self.night, nights=self.nights,
                    loggers=[s["xy"] for s in self.out], heard=list(self.heard_xy), cleared=len(self.cleared - set(self.past)),
                    pipes=pipes, n=len(pipes or []), total=round(self.metres + sum(length for _, length in (self.walk or [])[self.done:])),
                    done=len(self.past) + self.done, m=round(self.metres), next=self.next_pipe(), found=list(self.found), finished=self.finished)
