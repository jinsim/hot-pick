// Policy scores, not calibrated probabilities or evidence of task quality.
export function popularity(card, trends, now=Date.now()) {
  const valid=x=>Number.isFinite(x)&&x>=0;
  const stars=valid(card.stars)?card.stars:null;
  const age=t=>{const d=Date.parse(t);return Number.isFinite(d)&&d<=now?(now-d)/86400000:Infinity;};
  const freshness=days=>2**(-days/7);
  const established=stars===null?0:Math.log1p(stars)/(Math.log1p(stars)+Math.log1p(1000))*freshness(age(card.checked_at));
  const observations=Object.values(trends||{}).flatMap(t=>(t.repositories||[]).filter(r=>r.repo===card.repo&&!r.language_filter).map(r=>({...r,checked_at:t.checked_at})));
  // Prefer the latest weekly observation, otherwise daily/monthly; never sum overlapping periods.
  const usable=observations.filter(r=>age(r.checked_at)<=14&&[1,7,30].includes(({daily:1,weekly:7,monthly:30})[r.since]));
  usable.sort((a,b)=>Number(b.since==='weekly')-Number(a.since==='weekly')||Date.parse(b.checked_at)-Date.parse(a.checked_at));
  const r=usable[0];let momentum=0,trend=0;
  if(r){
    const decay=freshness(age(r.checked_at));
    trend=Number.isFinite(r.rank)&&r.rank>=1?decay/Math.log2(r.rank+1):0;
    if(valid(r.period_stars)&&valid(r.total_stars)&&r.period_stars<=r.total_stars){
      const weekly=r.period_stars*7/({daily:1,weekly:7,monthly:30})[r.since];
      const rate=weekly/(r.total_stars+100); // 100-star denominator floor dampens tiny-base bursts.
      momentum=rate/(rate+0.1)*decay;
    }
  }
  return {score:0.2*established+0.6*momentum+0.2*trend,established,momentum,trend,period:r?.since||null,observed_at:r?.checked_at||null,policy:'popularity-v1-tiebreak'};
}
