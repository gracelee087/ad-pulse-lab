// ad-pulse-lab — per-ad chart for the results screen (inline SVG string, no libraries).
// Breathing wave and pulse on one time axis, with scene lines and caution bands.
'use strict';

const LABELS = {
    brand_first: 'brand', product: 'product', key_message: 'key message',
    emotional_peak: 'emotional peak', tagline: 'tagline',
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// opts: { breath: [{t, v}], pulse: [{t, v}], durationS, padS, scenes: [{t, label}], cautions: [{from, to, reason}] }
// t = seconds from ad start (may be negative before the ad).
function adChartSvg(opts) {
    const W = 760, H = 190, L = 44, R = 44, T = 40, B = 22;
    const { breath = [], pulse = [], durationS, padS = 10, scenes = [], cautions = [] } = opts;
    const t0 = -padS, t1 = durationS + padS;
    const X = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
    const plotH = H - T - B;
    const out = [];

    out.push(`<rect x="${X(0).toFixed(1)}" y="${T}" width="${(X(durationS) - X(0)).toFixed(1)}" height="${plotH}" fill="rgba(255,255,255,.08)"/>`);
    for (const c of cautions) {
        out.push(`<rect x="${X(c.from).toFixed(1)}" y="${T}" width="${(X(c.to) - X(c.from)).toFixed(1)}" height="${plotH}" fill="rgba(0,0,0,.22)"><title>${esc(c.reason || 'measurement caution')}</title></rect>`);
        out.push(`<text x="${(X(c.from) + 4).toFixed(1)}" y="${H - B - 6}" class="cl">measurement caution</text>`);
    }

    // x axis ticks every 10 s
    for (let s = 0; s <= durationS; s += 10) {
        out.push(`<line x1="${X(s).toFixed(1)}" x2="${X(s).toFixed(1)}" y1="${H - B}" y2="${H - B + 4}" stroke="#d0d0d0"/>`);
        out.push(`<text x="${X(s).toFixed(1)}" y="${H - 4}" class="ax" text-anchor="middle">${s}s</text>`);
    }

    // scene lines; labels on 3 rows so close marks do not overlap
    scenes.forEach((m, i) => {
        const x = X(m.t).toFixed(1);
        out.push(`<line x1="${x}" x2="${x}" y1="${T - 4}" y2="${H - B}" stroke="#e3c9ff" stroke-width="1.5"/>`);
        out.push(`<text x="${(+x + 3).toFixed(1)}" y="${10 + (i % 3) * 11}" class="sc">${esc(LABELS[m.label] || m.label)}</text>`);
    });

    const line = (pts, color, width) => {
        const segs = [];
        let cur = [];
        for (const p of pts) {
            if (p.y == null) { if (cur.length) segs.push(cur); cur = []; continue; }
            cur.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`);
        }
        if (cur.length) segs.push(cur);
        return segs.filter((s) => s.length > 1).map((s) => `<polyline points="${s.join(' ')}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="round"/>`).join('');
    };
    const inWin = (arr) => arr.filter((p) => p.t >= t0 && p.t <= t1);

    // breathing wave: own scale (shape only, no unit)
    const bw = inWin(breath);
    const bv = bw.filter((p) => p.v != null).map((p) => p.v);
    if (bv.length > 1) {
        const lo = Math.min(...bv), hi = Math.max(...bv), span = hi - lo || 1;
        const by = (p) => (p.v == null ? null : T + plotH - ((p.v - lo) / span) * plotH);
        out.push(line(bw.map((p) => ({ x: X(p.t), y: by(p) })), 'rgba(159,211,255,.35)', 1.2));        // all values, faint
        out.push(line(bw.map((p) => ({ x: X(p.t), y: p.s === false ? null : by(p) })), '#9fd3ff', 1.4)); // stable parts
    }
    // pulse: BPM scale, labels at right
    const pw = inWin(pulse);
    const pv = pw.filter((p) => p.v != null).map((p) => p.v);
    if (pv.length > 1) {
        const lo = Math.floor(Math.min(...pv)) - 1, hi = Math.ceil(Math.max(...pv)) + 1;
        out.push(line(pw.map((p) => ({ x: X(p.t), y: p.v == null ? null : T + plotH - ((p.v - lo) / (hi - lo)) * plotH })), '#ffb3ad', 2));
        out.push(`<text x="${W - R + 4}" y="${T + 8}" class="pl">${hi}</text><text x="${W - R + 4}" y="${H - B}" class="pl">${lo}</text>`);
        out.push(`<text x="${W - R + 4}" y="${T + plotH / 2 + 4}" class="pl">BPM</text>`);
    } else {
        out.push(`<text x="${L + 6}" y="${T + 14}" class="pl">pulse not measured</text>`);
    }
    if (bv.length <= 1) out.push(`<text x="${L + 6}" y="${T + 28}" class="ax">breathing not measured</text>`);

    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Breathing and pulse during the ad" xmlns="http://www.w3.org/2000/svg">`
        + '<style>.ax{font:10px system-ui,sans-serif;fill:#d0d0d0}.sc{font:10px system-ui,sans-serif;fill:#e3c9ff}.pl{font:10px system-ui,sans-serif;fill:#ffb3ad}.cl{font:10px system-ui,sans-serif;fill:#d0d0d0}</style>'
        + out.join('') + '</svg>';
}

// Compare view: pulse change vs rest (BPM), one line per result file, on one ad's time axis.
// opts: { lines: [{ values: [bpm|null], startOffsetS, rest, simulated }], durationS, scenes, cautions }
function overlayChartSvg(opts) {
    const W = 760, H = 200, L = 44, R = 44, T = 40, B = 22;
    const { lines = [], durationS, padS = 10, scenes = [], cautions = [] } = opts;
    const t0 = -padS, t1 = durationS + padS;
    const X = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
    const plotH = H - T - B;
    const deltas = lines.map((ln) => ln.values.map((v, i) => ({ t: ln.startOffsetS + i, d: v == null || ln.rest == null ? null : v - ln.rest })));
    const all = deltas.flat().filter((p) => p.d != null && p.t >= t0 && p.t <= t1).map((p) => p.d);
    const m = Math.max(5, Math.ceil(Math.max(0, ...all.map(Math.abs))));
    const Y = (d) => T + plotH / 2 - (d / m) * (plotH / 2);
    const out = [];
    out.push(`<rect x="${X(0).toFixed(1)}" y="${T}" width="${(X(durationS) - X(0)).toFixed(1)}" height="${plotH}" fill="rgba(255,255,255,.08)"/>`);
    for (const c of cautions) {
        out.push(`<rect x="${X(c.from).toFixed(1)}" y="${T}" width="${(X(c.to) - X(c.from)).toFixed(1)}" height="${plotH}" fill="rgba(0,0,0,.22)"><title>${esc(c.reason || 'measurement caution')}</title></rect>`);
    }
    for (let s = 0; s <= durationS; s += 10) {
        out.push(`<text x="${X(s).toFixed(1)}" y="${H - 4}" class="ax" text-anchor="middle">${s}s</text>`);
    }
    scenes.forEach((sc, i) => {
        const x = X(sc.t).toFixed(1);
        out.push(`<line x1="${x}" x2="${x}" y1="${T - 4}" y2="${H - B}" stroke="#e3c9ff" stroke-width="1.5"/>`);
        out.push(`<text x="${(+x + 3).toFixed(1)}" y="${10 + (i % 3) * 11}" class="sc">${esc(LABELS[sc.label] || sc.label)}</text>`);
    });
    out.push(`<line x1="${L}" x2="${W - R}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}" stroke="#d0d0d0" stroke-dasharray="3 3"/>`);
    out.push(`<text x="${W - R + 4}" y="${(Y(0) + 4).toFixed(1)}" class="ax">rest</text>`);
    out.push(`<text x="${W - R + 4}" y="${T + 8}" class="pl">+${m}</text><text x="${W - R + 4}" y="${H - B}" class="pl">−${m}</text>`);
    // simulated first (underneath), real on top
    const order = lines.map((ln, i) => i).sort((a, b) => Number(!!lines[b].simulated) - Number(!!lines[a].simulated));
    for (const i of order) {
        const sim = !!lines[i].simulated;
        let seg = [];
        const segs = [];
        for (const p of deltas[i]) {
            if (p.d == null || p.t < t0 || p.t > t1) { if (seg.length > 1) segs.push(seg); seg = []; continue; }
            seg.push(`${X(p.t).toFixed(1)},${Y(p.d).toFixed(1)}`);
        }
        if (seg.length > 1) segs.push(seg);
        for (const sg of segs) {
            out.push(sim
                ? `<polyline points="${sg.join(' ')}" fill="none" stroke="rgba(220,220,220,.45)" stroke-width="1" stroke-dasharray="4 3"/>`
                : `<polyline points="${sg.join(' ')}" fill="none" stroke="#ffb3ad" stroke-width="2.2"/>`);
        }
    }
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Pulse change versus rest during the ad, one line per result file" xmlns="http://www.w3.org/2000/svg">`
        + '<style>.ax{font:10px system-ui,sans-serif;fill:#d0d0d0}.sc{font:10px system-ui,sans-serif;fill:#e3c9ff}.pl{font:10px system-ui,sans-serif;fill:#ffb3ad}</style>'
        + out.join('') + '</svg>';
}

module.exports = { adChartSvg, overlayChartSvg };
