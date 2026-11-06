# Ad Pulse Lab

A consented ad-reaction test. A viewer watches 3 coffee ads in random order while the webcam measures **breathing** and **pulse** on their own PC with the [Presage SmartSpectra SDK](https://www.npmjs.com/package/@smartspectra/node-sdk). After each ad the viewer answers two questions themselves: *Would you buy it?* and *Did you like the ad?*

The app shows body measurements **next to** the viewer's own answers. It does not guess feelings, does not use facial expressions, and does not judge the viewer or the ads.

Built for the DEV × Presage SmartSpectra challenge (2026).

## What it does

1. **Consent screen**: two required checkboxes (measurement, reviewing and sending the result yourself) and one optional checkbox (anonymous, combined use in a write-up and demo video).
2. **Positioning**: a blurred camera preview with face and chest boxes. The preview is not saved.
3. **Camera check**: waits until the SDK reports the face and lighting are OK.
4. **Rest**: 30 s warm-up, then 90 s of a gray screen. This is the reference for everything after it.
5. **3 ads** (YouTube embeds, 60–77 s each) in random order, with 45 s of rest after each ad. After each ad: Buy / Not buy and Like / Dislike.
6. **Your results**: pulse and breathing rate per ad compared with rest, your answers, how much of the signal was usable, and one chart per ad (breathing wave, pulse, scene lines).
7. **Approve and save** writes one result file. **Delete** removes the session.

The whole session takes about 9 minutes.

**Compare result files** (on the first screen) loads several result files and shows each ad's pulse change against rest, one line per file. It needs no camera and no API key.

## How the SDK is used

| What | Where | Why |
|---|---|---|
| `SmartSpectraSDK` with `useCamera(default, 1280×720 @ 30 fps)` | `main.js` (Electron main process) | Running the SDK in the page stopped with a 2.7 s frame gap and crashed while ads were loading. In the main process, a busy page cannot stall the camera frames. |
| `enableTelemetry: false` | `main.js` | No SDK usage statistics are sent. |
| `cardio.pulseRate`, `breathing.rate` (value, `stable`, confidence) | `renderer.js` | Pulse and breathing rate per ad, compared with the rest period. Only values marked stable are used. |
| `breathing.upperTrace` | `renderer.js` | The breathing wave in the per-ad chart, so changes can be seen around each scene. |
| `validationStatus` events | `renderer.js` | The camera check, and on-screen alerts when the face or lighting is lost during an ad. |

SDK events are passed from the main process to the page over IPC, and the page decodes them with `decodeMetrics`. The API key is read from `.env` in the main process and is never sent to the page.

**Reliability rule**: an ad's average is compared with rest only when at least 70% of its values are stable (`MIN_USABLE_PCT = 70`). Otherwise the result screen shows the number but marks it "not compared".

**Limits to keep in mind**: pulse is a 12-second average and breathing rate a 30-second average, so short moments are smoothed out. Talking and moving disturb the measurement.

## Install and run

Tested on **Windows 11** with Node.js 22. Other platforms have not been tested.

You need a SmartSpectra API key from Presage, a webcam, and an internet connection (for the YouTube ads and the SDK's key check).

```bash
git clone https://github.com/gracelee087/ad-pulse-lab.git
cd ad-pulse-lab
npm install
```

Create a file named `.env` in the project folder with this line:

```
SMARTSPECTRA_API_KEY=your-key-here
```

`.env` is git-ignored. Do not commit it.

Then start the app:

```bash
npm start
```

`npm start` bundles `renderer.js` with esbuild into `dist/` and opens the Electron window. The first screen says whether the API key was found.

### Try it without a key

- **Test ad playback (no camera)**: checks that all 3 ads play.
- **Compare result files**: pick the files in `sample-data/simulated/`.

### Windows note

The SDK's native runtime could not load its model files from a folder path with non-ASCII characters (seen with a Korean folder name). On Windows, `main.js` then copies the runtime once to an ASCII-only folder (under `%LOCALAPPDATA%\ad-pulse-lab\sdk-runtime`, or a temp folder) and points the SDK there.

## Consent and Data Handling

- **Camera consent**: measuring starts only after the viewer ticks the required consent boxes. The viewer can stop at any time by closing the window.
- **Processed on this PC**: the SDK runs on the viewer's PC. Camera video and face data are never saved and never sent by the app. The positioning preview is blurred and not saved.
- **Network**: the SDK connects to Presage to check the API key. The ads are YouTube embeds, so YouTube receives the usual video player requests.
- **SDK telemetry**: turned off (`enableTelemetry: false`).
- **AI services**: none are used.
- **What is stored, and where**:
  - During a session, measurement values (no video) are written to `logs/session-*.jsonl` in the app folder.
  - **Approve and save** writes one result file to `Documents\AdPulseLab\adpulse-result-<id>-<date>.json` and then deletes the session log.
  - **Delete** deletes the session log and writes no result file.
  - If the window is closed in the middle of a session, the session log stays in `logs/` until the app starts again; it is deleted at the next start.
- **What the result file contains**: a random ID (no name), the consent choices, the ad order, the Buy/Like answers, pulse and breathing numbers per ad and for rest, and, if the viewer leaves the box ticked, one value per second of breathing and pulse per ad. No video, no images, no face landmarks.
- **Sharing**: the app never uploads the result file. The viewer sends it to the organizer themselves.
- **Retention and deletion**: the viewer can delete their own files at any time. The consent screen says the organizer deletes received files on request, and all files after the contest results (December 2026).
- **Not medical**: this is not a medical test. The numbers are not health advice and are not used for any medical decision.

## Sample data (SIMULATED)

`sample-data/simulated/` holds 8 result files made by `tools/make-simulated.js` (seed 1). They are **not real people and not measurements**. Each file is random noise around a random rest pulse, and no ad has any built-in effect, so any difference between ads in these files is chance. They only exist to show how the Compare view works.

Each file has `"simulated": true`, and the Compare view marks it **SIMULATED**, shows a warning banner, and counts it separately from real files.

To regenerate them:

```bash
node tools/make-simulated.js 8 sample-data/simulated 1
```

## Files

| File | Purpose |
|---|---|
| `main.js` | Electron main process: SDK, camera, local page server, result saving |
| `preload.js` | The small bridge the page may call |
| `renderer.js` | Screens, ad playback, metric decoding, result summary |
| `chart.js` | Per-ad chart and the Compare overlay chart (inline SVG) |
| `compare.js` | Compare view |
| `index.html` | Screens and styles |
| `scenes.json` | Scene marks per ad (brand, product, key message, emotional peak, tagline) and caution bands |
| `tools/make-simulated.js` | Generates the SIMULATED sample files |

## Ads

The ads are public YouTube videos played in an embedded player. They are not copied into this repository.

- Starbucks UK — Every Table Has A Story (`o-Ikkh5oxuo`)
- NESCAFÉ Dolce Gusto — ECLIPSE machine (`VLB3NzJPBiA`)
- Taylors of Harrogate — Welcome to Coffee (`BrQfpdQv2Mo`)

## License

The code in this repository is under the [MIT License](LICENSE).

The Presage SmartSpectra SDK (`@smartspectra/node-sdk`, installed by `npm install`) is not part of this repository and is proprietary to Presage and is used under Presage's Terms of Service (<https://physiology.presagetech.com/tos>; see `node_modules/@smartspectra/node-sdk/LICENSE`). The ads belong to their owners.
