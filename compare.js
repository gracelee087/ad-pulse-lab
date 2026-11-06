// ad-pulse-lab — Compare view: several result files side by side (HTML string; all file text escaped).
// Real and SIMULATED files are always counted separately and marked.
'use strict';

const { overlayChartSvg } = require('./chart');

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const FORMAT = 'ad-pulse-lab result v1';

// files: [{ name, text }] -> { html, errors }
function renderCompare(files) {
    const ok = [], errors = [];
    for (const f of files) {
        try {
            const d = JSON.parse(f.text);
            if (d.format !== FORMAT || !Array.isArray(d.ads)) throw new Error('not an ad-pulse-lab result file');
            ok.push({ name: f.name, d, sim: d.simulated === true });
        } catch (e) { errors.push(`${f.name}: ${e.message}`); }
    }
    const out = [];
    if (ok.some((f) => f.sim)) {
        out.push('<p class="simbanner">This view includes <b>SIMULATED</b> files (not real people, not measurements; random noise with no built-in ad effect). They only show how this view works and say nothing about the ads.</p>');
    }
    if (errors.length) out.push(`<p class="hint err">Skipped: ${errors.map(esc).join('; ')}</p>`);
    if (!ok.length) return { html: out.join('') || '<p>No result files loaded.</p>', errors };

    const tag = (f) => (f.sim ? '<span class="badge sim">SIMULATED</span>' : '<span class="badge real">real</span>');
    out.push('<table class="cmp"><thead><tr><th>File</th><th>Type</th><th>Rest pulse</th><th>Ad order</th></tr></thead><tbody>');
    for (const f of ok) {
        const order = f.d.ads.slice().sort((a, b) => a.position - b.position).map((a) => a.ad.split('_')[0]).join(' → ');
        out.push(`<tr><td>${esc(f.d.tester_id || f.name)}</td><td>${tag(f)}</td><td>${esc(f.d.rest && f.d.rest.pulse_bpm)} BPM</td><td>${esc(order)}</td></tr>`);
    }
    out.push('</tbody></table>');

    const adIds = [];
    for (const f of ok) for (const a of f.d.ads) if (!adIds.includes(a.ad)) adIds.push(a.ad);
    for (const id of adIds) {
        const rows = ok.map((f) => ({ f, a: f.d.ads.find((x) => x.ad === id) })).filter((r) => r.a);
        const first = rows[0].a;
        const count = (sim) => {
            const rs = rows.filter((r) => r.f.sim === sim);
            if (!rs.length) return null;
            const cmp = rs.filter((r) => r.a.pulse_vs_rest != null);
            const lower = cmp.filter((r) => r.a.pulse_vs_rest < 0).length;
            const buy = rs.filter((r) => r.a.purchase === 'buy').length;
            const like = rs.filter((r) => r.a.liking === 'like').length;
            return `${sim ? 'SIMULATED' : 'Real'}: ${rs.length} file(s) · pulse lower than rest in ${lower} of ${cmp.length} compared · buy ${buy} · like ${like}`;
        };
        out.push(`<h2>${esc(first.title || id)}</h2>`);
        out.push(`<p class="small">${[count(false), count(true)].filter(Boolean).map(esc).join('<br>')}</p>`);
        const scenes = (rows[0].f.d.scenes && rows[0].f.d.scenes[id]) || [];
        const cautions = ((rows[0].f.d.scenes && rows[0].f.d.scenes._caution) || {})[id] || [];
        const lines = rows.map(({ f }) => {
            const c = (f.d.curves || []).find((x) => x.ad === id);
            return c && Array.isArray(c.pulse_bpm_1hz) ? { values: c.pulse_bpm_1hz, startOffsetS: c.start_offset_s ?? -10, rest: f.d.rest && f.d.rest.pulse_bpm, simulated: f.sim } : null;
        }).filter(Boolean);
        if (lines.length) out.push(overlayChartSvg({ lines, durationS: Number(first.duration_s) || 60, scenes, cautions }));
        else out.push('<p class="small">No per-second curves in these files.</p>');
        out.push('<table class="cmp"><thead><tr><th>File</th><th>Type</th><th>Pulse vs rest</th><th>Answers</th></tr></thead><tbody>');
        for (const { f, a } of rows) {
            const v = a.pulse_vs_rest == null ? 'not compared' : `${a.pulse_vs_rest > 0 ? '+' : ''}${a.pulse_vs_rest} BPM`;
            out.push(`<tr><td>${esc(f.d.tester_id || f.name)}</td><td>${tag(f)}</td><td>${esc(v)}</td><td>${esc(String(a.purchase || '?').replace('_', ' '))} / ${esc(a.liking || '?')}</td></tr>`);
        }
        out.push('</tbody></table>');
    }
    out.push('<p class="small">Red solid lines = real files; grey dashed lines = SIMULATED files. Each line is pulse minus that file\'s rest pulse (1 value per second). A few people are not a study: differences here are not evidence about the ads.</p>');
    return { html: out.join(''), errors };
}

module.exports = { renderCompare };
