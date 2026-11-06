// ad-pulse-lab — renderer: session flow, SDK wiring, logging.
// SDK usage pattern follows Presage's electron-quickstart; code written for this project.
'use strict';

const {
    ProcessingStatus, ValidationCode, breathingMetrics, cardioMetrics,
} = require('@smartspectra/node-sdk/renderer');
const { decodeMetrics } = require('@smartspectra/node-sdk/messages');

// ---- session settings -------------------------------------------------------
// Three ad styles from the effectiveness research (see HANDOFF 4-5):
// emotional story (brand at 8 s) / rational feature demo (brand at 0 s) / sensory, brand only at the end (54 s).
// All three are on the brands' official channels. Scene times: scenes.json.
const ADS = [
    { id: 'starbucks_every_table', youtube: 'o-Ikkh5oxuo', title: 'Starbucks UK — Every Table Has A Story', style: 'emotional story' },
    { id: 'dolcegusto_eclipse', youtube: 'VLB3NzJPBiA', title: 'NESCAFÉ Dolce Gusto — ECLIPSE machine', style: 'rational feature demo, brand first' },
    { id: 'taylors_welcome_to_coffee', youtube: 'BrQfpdQv2Mo', title: 'Taylors of Harrogate — Welcome to Coffee', style: 'sensory, brand only at the end' },
];
// Dropped: Nespresso 'LaMOIzNrCsQ' turned out to be a behind-the-scenes interview, not the ad (storyboard check).
// Scene labels follow common ad-testing practice: brand reveal, product shot, key message, emotional peak, end tagline.
const MARK_KEYS = { b: 'brand_first', p: 'product', k: 'key_message', e: 'emotional_peak', t: 'tagline' };
const WARMUP_S = 30;
const BASELINE_S = 90;
const RECOVERY_S = 45;
const AD_TIMEOUT_S = 150;   // safety net if the player never reports "ended"

// ---- helpers ----------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NAMES = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [v, k.replace(/^k/, '')]));
const STATUS_NAMES = NAMES(ProcessingStatus);
const VALID_NAMES = NAMES(ValidationCode);

function num(ts) {
    if (ts == null) return null;
    if (typeof ts === 'number') return ts;
    if (typeof ts === 'bigint') return Number(ts);
    if (typeof ts.toNumber === 'function') return ts.toNumber();
    return Number(ts);
}
function pick(arr, withConf) {
    if (!arr || !arr.length) return undefined;
    return arr.map((m) => withConf
        ? { v: m.value, s: !!m.stable, c: m.confidence ?? null, ts: num(m.timestamp) }
        : { v: m.value, s: !!m.stable, ts: num(m.timestamp) });
}

let phase = 'intro';
function log(kind, data) { window.adpulse.log({ t: Date.now(), phase, kind, ...data }); }

function show(screenId) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === screenId));
    $('player-wrap').classList.toggle('active', screenId === 'player');
    $('status').classList.toggle('hidden', ['player', 's-intro', 's-consent', 's-results', 's-done'].includes(screenId));
}
function setPhase(p) { phase = p; $('st-phase').textContent = p; log('phase', { name: p }); store.phases.push({ name: p, t: Date.now() }); }

function shuffle(a) {
    const b = a.slice();
    for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
    return b;
}

// ---- YouTube player ---------------------------------------------------------
let player = null;
let onPlayerState = null;

function ensurePlayer() {
    if (player) return Promise.resolve(player);
    return new Promise((resolve, reject) => {
        const t0 = Date.now();
        (function wait() {
            if (window.YT && window.YT.Player) {
                player = new window.YT.Player('player', {
                    width: '100%', height: '100%',
                    playerVars: { autoplay: 0, controls: 0, rel: 0, playsinline: 1, disablekb: 1, fs: 0, iv_load_policy: 3, origin: location.origin },
                    events: {
                        onReady: () => resolve(player),
                        onStateChange: (e) => onPlayerState && onPlayerState(e.data),
                        onError: (e) => { log('player_error', { code: e.data }); onPlayerState && onPlayerState('error:' + e.data); },
                    },
                });
            } else if (Date.now() - t0 > 15000) {
                reject(new Error('YouTube player did not load (no network?)'));
            } else {
                setTimeout(wait, 200);
            }
        })();
    });
}

// Plays one ad. Resolves with { started, ended, reason }.
async function playAd(ad, maxSeconds) {
    await ensurePlayer();
    show('player');
    return new Promise((resolve) => {
        let started = null;
        const finish = (reason) => {
            onPlayerState = null;
            clearTimeout(timer);
            try { player.stopVideo(); } catch { /* ignore */ }
            resolve({ started, ended: Date.now(), reason });
        };
        const timer = setTimeout(() => finish(maxSeconds ? 'test_cut' : 'timeout'), (maxSeconds || AD_TIMEOUT_S) * 1000);
        onPlayerState = (s) => {
            if (s === 1 && started === null) { started = Date.now(); log('ad_playing', { ad: ad.id, duration: player.getDuration() }); }
            if (s === 0) finish('ended');
            if (typeof s === 'string' && s.startsWith('error')) finish(s);
        };
        player.loadVideoById({ videoId: ad.youtube, startSeconds: 0 });
    });
}

// ---- countdown screen -------------------------------------------------------
async function countdown(title, text, seconds) {
    $('timer-title').textContent = title;
    $('timer-text').textContent = text;
    show('s-timer');
    for (let s = seconds; s > 0; s--) {
        $('timer-count').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
        await sleep(1000);
    }
}

// ---- choice screen ----------------------------------------------------------
function askChoice() {
    const answer = { purchase: null, liking: null };
    const shownAt = Date.now();
    const btns = document.querySelectorAll('#s-choice button[data-q]');
    btns.forEach((b) => b.classList.remove('picked'));
    $('btn-choice-next').disabled = true;
    show('s-choice');
    return new Promise((resolve) => {
        btns.forEach((b) => {
            b.onclick = () => {
                answer[b.dataset.q] = b.dataset.v;
                document.querySelectorAll(`#s-choice button[data-q="${b.dataset.q}"]`).forEach((x) => x.classList.toggle('picked', x === b));
                $('btn-choice-next').disabled = !(answer.purchase && answer.liking);
            };
        });
        $('btn-choice-next').onclick = () => resolve({ ...answer, ms: Date.now() - shownAt });
    });
}

// ---- alerts -----------------------------------------------------------------
// Shown on top of everything (also during ads) when the camera cannot measure well.
const FRIENDLY = {
    NoFaceFound: 'No face found — stay inside the camera view.',
    MultipleFacesFound: 'More than one face is visible — only one person, please.',
    FaceNotCentered: 'Move to the center of the camera view.',
    FaceSizeOutOfRange: 'Move a little closer to or farther from the camera.',
    TooDark: 'It is too dark — turn on a light in front of you.',
    TooBright: 'It is too bright — avoid direct light or a window in the picture.',
    ChestNotVisible: 'Your chest is not visible — move back a little or tilt the camera down.',
    FrameRateTooLow: 'The camera is too slow — close other programs.',
    ExcessiveMotion: 'Too much movement — please sit still.',
    FaceTooClose: 'You are too close — move back a little.',
    FaceTooFar: 'You are too far — move a little closer.',
    FaceTooHigh: 'Your face is too high in the picture — lower your seat or tilt the camera up.',
    FaceTooLow: 'Your face is too low in the picture — raise your seat or tilt the camera down.',
    FaceNotForward: 'Please face the screen directly.',
};
const VALID_ALERT_MS = 2000;      // non-OK this long -> alert
const PULSE_GAP_MS = 15000;       // no new pulse value this long -> alert
const BREATH_GAP_MS = 45000;      // no stable breathing value this long -> alert

const watch = { running: false, since: 0, badSince: null, badName: null, lastPulse: 0, lastStableBreath: 0, shown: null };

function setAlert(key, text) {
    const el = $('alert');
    if (watch.shown === key && (!key || el.textContent === text)) return;
    watch.shown = key;
    el.textContent = text || '';
    el.classList.toggle('show', !!key);
    log(key ? 'alert_on' : 'alert_off', { key, text: text || null });
}

function checkAlerts() {
    if (!watch.running) return;
    const now = Date.now();
    if (watch.badName && now - watch.badSince >= VALID_ALERT_MS) {
        setAlert('validation:' + watch.badName, FRIENDLY[watch.badName] || `Measurement problem: ${watch.badName}`);
        return;
    }
    const warm = now - watch.since > 35000;   // first values need ~22 s (self test)
    if (warm && now - watch.lastPulse > PULSE_GAP_MS) {
        setAlert('pulse', 'Pulse is not being measured — face the camera, sit still, and check the light.');
        return;
    }
    if (warm && phase !== 'check' && now - watch.lastStableBreath > BREATH_GAP_MS) {
        setAlert('breathing', 'Breathing is not being measured — keep your chest visible and do not talk.');
        return;
    }
    setAlert(null);
}
setInterval(checkAlerts, 500);

// ---- data kept in memory for the result summary ------------------------------
const store = { pulse: new Map(), rate: new Map(), trace: new Map(), offsets: [], phases: [], ads: [], choices: {} };
function resetStore() {
    store.pulse.clear(); store.rate.clear(); store.trace.clear();
    store.offsets = []; store.phases = []; store.ads = []; store.choices = {};
}
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

// Series as [wallMs, value, stable]; SDK microsecond timestamps mapped to wall clock.
function series(map) {
    const off = store.offsets.length ? Math.min(...store.offsets) : 0;
    return [...map.values()].map((m) => [m.ts / 1000 + off, m.v, m.s]).sort((a, b) => a[0] - b[0]);
}
const MIN_USABLE_PCT = 70;   // below this, a window's average is shown but not compared with rest
function windowStats(ser, from, to, lagMs) {
    const all = ser.filter(([t]) => t >= from && t < to);
    const settled = all.filter(([t, , st]) => st && t >= from + lagMs).map(([, v]) => v);
    const usable = all.length ? Math.round(100 * all.filter(([, , st]) => st).length / all.length) : null;
    return { mean: r1(mean(settled)), usable, reliable: usable != null && usable >= MIN_USABLE_PCT && settled.length > 0 };
}
const delta = (a, b) => (a.reliable && b.reliable ? r1(a.mean - b.mean) : null);
function perSecond(ser, from, to) {
    const out = [];
    for (let t = from; t < to; t += 1000) {
        const vs = ser.filter(([x, , st]) => x >= t && x < t + 1000 && st).map(([, v]) => v);
        out.push(vs.length ? Math.round(mean(vs) * 1000) / 1000 : null);
    }
    return out;
}

function buildSummary(order, consent, scenes) {
    const P = series(store.pulse), R = series(store.rate), T = series(store.trace);
    const ph = Object.fromEntries(store.phases.map((x, i) => [x.name, { start: x.t, end: (store.phases[i + 1] || { t: Date.now() }).t }]));
    const b = ph.baseline;
    const basePulse = windowStats(P, b.start, b.end, 12000);
    const baseRate = windowStats(R, b.start, b.end, 30000);
    const ads = store.ads.map((a) => {
        const p = windowStats(P, a.started, a.ended, 12000);
        const r = windowStats(R, a.started, a.ended, 30000);
        const meta = order.find((o) => o.id === a.ad) || {};
        const ch = store.choices[a.ad] || {};
        return {
            ad: a.ad, title: meta.title, style: meta.style, youtube: meta.youtube, position: a.index,
            duration_s: r1((a.ended - a.started) / 1000),
            purchase: ch.purchase, liking: ch.liking,
            pulse_bpm: p.mean, pulse_vs_rest: delta(p, basePulse), pulse_usable_pct: p.usable,
            breathing_per_min: r.mean, breathing_vs_rest: delta(r, baseRate), breathing_usable_pct: r.usable,
            _from: a.started - 10000, _to: a.ended + 10000,
        };
    });
    return {
        format: 'ad-pulse-lab result v1',
        app_version: '0.1.0',
        tester_id: testerId,
        created: new Date().toISOString().slice(0, 10),
        consent,
        rest: { pulse_bpm: basePulse.mean, pulse_usable_pct: basePulse.usable, breathing_per_min: baseRate.mean, breathing_usable_pct: baseRate.usable },
        min_usable_pct_for_comparison: MIN_USABLE_PCT,
        ads,
        scenes,
        notes: 'Pulse = 12 s average (values from 12 s after ad start), breathing rate = 30 s average (from 30 s after ad start); stable values only. No video or face data.',
        _curves: () => ads.map((a) => ({
            ad: a.ad, start_offset_s: -10,
            breathing_wave_1hz: perSecond(T, a._from, a._to),
            pulse_bpm_1hz: perSecond(P, a._from, a._to),
        })),
    };
}

function fmtDelta(v, unit, usable) {
    if (v != null) return ` (${v > 0 ? '+' : ''}${v} ${unit} vs rest)`;
    return usable != null && usable < MIN_USABLE_PCT ? ' (weak signal, not compared)' : ' (not compared: rest signal weak)';
}
function showResults(summary) {
    const rs = summary.rest;
    const weak = (u) => (u != null && u < MIN_USABLE_PCT ? ' (weak signal - you may have moved)' : '');
    $('res-base').textContent = `At rest (gray screen): pulse ${rs.pulse_bpm ?? '-'} BPM${weak(rs.pulse_usable_pct)}, breathing ${rs.breathing_per_min ?? '-'} per minute${weak(rs.breathing_usable_pct)}.`;
    const tb = $('res-table').querySelector('tbody');
    tb.innerHTML = '';
    for (const a of summary.ads) {
        const tr = document.createElement('tr');
        const cells = [
            a.title || a.ad,
            a.pulse_bpm == null ? '-' : `${a.pulse_bpm} BPM${fmtDelta(a.pulse_vs_rest, 'BPM', a.pulse_usable_pct)}`,
            a.breathing_per_min == null ? '-' : `${a.breathing_per_min} /min${fmtDelta(a.breathing_vs_rest, '/min', a.breathing_usable_pct)}`,
            `${(a.purchase || '?').replace('_', ' ')} / ${a.liking || '?'}`,
            `pulse ${a.pulse_usable_pct ?? '-'}% / breathing ${a.breathing_usable_pct ?? '-'}%`,
        ];
        for (const c of cells) { const td = document.createElement('td'); td.textContent = c; tr.appendChild(td); }
        tb.appendChild(tr);
    }
    show('s-results');
}

// ---- SDK (runs in the main process; see main.js) ------------------------------
let sdkRunning = false;
let lastValidation = null;
let okSince = null;

function onValidation(code, ts, hint) {
    lastValidation = code;
    log('validation', { code, name: VALID_NAMES[code], hint: hint || null, ts: num(ts) });
    const name = VALID_NAMES[code] || String(code);
    const good = code === ValidationCode.kOk || code === ValidationCode.kCameraTuning;
    if (good) { watch.badName = null; watch.badSince = null; if (okSince === null) okSince = Date.now(); }
    else { okSince = null; if (watch.badName !== name) { watch.badName = name; watch.badSince = Date.now(); } }
    $('st-valid').textContent = `${name}${hint ? ' — ' + hint : ''}`;
    const pos = $('check-hint');
    pos.textContent = code === ValidationCode.kOk ? 'OK' : (FRIENDLY[name] || hint || name);
    pos.className = 'hint ' + (code === ValidationCode.kOk ? 'ok' : 'warn');
}

function onMetrics(buf, ts) {
    let d;
    try { d = decodeMetrics(buf); } catch (e) { log('decode_error', { msg: e.message }); return; }
    const row = {
        ts: num(ts),
        br: pick(d.breathing && d.breathing.rate, true),
        bt: pick(d.breathing && d.breathing.upperTrace, false),
        pr: pick(d.cardio && d.cardio.pulseRate, true),
    };
    log('metrics', row);
    const now = Date.now();
    if (row.ts != null) store.offsets.push(now - row.ts / 1000);
    for (const m of row.pr || []) store.pulse.set(m.ts, m);
    for (const m of row.br || []) store.rate.set(m.ts, m);
    for (const m of row.bt || []) store.trace.set(m.ts, m);
    if (row.pr) watch.lastPulse = Date.now();
    if (row.br && row.br.some((m) => m.s)) watch.lastStableBreath = Date.now();
    if (row.br) $('st-br').textContent = `breathing ${row.br[row.br.length - 1].v.toFixed(0)}/min`;
    if (row.pr) $('st-pr').textContent = `pulse ${row.pr[row.pr.length - 1].v.toFixed(0)} BPM`;
}

window.adpulse.onSdk((m) => {
    if (m.kind === 'processingStatus') log('status', { code: m.status, name: STATUS_NAMES[m.status] });
    else if (m.kind === 'validationStatus') onValidation(m.code, m.ts, m.hint);
    else if (m.kind === 'metrics') onMetrics(m.buf, m.ts);
    else if (m.kind === 'error') {
        log('sdk_error', { code: m.code, message: m.message, retryable: m.retryable });
        $('error').textContent = `error ${m.code}: ${m.message}${m.retryable ? ' (retryable)' : ''}`;
        setAlert('sdk_error', `Measurement stopped (error ${m.code}). Please tell the organizer.`);
    }
});

async function startSdk() {
    watch.running = true;
    watch.since = Date.now();
    watch.lastPulse = watch.lastStableBreath = Date.now();
    okSince = null;
    const r = await window.adpulse.sdkStart({ requestedMetrics: [...breathingMetrics, ...cardioMetrics] });
    if (!r || !r.ok) { watch.running = false; throw Object.assign(new Error((r && r.message) || 'start failed'), { code: r && r.code }); }
    sdkRunning = true;
}

async function stopSdk() {
    watch.running = false;
    setAlert(null);
    if (!sdkRunning) return;
    sdkRunning = false;
    try { await window.adpulse.sdkStop(); } catch (e) { log('stop_error', { msg: e.message }); }
}

// Blurred preview for positioning (the page's own camera stream; closed before the SDK opens the camera).
let previewStream = null;
async function startPreview() {
    previewStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    const pv = $('preview');
    pv.srcObject = previewStream;
    await pv.play().catch(() => {});
}
function stopPreview() {
    if (previewStream) previewStream.getTracks().forEach((t) => t.stop());
    previewStream = null;
    $('preview').srcObject = null;
}

// ---- flows ------------------------------------------------------------------
async function testAds() {
    const file = await window.adpulse.startLog();
    phase = 'test_ads';
    log('session', { mode: 'test_ads', file });
    for (const ad of ADS) {
        const r = await playAd(ad, 8);
        log('ad_test', { ad: ad.id, ...r });
    }
    show('s-intro');
    $('key-state').textContent = 'Ad test finished. If all three ads played, you can start measuring.';
}

// Scene marking: play each ad, press keys at moments; saved to scenes.json.
async function markScenes() {
    const scenes = await window.adpulse.getScenes();
    await ensurePlayer();
    $('markbar').classList.add('show');
    $('player-wrap').classList.add('marking');
    for (const ad of ADS) {
        const marks = [];
        const render = () => { $('mark-list').textContent = marks.map((m) => `${m.label} @ ${m.t.toFixed(1)}s`).join('  ·  ') || '(no marks yet)'; };
        $('mark-title').textContent = ad.title;
        render();
        show('player');
        player.loadVideoById({ videoId: ad.youtube, startSeconds: 0 });
        const tick = setInterval(() => { try { if (player.getPlayerState() !== 0) $('mark-time').textContent = player.getCurrentTime().toFixed(1) + ' s'; } catch { /* ignore */ } }, 100);
        await new Promise((resolve) => {
            onPlayerState = (s) => { if (s === 0) setTimeout(() => { $('mark-time').textContent = 'Ad has ended — press R to watch again, or N for the next ad'; }, 150); };
            const onKey = (ev) => {
                const k = ev.key.toLowerCase();
                if (MARK_KEYS[k]) {
                    if (player.getPlayerState() === 0) { $('mark-time').textContent = 'Ad has ended — press R to watch again, or N for the next ad'; return; }
                    marks.push({ t: +player.getCurrentTime().toFixed(1), label: MARK_KEYS[k] }); render();
                }
                else if (k === 'r') { marks.length = 0; render(); player.seekTo(0, true); player.playVideo(); }
                else if (k === ' ') { ev.preventDefault(); player.getPlayerState() === 1 ? player.pauseVideo() : player.playVideo(); }
                else if (k === 'backspace') { marks.pop(); render(); }
                else if (k === 'n') { window.removeEventListener('keydown', onKey); resolve(); }
            };
            window.addEventListener('keydown', onKey);
        });
        clearInterval(tick);
        onPlayerState = null;
        try { player.stopVideo(); } catch { /* ignore */ }
        if (marks.length) scenes[ad.id] = marks.sort((a, b) => a.t - b.t);
    }
    await window.adpulse.saveScenes(scenes);
    $('markbar').classList.remove('show');
    $('player-wrap').classList.remove('marking');
    show('s-intro');
    $('key-state').textContent = `Scene marks saved: ${Object.entries(scenes).map(([k, v]) => `${k} ${v.length}`).join(', ')}`;
}

const testerId = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('');

function askConsent() {
    const boxes = ['c-measure', 'c-share', 'c-publish'].map($);
    boxes.forEach((b) => { b.checked = false; });
    const sync = () => { $('btn-consent-ok').disabled = !($('c-measure').checked && $('c-share').checked); };
    boxes.forEach((b) => { b.onchange = sync; });
    sync();
    show('s-consent');
    return new Promise((resolve) => {
        $('btn-consent-cancel').onclick = () => resolve(null);
        $('btn-consent-ok').onclick = () => resolve({ measure: true, share_after_review: true, publish_aggregate: $('c-publish').checked, at: new Date().toISOString() });
    });
}

async function runSession() {
    const consent = await askConsent();
    if (!consent) { show('s-intro'); return; }
    resetStore();
    await window.adpulse.startLog();
    const order = shuffle(ADS);
    const scenes = await window.adpulse.getScenes();
    phase = 'setup';
    log('session', { mode: 'measure', tester: testerId, consent, order: order.map((a) => a.id), ads: ADS, scenes, warmup: WARMUP_S, baseline: BASELINE_S, recovery: RECOVERY_S, ua: navigator.userAgent });

    setPhase('position');
    show('s-position');
    try { await startPreview(); } catch (e) { log('preview_error', { msg: e.message }); }
    $('btn-pos-continue').disabled = false;
    await new Promise((r) => { $('btn-pos-continue').onclick = r; });
    stopPreview();

    setPhase('check');
    show('s-check');
    $('check-hint').textContent = 'Starting the measurement…';
    $('check-hint').className = 'hint warn';
    try {
        await startSdk();
    } catch (e) {
        log('start_error', { msg: e.message, code: e.code });
        $('check-hint').textContent = `Could not start: ${e.message}`;
        $('check-hint').className = 'hint err';
        return;
    }
    // Continue automatically once the camera check has been OK for 3 s.
    await new Promise((r) => { const iv = setInterval(() => { if (okSince && Date.now() - okSince >= 3000) { clearInterval(iv); r(); } }, 250); });

    setPhase('warmup');
    await countdown('Warm-up', 'Sit still and breathe normally. Please do not talk.', WARMUP_S);
    setPhase('baseline');
    await countdown('Rest', 'Keep looking at the gray screen. Sit still, do not talk.', BASELINE_S);

    for (let i = 0; i < order.length; i++) {
        const ad = order[i];
        setPhase(`ad${i + 1}:${ad.id}`);
        const r = await playAd(ad);
        log('ad_done', { ad: ad.id, index: i + 1, ...r });
        store.ads.push({ ad: ad.id, index: i + 1, started: r.started || r.ended, ended: r.ended });
        setPhase(`choice${i + 1}:${ad.id}`);
        const c = await askChoice();
        log('choice', { ad: ad.id, index: i + 1, ...c });
        store.choices[ad.id] = c;
        setPhase(`recovery${i + 1}`);
        await countdown('Rest', 'Gray screen again. Sit still, do not talk.', RECOVERY_S);
    }

    setPhase('end');
    await stopSdk();
    log('session_end', {});

    const summary = buildSummary(order, consent, scenes);
    showResults(summary);
    const choice = await new Promise((resolve) => {
        $('btn-res-save').onclick = () => resolve('save');
        $('btn-res-delete').onclick = () => resolve('delete');
    });
    $('btn-show-file').hidden = true;
    if (choice === 'save') {
        const out = { ...summary, ads: summary.ads.map(({ _from, _to, ...a }) => a) };
        out.curves = $('c-trace').checked ? summary._curves() : null;
        delete out._curves;
        const saved = await window.adpulse.saveResult(out);
        $('done-title').textContent = 'Saved - thank you';
        $('done-text').textContent = `Your result file: ${saved}. Please send this file to the organizer. Nothing else from this session is kept.`;
        $('btn-show-file').hidden = false;
        $('btn-show-file').onclick = () => window.adpulse.showFile(saved);
    } else {
        await window.adpulse.deleteSession();
        $('done-title').textContent = 'Deleted';
        $('done-text').textContent = 'This session was deleted from this PC. Nothing was saved or sent.';
    }
    resetStore();
    show('s-done');
}

// ---- intro ------------------------------------------------------------------
(async function init() {
    const key = await window.adpulse.hasKey();
    if (key) {
        $('key-state').textContent = 'API key found in .env.';
        $('btn-start').disabled = false;
    } else {
        $('key-state').textContent = 'No API key yet: paste it after SMARTSPECTRA_API_KEY= in the .env file, save, and restart the app.';
    }
    $('btn-test-ads').onclick = () => testAds().catch((e) => { $('key-state').textContent = e.message; show('s-intro'); });
    $('btn-mark').onclick = () => markScenes().catch((e) => { $('key-state').textContent = e.message; show('s-intro'); });
    $('btn-start').onclick = () => runSession();
    window.addEventListener('beforeunload', () => { window.adpulse.sdkStop(); });
})();
