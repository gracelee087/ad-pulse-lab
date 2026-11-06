// ad-pulse-lab — Electron main process.
// SDK usage follows Presage's Node API docs; the code is written for this project.
//
// - The SmartSpectra SDK runs HERE, in the main process, with the native camera (useCamera).
//   The page only plays ads and shows status, so a busy page (ad loading) cannot stall the
//   camera frames. (Running the SDK from the page stopped with a 2.7 s frame gap and crashed.)
// - The page is served from 127.0.0.1 so YouTube embeds get an http origin.
// - The API key is read from .env here and never sent to the page.
// - Session logs go to ./logs/ (git-ignored). No video or face data is written.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { app, BrowserWindow, session, ipcMain } = require('electron');

const ROOT = __dirname;
const LOG_DIR = path.join(ROOT, 'logs');
const ASCII = /^[\x00-\x7F]*$/;

// The native runtime cannot load its model files from a path with non-ASCII characters
// (seen with a Korean folder name). Copy it once to an ASCII-only folder and point the SDK there.
function ensureAsciiRuntime() {
    if (process.platform !== 'win32' || process.env.SMARTSPECTRA_CAPI_PATH) return;
    const src = path.dirname(require.resolve('@smartspectra/node-sdk-win32-x64/package.json'));
    if (ASCII.test(src)) return;
    const candidates = [
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ad-pulse-lab', 'sdk-runtime'),
        path.join(os.tmpdir(), 'ad-pulse-lab-sdk-runtime'),
        path.join(process.env.ProgramData || 'C:\\ProgramData', 'ad-pulse-lab', 'sdk-runtime'),
    ].filter((p) => p && ASCII.test(p));
    for (const dst of candidates) {
        try {
            const marker = path.join(dst, 'smartspectra_manifest.json');
            const same = fs.existsSync(marker) &&
                fs.readFileSync(marker, 'utf8') === fs.readFileSync(path.join(src, 'smartspectra_manifest.json'), 'utf8');
            if (!same) fs.cpSync(src, dst, { recursive: true });
            process.env.SMARTSPECTRA_CAPI_PATH = path.join(dst, 'smartspectra_capi.dll');
            return;
        } catch { /* try next */ }
    }
}
ensureAsciiRuntime();

// Load the SDK only after the runtime path is settled.
const { SmartSpectraSDK, CameraSelection } = require('@smartspectra/node-sdk');
const { bindSmartSpectraIpc } = require('@smartspectra/node-sdk/main');   // used for its one-time SDK preconfigure

function readApiKey() {
    try {
        const text = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
        const m = text.match(/^\s*SMARTSPECTRA_API_KEY\s*=\s*(.*)\s*$/m);
        return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
    } catch {
        return '';
    }
}

// Only these files are served.
const FILES = {
    '/': ['index.html', 'text/html; charset=utf-8'],
    '/index.html': ['index.html', 'text/html; charset=utf-8'],
    '/dist/renderer.bundle.js': ['dist/renderer.bundle.js', 'text/javascript; charset=utf-8'],
};

function startServer() {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const entry = FILES[new URL(req.url, 'http://x').pathname];
            if (!entry) { res.writeHead(404); res.end(); return; }
            res.writeHead(200, { 'Content-Type': entry[1], 'Cache-Control': 'no-store' });
            fs.createReadStream(path.join(ROOT, entry[0])).pipe(res);
        });
        server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
    });
}

let logFile = null;
let sdk = null;

async function stopSdk() {
    const s = sdk;
    sdk = null;
    if (!s) return;
    try { await s.stopAsync(); } catch { /* ignore */ }
    try { await s.destroy(); } catch { /* ignore */ }
}

app.whenReady().then(async () => {
    const origin = await startServer();
    const fromApp = (url) => typeof url === 'string' && url.startsWith(origin + '/');
    const ok = (e) => fromApp(e.senderFrame && e.senderFrame.url);

    // Camera (video only) for the blurred positioning preview, only for our own page.
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
        const url = (details && details.requestingUrl) || '';
        const types = (details && details.mediaTypes) || [];
        callback(permission === 'media' && types.length === 1 && types[0] === 'video' && fromApp(url));
    });

    ipcMain.handle('adpulse:hasKey', (e) => ok(e) && readApiKey().length > 0);

    ipcMain.handle('adpulse:startLog', (e) => {
        if (!ok(e)) return null;
        fs.mkdirSync(LOG_DIR, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        logFile = path.join(LOG_DIR, `session-${stamp}.jsonl`);
        return logFile;
    });
    ipcMain.on('adpulse:log', (e, row) => {
        if (!logFile || !ok(e)) return;
        try { fs.appendFileSync(logFile, JSON.stringify(row) + '\n'); } catch { /* ignore */ }
    });

    // Scene marks per ad (seconds from ad start).
    const SCENES = path.join(ROOT, 'scenes.json');
    ipcMain.handle('adpulse:getScenes', (e) => {
        if (!ok(e)) return {};
        try { return JSON.parse(fs.readFileSync(SCENES, 'utf8')); } catch { return {}; }
    });
    ipcMain.handle('adpulse:saveScenes', (e, data) => {
        if (!ok(e) || typeof data !== 'object') return false;
        fs.writeFileSync(SCENES, JSON.stringify(data, null, 2) + '\n');
        return true;
    });

    // SDK in the main process.
    ipcMain.handle('adpulse:sdkStart', async (e, opts) => {
        if (!ok(e)) return { ok: false, message: 'not allowed' };
        await stopSdk();
        const wc = e.sender;
        const send = (msg) => { try { if (!wc.isDestroyed()) wc.send('adpulse:sdk', msg); } catch { /* ignore */ } };
        const metrics = Array.isArray(opts && opts.requestedMetrics) ? opts.requestedMetrics.filter((n) => Number.isInteger(n)) : undefined;
        try {
            sdk = new SmartSpectraSDK({
                apiKey: readApiKey(),
                requestedMetrics: metrics,
                enableAccumulatedOutput: false,
                enableTelemetry: false,
            });
            sdk.on('processingStatus', (status) => send({ kind: 'processingStatus', status }));
            sdk.on('validationStatus', (code, ts, hint) => send({ kind: 'validationStatus', code, ts, hint }));
            sdk.on('metrics', (buf, ts) => send({ kind: 'metrics', buf: new Uint8Array(buf), ts }));
            sdk.on('error', (code, message, retryable) => send({ kind: 'error', code, message, retryable }));
            sdk.useCamera(CameraSelection.default, { width: 1280, height: 720, fps: 30 });
            sdk.start();
            return { ok: true };
        } catch (err) {
            await stopSdk();
            return { ok: false, code: err.code, message: err.message || String(err) };
        }
    });
    ipcMain.handle('adpulse:sdkStop', async (e) => { if (ok(e)) await stopSdk(); return true; });

    const win = new BrowserWindow({
        width: 1280,
        height: 800,
        backgroundColor: '#6b6b6b',
        webPreferences: {
            preload: path.join(ROOT, 'preload.js'),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            autoplayPolicy: 'no-user-gesture-required',
        },
    });

    bindSmartSpectraIpc(win);   // one-time SDK preconfigure (cache directory); the page does not use its bridge

    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => { if (!fromApp(url)) event.preventDefault(); });

    win.loadURL(origin + '/');
    if (process.env.ADPULSE_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' });
});

app.on('before-quit', () => { stopSdk(); });
app.on('window-all-closed', () => app.quit());
