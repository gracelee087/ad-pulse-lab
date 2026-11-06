// Writes SIMULATED result files in the "ad-pulse-lab result v1" format, for demoing the Compare view.
// These are not real people and not measurements. Values are random noise around a random rest value;
// no ad has any built-in effect, so any difference between ads in these files is chance.
//
// Usage: node tools/make-simulated.js [count=8] [outDir=sample-data/simulated] [seed=1]
'use strict';

const fs = require('fs');
const path = require('path');

const [count = 8, outDir = path.join(__dirname, '..', 'sample-data', 'simulated'), seed = 1] = process.argv.slice(2);
const N = Number(count);

// Small seeded PRNG (mulberry32) so the same seed gives the same files.
let s = Number(seed) >>> 0;
const rand = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
const r1 = (x) => Math.round(x * 10) / 10;
const r3 = (x) => Math.round(x * 1000) / 1000;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

const ADS = [
    { ad: 'starbucks_every_table', title: 'Starbucks UK — Every Table Has A Story', style: 'emotional story', youtube: 'o-Ikkh5oxuo', duration_s: 60 },
    { ad: 'dolcegusto_eclipse', title: 'NESCAFÉ Dolce Gusto — ECLIPSE machine', style: 'rational feature demo, brand first', youtube: 'VLB3NzJPBiA', duration_s: 77 },
    { ad: 'taylors_welcome_to_coffee', title: 'Taylors of Harrogate — Welcome to Coffee', style: 'sensory, brand only at the end', youtube: 'BrQfpdQv2Mo', duration_s: 60 },
];
const scenes = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'scenes.json'), 'utf8'));

fs.mkdirSync(outDir, { recursive: true });
for (let i = 1; i <= N; i++) {
    const id = `sim-${String(i).padStart(2, '0')}`;
    const restPulse = clamp(72 + 8 * gauss(), 55, 95);
    const restBreath = clamp(15 + 2.5 * gauss(), 9, 22);
    const order = ADS.slice();
    for (let j = order.length - 1; j > 0; j--) { const k = Math.floor(rand() * (j + 1)); [order[j], order[k]] = [order[k], order[j]]; }
    const ads = [], curves = [];
    order.forEach((a, k) => {
        const len = a.duration_s + 20;               // 10 s before and after the ad
        let drift = 0;
        const pulse = [], wave = [];
        const bpm = clamp(restBreath + gauss(), 8, 24);
        for (let t = 0; t < len; t++) {
            drift = 0.9 * drift + 1.0 * gauss();      // slow random wander, same for every ad
            pulse.push(r3(restPulse + drift));
            wave.push(r3(Math.sin(2 * Math.PI * (bpm / 60) * t) + 0.25 * gauss()));
        }
        const inAd = pulse.slice(10 + 12, 10 + a.duration_s); // like the app: skip the first 12 s
        const pulseMean = r1(inAd.reduce((x, y) => x + y, 0) / inAd.length);
        const breathMean = r1(bpm);
        ads.push({
            ad: a.ad, title: a.title, style: a.style, youtube: a.youtube, position: k + 1, duration_s: a.duration_s,
            purchase: rand() < 0.5 ? 'buy' : 'not_buy', liking: rand() < 0.5 ? 'like' : 'dislike',
            pulse_bpm: pulseMean, pulse_vs_rest: r1(pulseMean - r1(restPulse)), pulse_usable_pct: Math.round(80 + 20 * rand()),
            breathing_per_min: breathMean, breathing_vs_rest: r1(breathMean - r1(restBreath)), breathing_usable_pct: Math.round(75 + 25 * rand()),
        });
        curves.push({ ad: a.ad, start_offset_s: -10, breathing_wave_1hz: wave, pulse_bpm_1hz: pulse });
    });
    const file = {
        format: 'ad-pulse-lab result v1',
        app_version: '0.1.0',
        simulated: true,
        tester_id: id,
        created: new Date().toISOString().slice(0, 10),
        consent: null,
        rest: { pulse_bpm: r1(restPulse), pulse_usable_pct: 100, breathing_per_min: r1(restBreath), breathing_usable_pct: 100 },
        min_usable_pct_for_comparison: 70,
        ads,
        scenes,
        notes: `SIMULATED, not a real person and not a measurement. Random noise around a random rest value; no ad has any built-in effect (tools/make-simulated.js, seed ${seed}).`,
        curves,
    };
    fs.writeFileSync(path.join(outDir, `adpulse-result-${id}.json`), JSON.stringify(file, null, 2) + '\n');
}
console.log(`wrote ${N} simulated files to ${outDir}`);
