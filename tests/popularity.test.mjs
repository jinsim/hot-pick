import test from 'node:test';import assert from 'node:assert/strict';import {popularity} from '../skills/hot-pick/scripts/popularity.mjs';
const now=Date.parse('2026-11-11T00:00:00Z'),date=new Date(now).toISOString();
const card={repo:'a/b',stars:1000,checked_at:date};
const trends=(n=100,total=1000,checked_at=date,since='weekly')=>({x:{checked_at,repositories:[{repo:'a/b',since,rank:1,period_stars:n,total_stars:total}]}});
test('bounded, missing evidence contributes no invented momentum',()=>{assert.equal(popularity({},{} ,now).score,0);for(const n of [0,1,100,1e9]){const x=popularity({...card,stars:n},trends(n,n),now);assert.ok(x.score>=0&&x.score<=1);}});
test('recent growth outranks established popularity at identical relevance',()=>assert.ok(popularity(card,trends(),now).score>popularity({...card,stars:1e6},{},now).score));
test('tiny denominators damped, invalid counts ignored',()=>{assert.ok(popularity(card,trends(1,1),now).momentum<popularity(card,trends(100,1000),now).momentum);assert.equal(popularity(card,trends(2000,1000),now).momentum,0);});
test('stale and future observations excluded',()=>{for(const d of ['2025-01-01','2027-01-01'])assert.equal(popularity(card,trends(100,1000,d),now).momentum,0);});
test('periods normalized and overlapping evidence not added',()=>{const a=trends(70);const b=trends(10,1000,date,'daily');assert.equal(popularity(card,a,now).momentum,popularity(card,b,now).momentum);assert.equal(popularity(card,{...a,y:b.x},now).score,popularity(card,a,now).score);});
