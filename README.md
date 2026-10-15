# Titan Engine

Titan Engine is a browser based space simulator built with TypeScript, Three.js, WebGL and a custom React interface in [TitanUI](src/ui/TitanUI). It includes custom GLSL rendering and tools for managing 3D simulations.

Explore the live scenario list in [`src/config/scenarios.ts`](src/config/scenarios.ts). The application includes Solar System, exoplanet and fictional scenarios.

## Screenshots

Earth
![earth](https://github.com/user-attachments/assets/3c87abd8-790e-4ea4-b541-cfd094f0b600)

Saturn
![saturn](https://github.com/user-attachments/assets/42de41d2-fa33-4ae8-89c3-4655e7b89612)

Uranus with one of its satellites
![uranus](https://github.com/user-attachments/assets/dbf32848-bc4f-442e-8c29-f3a3a295b484)

Neptune
![neptune](https://github.com/user-attachments/assets/45ee5775-8b7d-4d0a-b0da-5d43b662d4a0)

Pluto and Charon
![pluto](https://github.com/user-attachments/assets/cfec26e7-d187-44a5-bedd-507374ccc5e5)

## Requirements and commands

Use Node.js 24 and npm. Install the locked dependencies and start the Vite development server:

```sh
npm ci
npm run dev
```

The development server is available at <http://127.0.0.1:8085>. Common project checks and builds:

```sh
npm run typecheck
npm run lint
npm test -- --run
npm run build
npm run preview
```

`npm test` runs typecheck and starts Vitest in watch mode; add `-- --run` to run once in CI or a terminal. The optional `npm run test:perf` checks performance budgets and is timing sensitive, so run it separately from correctness checks.

### Rebuilding the Google Sans webfont

The checked-in `GoogleSans-Regular.woff2` is a lossless WOFF2 conversion of the full `GoogleSans-Regular.ttf` source, made with `wawoff2@2.0.1`. To reproduce it without adding font tooling to the application dependencies, install the codec into a temporary prefix and run its converter from the repository root:

```powershell
npm.cmd install --prefix .superpowers/sdd/2026-10-15-audit-remediation/font-tools wawoff2@2.0.1 --ignore-scripts --no-audit --no-fund
node .superpowers/sdd/2026-10-15-audit-remediation/font-tools/node_modules/wawoff2/bin/woff2_compress.js src/ui/TitanUI/assets/fonts/GoogleSans-Regular.ttf src/ui/TitanUI/assets/fonts/GoogleSans-Regular.woff2
```

## Environment

Copy [`.env.example`](.env.example) to `.env` and adjust the build-time settings as needed. Vite embeds every `VITE_` value into browser code, so these settings are public and must not contain credentials.

| Variable | Example/default | Purpose |
| --- | --- | --- |
| `VITE_APP_NAME` | `Titan Engine` | Application title |
| `VITE_SHOW_STATS_PANEL` | `false` | Only the exact value `true` enables the stats panel |
| `VITE_FS_DRIVER` | `local` | Selects `local` or `s3` resource loading |
| `VITE_FILE_BUCKET` | `textures` | Resource directory or bucket name |
| `VITE_S3_URL` | empty | S3-compatible endpoint; needed with the `s3` driver |
| `VITE_SKY_SOURCE` | `gaia` | Selects `gaia` or `cubemap`; changing it requires a rebuild |

For local resources, `LocalFileSystemDriver` serves files from `/images/<bucket>/<filename>`. The default `textures` bucket therefore needs `public/images/textures` to point to `storage/images/textures`. Ensure the target directory exists and the link path does not, then create a junction in PowerShell:

```powershell
New-Item -ItemType Junction -Path public/images/textures -Target (Resolve-Path storage/images/textures)
```

On macOS/Linux, from the repository root:

```sh
ln -s ../../storage/images/textures public/images/textures
```

Do not replace `public/images`; it contains tracked application images. Texture, heightmap and model resources are owner-provided and are not included by `npm ci` or a Git clone. After obtaining the resource archive/local copy and creating the mapping, check required local files without contacting cloud storage:

```sh
npm run cloud:manifest -- --check
```

`npm run fetch:gaia-sky` downloads only the Gaia sky files into `public/images/textures/sky/gaia`; it does not fetch planetary resources. The Gaia sky map is by Eric Bruneton and is built from ESA Gaia DR2 and Tycho-2 catalogues; it is used with the author's permission for non-commercial purposes. For S3 mode, configure a readable endpoint and bucket with CORS that permits requests from the app.

## Tests and GPU checks

`npm test -- --run` works from a clean clone without the external resource archive. Measurements of actual water textures and terrain heightmaps run only when the corresponding local files exist; Vitest reports those measurements as skipped otherwise. Water precision guards and the moonlet upload-manifest checks always run. A present but invalid water texture still fails its measurements. Use `npm run cloud:manifest -- --check` to require all runtime resources locally before uploading them.

The standard Vitest suite runs in jsdom. It covers CPU and UI behavior but does not execute the `.gpu.ts` probes, which require a real WebGL2 browser context. Start `npm run dev`, open the app in WebGL2-capable Chrome or Firefox, and paste this into the browser developer console. The sequence awaits each probe and stops on a thrown failure; the black-hole depth probe runs with both 0 and 4 samples.

```js
const probes = [
  ['/tests/atmosphere/terminator.gpu.ts', 'checkAtmosphereTerminator'],
  ['/tests/blackHole/insideDepth.gpu.ts', 'checkBlackHoleInsideDepth'],
  ['/tests/star/lodPhotometry.gpu.ts', 'checkStarLodPhotometry'],
  ['/tests/star/granulationFiltering.gpu.ts', 'checkStarGranulationFiltering'],
  ['/tests/star/granulationPhotometry.gpu.ts', 'checkStarGranulationPhotometry'],
  ['/tests/star/cameraFinalization.gpu.ts', 'checkStarCameraFinalization'],
  ['/tests/star/prominences.gpu.ts', 'checkStarProminences'],
  ['/tests/graphic/stellarBloom.gpu.ts', 'checkStellarBloom'],
  ['/tests/textures/ImageBitmapLifecycle.gpu.ts', 'checkImageBitmapLifecycle'],
];
for (const [path, name] of probes) {
  const module = await import(path);
  const check = module[name];
  console.log(path, name === 'checkBlackHoleInsideDepth'
    ? [await check(0), await check(4)]
    : await check());
}
```

Context restoration tests in Vitest dispatch mocked DOM events. The ImageBitmap lifecycle GPU probe forces real context loss/restoration on an isolated renderer, verifies identical rendered pixels after source re-upload, and checks that final texture disposal closes the bitmap. It does not cover full application recovery. To check application recovery, open a WebGL scenario, obtain its WebGL context from the renderer in the debugger, call `WEBGL_lose_context.loseContext()`, then `restoreContext()` and confirm the scene renders again.

The native terrain worker cancellation check runs independently of the GPU checks. With the development server running, await it in the browser console:

```js
const { checkWorkerCancellation } = await import('/tests/terrain/WorkerCancellation.browser.ts');
console.log(await checkWorkerCancellation());
```

It queues three synthetic 1024² near-shadow tiles, releases the scenario, and checks that no abandoned callbacks run and a new native-worker result matches the warmed result. Reported timings describe this controlled synthetic load, not a production benchmark; the check has no millisecond performance threshold.

## Data editor

The data editor is available in development mode only. Saves made there go through the Vite development server and update files in `storage/database`; the production preview and GitHub Pages build have no save API. Review and back up edited database files before committing them.

See the [project audit](docs/project-audit-2026-10-15.md) for findings and remediation status.

## Data sources

Background sky: [gaia_sky_map](https://github.com/ebruneton/gaia_sky_map) by Eric Bruneton, built from the ESA Gaia DR2 and Tycho-2 star catalogues; used with the author's permission for non-commercial purposes.

The live moving-target flight regression uses the actual anime timeline, CameraController and SceneObserver. Run it separately while the app is idle; it takes about seven seconds and checks follow cancellation, arrival distance, aim, and control/speed restoration. It clears its timers and flight in a final cleanup block.

```js
const { checkMovingTargetFlight } = await import('/tests/transitions/MovingTargetFlight.browser.ts');
console.log(await checkMovingTargetFlight());
```
