"""Guardian detection on twin residuals (town-agnostic).
Reference = twin's healthy state from commissioning + every event Guardian has recorded since (leaks found, repairs).
It never drifts with time, so slow leaks accumulate instead of hiding."""
import numpy as np, pandas as pd
from sklearn.covariance import LedoitWolf
class Guardian:
    def __init__(self,F,sens,junctions,zone_of,fa_per_year=2.0,commission=28,persist=2,scales=(1,3,7),cool=5,lag=1,seed=0,k_nuis=0,ref_mode="fixed",win=14,autocorr=False,flow=False,fk=1.0,fh=8.0,hmult=1.0,loc_mode="argmax",D=None,temp=1.0,
                 fast=0.0,long_scales=(),refine=0,conf=150.0,health=0.0,multi=0.0,reloc=0,osc=0,osc_proj=False,rl_persist=2,growth_report=True,absorb="all",cool_r=0.0,repair_flow=0.0):
        """v4 options (all off by default, so defaults reproduce v3):
        fast: report after one night if the evidence exceeds fast x threshold (big abrupt leaks).
        long_scales: extra averaging windows in nights (e.g. 14, 28) for slowly growing leaks; their noise inflation
                     comes from an AR(1) fit to commissioning, since 28 nights cannot measure a 28-night average directly.
        refine/conf: after a pressure alarm, keep collecting nights (up to `refine`) until the expected pipe distance
                     around the chosen location is below `conf` m, then report.
        health: sensor health check. A fault at one sensor (drift, jump) is a better explanation than any leak when
                its single-sensor evidence exceeds `health` x the best leak evidence (and its own false-alarm threshold)
                for `persist` days; the sensor is then flagged and projected out of all later matching.
        multi: at a leak alarm, also fit two leaks jointly; report both when the second one's evidence exceeds
               multi x threshold and they are more than 300 m apart (overlapping leaks).
        reloc: every `reloc` nights, refit all open cases jointly to the total change since commissioning; move a case
               whose best location shifted more than 300 m on `rl_persist` checks in a row (issued as a corrected report).
        osc: anti-loop. A spot (300 m) that flips between leak alarm and repair `osc` times within 60 nights is one
             oscillating feature: its later alarms/repairs are absorbed silently (osc_proj=True also projects its
             fingerprint out; that blinds nearby leaks and scored 25% on 2019).
        growth_report: False records "known leak grew" as an update (in events) instead of a new report.
        absorb: "all" (v3/v4) moves the reference by the whole recent change at each event; "fit" moves it only by the
                fitted leak/repair pattern, so other leaks' beginnings are not erased.
        cool_r: if > 0, the cool-down after an event only applies within cool_r metres of that event.
        repair_flow: if > 0 and flow is metered, a pressure rise only closes a case when the zone's night flow fell by
                     at least repair_flow x that case's size over the same nights (a real repair stops water); otherwise
                     it is absorbed as noise and the case stays open."""
        self.F=F; self.sens=sens; self.J=junctions; self.zone_of=zone_of; self.fa=fa_per_year
        self.ncom=commission; self.persist=persist; self.scales=tuple(scales)+tuple(long_scales); self.cool=cool; self.lag=lag; self.rng=np.random.default_rng(seed); self.k_nuis=k_nuis; self.ref_mode=ref_mode; self.win=win; self.autocorr=autocorr; self.flow=flow; self.fk=fk; self.fh=fh; self.hmult=hmult; self.loc_mode=loc_mode; self.D=D; self.temp=temp
        self.fast=fast; self.long_scales=tuple(long_scales); self.refine=refine; self.conf=conf; self.health=health; self.multi=multi; self.reloc=reloc; self.osc=osc; self.osc_proj=osc_proj; self.rl_persist=rl_persist; self.growth_report=growth_report; self.absorb=absorb; self.cool_r=cool_r; self.repair_flow=repair_flow
    def commission(self,R,Cn):
        n=self.ncom
        if self.flow and Cn is not None:
            Cn=Cn.reindex(R.index)
            self.dowc=pd.DataFrame({d:Cn.iloc[:n][Cn.index[:n].dayofweek==d].median() for d in range(7)}).T
            E=Cn-self.dowc.loc[Cn.index.dayofweek].values; De=E.iloc[:n].diff().dropna()/np.sqrt(2)
            self.fsig=(1.4826*(De-De.median()).abs().median()).clip(lower=0.5)
        self.dow=pd.DataFrame({d:R.iloc[:n][R.index[:n].dayofweek==d].median() for d in range(7)}).T
        Y=R-self.dow.loc[R.index.dayofweek].values
        D=(Y.iloc[:n].diff(self.lag).dropna().values)/np.sqrt(2)
        self.S=LedoitWolf().fit(D).covariance_; self.W=np.linalg.inv(self.S)
        # learned 'normal variability' directions from commissioning (whitened PCA), removed before matching
        self.P=np.eye(len(self.sens)); self.N0=np.zeros((len(self.sens),0)); self.bad=[]; self.oscF=[]
        if self.k_nuis:
            Lw=np.linalg.cholesky(self.W); Dw=D@Lw
            _,_,Vt=np.linalg.svd(Dw-Dw.mean(0),full_matrices=False)
            N=np.linalg.solve(Lw.T,Vt[:self.k_nuis].T)   # back to sensor space
            self.P=np.eye(len(self.sens))-N@np.linalg.solve(N.T@self.W@N,N.T@self.W); self.N0=N
        self.Fp=self.F@self.P.T
        self.FW=self.Fp@self.W; self.den=np.einsum("ij,ij->i",self.FW,self.Fp); self.ok=self.den>np.quantile(self.den,0.1)
        # autocorrelation: how much noisier a multi-night average is than independent nights would be (from commissioning)
        self.infl={s:1.0 for s in self.scales}
        if self.autocorr:
            Yc=Y.iloc[:n].values; Yc=Yc-np.nanmedian(Yc,0)
            for s_ in self.scales:
                if s_==1 or s_ in self.long_scales: continue
                m=np.array([np.nanmean(Yc[i:i+s_],0) for i in range(0,n-s_+1)])
                v1=np.nanvar(Yc,0).sum(); vs=np.nanvar(m,0).sum()
                self.infl[s_]=float(max(1.0,vs/(v1/s_)))
        if self.long_scales:
            Yc=Y.iloc[:n].values; Yc=Yc-np.nanmedian(Yc,0)
            phi=float(np.clip(np.nansum(Yc[1:]*Yc[:-1])/np.nansum(Yc[:-1]**2),0,0.95))   # pooled lag-1 autocorrelation
            for s_ in self.long_scales:   # variance of an s-night mean of AR(1) noise, relative to independent nights
                k=np.arange(1,s_); self.infl[s_]=float(max(1.0,1+2*np.sum((1-k/s_)*phi**k)))
            self.phi=phi
        L=np.linalg.cholesky(self.S); Z=(self.rng.standard_normal((40000,len(self.sens)))@L.T)@self.P.T
        num=Z@self.FW.T; g=np.where(num>0,num**2/self.den,0)[:,self.ok].max(1)
        self.h=self.hmult*float(np.quantile(g,1-(self.fa/365/len(self.scales))**(1/self.persist)))
        if self.health:   # same false-alarm budget for the single-sensor fault statistic
            gf=((Z@self.W)**2/np.diag(self.W)).max(1)
            self.hf=float(np.quantile(gf,1-(self.fa/365/len(self.scales))**(1/self.persist)))
    def _reproject(self):
        """Remove flagged sensors (and the learned nuisance directions) from leak matching."""
        E=np.eye(len(self.sens))[:,self.bad]; N=np.hstack([self.N0,E]+[np.array(self.oscF).T] if self.oscF else [self.N0,E])
        self.P=np.eye(len(self.sens))-N@np.linalg.solve(N.T@self.W@N,N.T@self.W)
        self.Fp=self.F@self.P.T; self.FW=self.Fp@self.W; self.den=np.maximum(np.einsum("ij,ij->i",self.FW,self.Fp),1e-12)
    def snr(self): return float(np.median(np.sqrt(self.den[self.ok])))
    def glr(self,y,sign=+1):
        num=sign*(self.FW@(self.P@y)); a=num/self.den; g=np.where(a>0,a*num,0); g[~self.ok]=0
        j=int(np.argmax(g))
        if self.loc_mode=="bayes" and self.D is not None and g[j]>0:
            w=np.exp((g-g[j])/(2*self.temp)); w[~self.ok]=0; w/=w.sum()
            jj=int(np.argmin(self.D@w))            # location minimising expected pipe distance
            return float(g[j]),jj,float(a[j])
        return float(g[j]),j,float(a[j])
    def omp(self,y,K,fixed=()):
        """Fit y with up to K non-negative leak fingerprints (W-metric matching pursuit). Returns atoms, sizes, and the
        drop in misfit each atom brings (its evidence, comparable to the single-leak statistic)."""
        from scipy.optimize import nnls
        if not hasattr(self,"_Lw"): self._Lw=np.linalg.cholesky(self.W)
        yp=self.P@y; sel=list(fixed); x=np.zeros(len(sel))
        def fit(sel):
            if not sel: return np.zeros(0),float(yp@self.W@yp)
            A=self.Fp[sel].T; x,_=nnls(self._Lw.T@A,self._Lw.T@yp); r=yp-A@x; return x,float(r@self.W@r)
        x,chi=fit(sel)
        while len(sel)<K:
            r=yp-(self.Fp[sel].T@x if sel else 0); num=self.FW@r; a=num/self.den; g=np.where(a>0,a*num,0); g[~self.ok]=0; g[sel]=0
            j=int(np.argmax(g))
            if g[j]<=0: break
            sel.append(j); x,chi=fit(sel)
        gain=[fit([k for k in sel if k!=j])[1]-chi for j in sel]
        return sel,x,gain
    def spread(self,y,j):
        """Expected pipe distance (m) from junction j under the location posterior for evidence y (refine step)."""
        if self.D is None: return 0.0
        num=self.FW@(self.P@y); a=num/self.den; g=np.where(a>0,a*num,0); g[~self.ok]=0
        w=np.exp((g-g.max())/(2*self.temp)); w[~self.ok]=0; w/=w.sum()
        return float(self.D[j]@w)
    def run(self,R,dist=None,start=None,Cn=None):
        Y=R-self.dow.loc[R.index.dayofweek].values
        useflow=self.flow and Cn is not None
        if useflow:
            Cn=Cn.reindex(R.index); E=Cn-self.dowc.loc[Cn.index.dayofweek].values; cus={z:0.0 for z in E.columns}
        ref=np.nanmedian(Y.iloc[:self.ncom].values,0); ref0=ref.copy(); last_rl=0; flips=[]; osc_sites=[]
        known=[]; alarms=[]; events=[]; cnt={+1:0,-1:0}; last=-99; hist=[]; last_ev=0; pend=None; fcnt=0; last_j=None
        def flip(day,j):
            """Record a leak/repair flip at junction j; True if j is (now) an oscillating spot to absorb silently."""
            if not self.osc or dist is None: return False
            if any(dist(self.J[o],self.J[j])<=300 for o in osc_sites): return True
            flips.append((day,j)); n=sum(1 for d,k in flips if (day-d).days<=60 and dist(self.J[k],self.J[j])<=300)
            if n>=self.osc:
                osc_sites.append(j)
                if self.osc_proj: self.oscF.append(self.F[j]); self._reproject()
                return True
            return False
        for i,day in enumerate(Y.index):
            yi=Y.iloc[i].values
            if np.isnan(yi).any(): continue
            if self.ref_mode=="rolling":
                # comparison method: reference = median of the last `win` nights since the last event
                past=Y.iloc[max(last_ev,i-self.win):i].values
                if len(past)<5: hist=[]; continue
                ref=np.nanmedian(past,0); hist.append(yi-ref); hist=hist[-1:]
            else: hist.append(yi-ref)
            if i<self.ncom: continue
            best={+1:(0,None,0,1),-1:(0,None,0,1)}
            for s in self.scales:
                if len(hist)<s: continue
                ys=np.mean(hist[-s:],0)
                for sg in (+1,-1):
                    g,j,a=self.glr(-ys if False else ys,sign=-sg) if False else self.glr(ys,sign=sg)
                    g*=s/self.infl[s]
                    if g>best[sg][0]: best[sg]=(g,j,a,s)
            for sg in (+1,-1):
                cnt[sg]=cnt[sg]+1 if best[sg][0]>self.h else 0
            if self.fast and best[+1][0]>self.fast*self.h: cnt[+1]=max(cnt[+1],self.persist)   # big abrupt leak: one night is enough
            if self.health:
                bf=(0.0,None)
                for s in self.scales:
                    if len(hist)<s: continue
                    u=self.W@(self.P@np.mean(hist[-s:],0)); gf=u**2/np.diag(self.W)*s/self.infl[s]; gf[self.bad]=0
                    if gf.max()>bf[0]: bf=(float(gf.max()),int(np.argmax(gf)))
                if bf[0]>self.hf and bf[0]>self.health*max(best[+1][0],best[-1][0]):
                    fcnt+=1; cnt={+1:0,-1:0}          # one sensor explains it better than any leak: hold leak alarms
                    if fcnt>=self.persist:
                        self.bad.append(bf[1]); self._reproject(); fcnt=0
                        events.append(dict(date=day,kind="sensor",sensor=self.sens[bf[1]],g=bf[0]))
                    continue
                fcnt=0
            if pend is not None:
                # refining a pressure alarm: use every night since its onset, report once the location is tight
                m=min(len(hist),pend["s"]+i-pend["i0"]); ys=np.mean(hist[-m:],0); g,j,a=self.glr(ys,sign=+1)
                if self.spread(ys,j)<=self.conf or i-pend["i0"]>=self.refine:
                    near=[k for k in known if dist is not None and dist(self.J[k["j"]],self.J[j])<=300]
                    alarms.append(dict(date=day,node=self.J[j],j=j,size=a,g=g*m,scale=m,kind="growth" if near else "new",waited=i-pend["i0"]))
                    if near: near[0]["a"]+=a
                    else: known.append(dict(j=j,a=a,since=day))
                    ref=ref+ys; hist=[]; cnt={+1:0,-1:0}; last=i; last_ev=i; pend=None
                    if useflow: cus={zz:0.0 for zz in E.columns}
                continue
            fz=None
            if useflow and i-last>=self.cool:
                for z in E.columns:
                    zi=int(str(z)[4:]); e=E.iloc[i][z]
                    if np.isnan(e): continue
                    e-=sum(k["a"] for k in known if self.zone_of.get(self.J[k["j"]])==zi)
                    cus[z]=max(0.0,cus[z]+e/self.fsig[z]-self.fk)
                    if cus[z]>self.fh and cnt[+1]<self.persist: fz=(z,zi,e)
            if fz is not None:
                z,zi,e=fz
                # locate within the zone with the pressure evidence available now (may be below the alarm level)
                cand=None
                for s_ in self.scales:
                    if len(hist)<s_: continue
                    ys=np.mean(hist[-s_:],0); num=self.FW@(self.P@ys); a_=num/self.den; g_=np.where(a_>0,a_*num,0)
                    g_[[self.zone_of.get(n)!=zi for n in self.J]]=0; g_[~self.ok]=0; j_=int(np.argmax(g_))
                    if cand is None or g_[j_]*s_>cand[0]: cand=(g_[j_]*s_,j_,s_)
                if cand is not None:
                    _,j,s=cand
                    rec=dict(date=day,node=self.J[j],j=j,size=float(e),g=float(cus[z]),scale=s,kind="flow")
                    near=[k for k in known if dist is not None and dist(self.J[k["j"]],self.J[j])<=300]
                    if near: near[0]["a"]+=e
                    else: known.append(dict(j=j,a=e,since=day))
                    alarms.append(rec); ref=ref+np.mean(hist[-s:],0); hist=[]; cnt={+1:0,-1:0}; last=i; last_ev=i
                cus={zz:0.0 for zz in E.columns}
                continue
            # leak (pressure fell -> fingerprint negative -> sign +1 since F<0 and y<0 gives positive num)
            dom=+1 if best[+1][0]>=best[-1][0] else -1    # a repair (pressure rise) outranks a leak reading
            for sg,kind in ((+1,"leak"),(-1,"repair")):
                if sg!=dom: continue
                far=self.cool_r and dist is not None and last_j is not None and best[sg][1] is not None and dist(self.J[best[sg][1]],self.J[last_j])>self.cool_r
                if cnt[sg]>=self.persist and (i-last>=self.cool or far):
                    g,j,a,s=best[sg]; expl=-a*self.F[j]   # repair: pressure rose along this fingerprint
                    if kind=="leak" and self.refine and self.spread(np.mean(hist[-s:],0),j)>self.conf:
                        pend=dict(i0=i,s=s); break      # location still vague: collect more nights first
                    rec=dict(date=day,node=self.J[j],j=j,size=a,g=g,scale=s)
                    if kind=="leak":
                        locs=[(j,a,g)]
                        if self.multi:
                            sel,x,gain=self.omp(np.mean(hist[-s:],0),2); f=s/self.infl[s]
                            if len(sel)==2 and min(gain)*f>self.multi*self.h and dist(self.J[sel[0]],self.J[sel[1]])>300:
                                locs=[(sel[0],x[0],gain[0]*f),(sel[1],x[1],gain[1]*f)]   # two overlapping leaks
                        expl=sum(a_*self.F[j_] for j_,a_,_ in locs)   # leak: fitted pressure drop
                        for j,a,g in locs:
                            rec=dict(date=day,node=self.J[j],j=j,size=a,g=g,scale=s,two=len(locs)==2)
                            if flip(day,j): rec["kind"]="oscillating"; events.append(rec); continue
                            near=[k for k in known if dist is not None and dist(self.J[k["j"]],self.J[j])<=300]
                            rec["kind"]="growth" if near else "new"
                            if near: near[0]["a"]+=a
                            else: known.append(dict(j=j,a=a,since=day))
                            (alarms if (rec["kind"]=="new" or self.growth_report) else events).append(rec)
                    else:
                        rec["kind"]="repair"; events.append(rec)
                        if flip(day,j): rec["kind"]="oscillating"
                        elif known:
                            k=min(known,key=lambda k:dist(self.J[k["j"]],self.J[j]) if dist else 0)
                            confirmed=True
                            if self.repair_flow and useflow and i>=2*s:
                                zc=f"zone{self.zone_of.get(self.J[k['j']])}"
                                if zc in E.columns:
                                    drop=float(np.nanmean(E[zc].iloc[i-2*s+1:i-s+1])-np.nanmean(E[zc].iloc[i-s+1:i+1]))
                                    confirmed=drop>=self.repair_flow*max(k["a"],0.5); rec["flow_drop"]=drop
                            if confirmed: known.remove(k)
                            else: rec["kind"]="rise"   # not a repair: the zone's night flow did not fall
                    if self.absorb=="fit":   # absorb only the explained change; keep the rest as evidence
                        ref=ref+expl; hist=[h-expl for h in hist[-s:]]
                    else:
                        ref=ref+np.mean(hist[-s:],0); hist=[]   # event-driven reference update: absorb the observed change
                    cnt={+1:0,-1:0}; last=i; last_ev=i; last_j=j
                    if useflow: cus={zz:0.0 for zz in E.columns}
            if self.reloc and known and i-last_rl>=self.reloc and i!=last:
                # re-check open cases: all known leaks fitted together to the total change since commissioning
                last_rl=i; ytot=ref-ref0+(np.mean(hist[-7:],0) if hist else 0)
                sel,x,gain=self.omp(ytot,len(known)); f=7/self.infl.get(7,1.0)
                free=list(range(len(sel)))
                for k in sorted(known,key=lambda k:-k["a"]):
                    if not free: break
                    m=min(free,key=lambda q:dist(self.J[k["j"]],self.J[sel[q]])); free.remove(m); jn=sel[m]
                    if dist(self.J[k["j"]],self.J[jn])<=300 or gain[m]*f<self.h: k.pop("rl",None); continue
                    prev=k.get("rl")   # stored on the case (v4 keyed this by id(), which Python reuses after a case closes)
                    if prev is not None and dist(self.J[prev[0]],self.J[jn])<=150 and prev[1]+1>=self.rl_persist:
                        alarms.append(dict(date=day,node=self.J[jn],j=jn,size=float(x[m]),g=gain[m]*f,scale=7,kind="relocate",was=self.J[k["j"]]))
                        k["j"]=jn; k.pop("rl",None)
                    elif prev is not None and dist(self.J[prev[0]],self.J[jn])<=150: k["rl"]=(jn,prev[1]+1)
                    else: k["rl"]=(jn,1)
        return alarms,events,known
