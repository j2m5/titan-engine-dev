# Earth cloud source maps

## Earth laboratory

Open `/earth-cloud-lab.html` on the Vite development server (the isolated worktree
uses http://127.0.0.1:8086). The five view buttons place the camera at 20000,
110, 12, 6 and 2 km. Drag to look, use WASD to fly, Q/E to change height,
Shift to accelerate and the wheel to move forward/backward. Earth flight is
limited to 100 m–40000 km. Quality, cloud toggle and Sun angle remain usable
when volume preparation fails; the visible message explains the latched failure.
The toggle disables both the far map and near clouds/shadows.

The calibrated Earth profile retains a 4–8 km shell, extinction 0.0015/m and detail
scales 12 km/1.2 km. Volume fades by distance to the shell: full at 62 km and
off at 142 km. The atmosphere spans radii 6360–6420 km. Both endpoints render
the same physical atmosphere and surface into half-float HDR targets, then
blend `C=(1-w)*C_far+w*C_near` before one AgX presentation pass. The near
endpoint includes full cloud overlay and shadow strength; LOD applies once.

Preparation alone reports `prepared`; only a successful volume update and
near surface render reports `ready`. Compilation/preparation errors latch
`unavailable` until reload and keep the far surface map and flight usable.
Fatal far/presentation errors stop the session and display an error. Camera,
Sun, rotation, quality, size, DPR and off/on changes reset temporal history
before the next positive-weight frame. No volume warm-up runs in orbit.
The depth adaptation analytically intersects the single spherical planet;
additional terrain or meshes require a scene-depth solution.

`npm run test:clouds:earth:gpu` runs maps, surface, composition and lifecycle probes,
then exercises actual page controls, saves the five views/qualities/Sun states and
two continuous descents, and measures RAF frame intervals. Explicit
`--probe=maps|surface|composition|lifecycle|all` runs only the selected probes;
unknown names fail. Reports and PNGs live in `tmpscreenshots/earth-cloud-lab/`.

The demo faces source UV `(0.08203125, 0.4140625)`, about 15°S, by rotating the
planet and its cloud binding together. A decoded 64px source patch has coverage
mean 0.507652, standard deviation 0.373490, range 0–1 and centre 0.605188. Its
cloud edge reveals volume silhouettes and sea separation. The former clear
equatorial framing had almost no near-cloud alpha; a broad dense patch showed
a nearly uniform blanket. Lowering extinction to 0.0003/m changed its colour
without improving structure, so the original physical profile is retained.
Source pixels, canonical UV mapping and far-material appearance are preserved.
Comparison captures are `calibration-moderate-*`, `calibration-extinction0003-*`
and `calibration-edge-*`. The 6360km datum, 4–8km shell, 12km/1.2km noise scales,
erosion 0.35 and seed `0x45617274` remain intentional. Low/medium/high use
resolution scales 0.65/0.8/1, minimum steps 100/50/25m, maximum steps 1000m,
iteration limits 256/512/768 and Sun steps 1/2/4; ray limit is 2000km.

Takram 0.7.6 reads an array-target texture handle before first binding it. The
Earth adapter initializes the current and resolved shadow targets immediately
before their actual draws, ensuring the first near frame contains real shadows.
There is no distant volume work or reference warm-up. GPU freshness comparisons
pin only frame/noise inputs and compare real independent controllers after one
frame. Disabling this preparation in a negative control leaves a zero first
shadow target and is rejected. Geographic probes use asymmetric seam/pole markers,
non-axis rotation, actual weather/receiver bindings and a large origin translation;
disabled rotation/translation controls are rejected before restoring mutations.

Lifecycle checks include a throwing preparation callback, an invalid actual near
surface shader before its first render, and a context-loss event. Recoverable
failures retain the new far map/atmosphere, pixel-changing controls and a latched
diagnostic. Original/derived texture disposal and unique WebGL handle deletion
are counted. postprocessing emits two input-target dispose events while removing
its depth attachment after deallocation; each actual GPU handle is deleted once,
and repeated lab disposal performs no further deletion. Shared fullscreen geometry
may remain in Three's internal cache.

## Acceptance evidence — 2026-10-15

Commands ran from the accepted worktree, with Vite on `127.0.0.1:8086`:

```powershell
npm.cmd exec --no -- vitest run tests/clouds tests/planet/CloudShading.spec.ts tests/planet/CloudShadow.spec.ts tests/planet/CloudLayerMath.spec.ts tests/planet/PlanetCloudOpacity.spec.ts --maxWorkers=2 --reporter=dot
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:clouds:gpu
npm.cmd run test:clouds:earth:gpu
git diff --check
```

Unit result: 20 files / 236 tests passed, including the three bounded CDP transport
regressions. Lint/types/build passed; Vite reported its existing large-chunk warning.
The Earth GPU result is 151 map + 62 surface + 29 composition + 136 lifecycle
checks (378 total), all resources released and no WebGL errors. The nine first-frame
comparisons have zero raw-shadow difference; maximum resolved-overlay difference
is 0.0009765625 at low quality. Both actual off/on sequences are covered: an off
frame was rendered, and a toggle pair occurred between renders. Bound shape/detail
noise varies across three sampled slices (standard deviations 0.067–0.096).
Jupiter's sequential GPU suite also passed: 72 appearance samples, map/rotation,
depth/occlusion, fallback/disposal controls and no GL/runtime errors.

`tmpscreenshots/earth-cloud-lab/all-report.json` contains the actual page states,
counter deltas from periodic telemetry snapshots and all 120 raw RAF intervals
for each view. Counter snapshots are not synchronized to interval boundaries.
Measurements below
used one browser at 1280×800 / DPR1 / medium, after discarding the first 30 RAF
intervals. GPU: ANGLE / AMD Radeon(TM) Graphics (0x1638), Direct3D11. No build or
second GPU suite ran concurrently. These are whole-frame intervals including
VSync and scheduling, not GPU timings or a universal performance threshold.

| View | Median interval (ms) | p95 interval (ms) | Δ frames/cloud/shadow/far/near |
| --- | ---: | ---: | --- |
| Orbit, 20000km | 16.7 | 16.8 | 120 / 0 / 0 / 120 / 0 |
| Transition, 110km | 33.4 | 50.1 | 120 / 120 / 120 / 120 / 120 |
| Above, 12km | 66.8 | 83.5 | 120 / 120 / 120 / 0 / 120 |

First-use shader compilation can pause the page: the first approach capture's
telemetry showed 4838.1ms and the first low-quality switch 2552.5ms. Those samples
are outside the steady measurement window; high-quality captures are also costly
on this integrated GPU. The lab performs no hidden far-view volume warm-up.

Saved and inspected PNGs in the same directory:

- `medium-{orbit,approach,above,inside,below}.png`.
- `{low,high}-{above,inside}.png`, `daylight.png`, `terminator.png`, `night.png`.
- `flight-transition-{150,130,110,90,70}km.png` and
  `flight-shell-{12,10,8,6,4,2}km.png`, captured during real Q/E flight.
- `dist-offline-earth.png`, `dist-offline-jupiter.png`.

The flight filenames identify crossed thresholds; flight continues during capture,
so the report and screenshot telemetry give actual sampled altitudes. Inspection
found continuous cloud silhouettes/sea separation without gross depth holes, a
bright/dark blend seam or a visible duplicate map pattern. A thin stepped raster
horizon and local white-noise grain remain visible. Still images do not establish
the absence of all temporal shimmer; final appearance acceptance belongs to the user.

The production build contains both lab HTML entries and four hashed local Earth
JPEGs, with no test/probe entry. A local Vite preview at `127.0.0.1:8087` was tested
with a request interceptor allowing only its own origin. Both built pages rendered,
and an actual external fetch was blocked. `dist-offline-report.json` records the
four `/assets/earth*.jpg` requests and built control states. Jupiter's full report
is `tmpscreenshots/cloud-lab/report.json`.

## Main-scene handoff

This completes the Earth laboratory; main-scene integration and full removal of
the previous renderer are the next stage. Keep the Earth 7/26, Neptune 13/37 and
Korriban 88/113 image assets and actor/resource links for the new volume profiles
and surface map. Loading a cloud map must eventually stop enabling the old layer.
After a working replacement handles main-scene depth and surface/water shadows,
remove the approved inventory:

- `CloudLayer.ts`, its registration and CPU mirror `cloudLayerMath.ts`.
- Old cloud uniforms/defines, `cloudOpacityForAltitude`, `updateCloudOpacity` and
  bindings in `PlanetSurfaceMaterial` / `PlanetSurfaceShader`.
- Old composition/shadows in `PlanetSurfaceCommon`, `SphereSurfaceShaderTemplate`,
  `TerrainShaderTemplate`, `TerrainMaterial`, and opacity calls in `TerrainSphere`.
- `WaterMaterial.syncClouds`, its `WaterSphere` call, old `WaterShader` uniforms,
  and layer/shadows in `WaterShaderTemplate`.
- Old `cloudHeightKm`, `cloudLightSoftness`, `cloudShadowStrength` settings and
  implementation tests; move source-asset checks to the new path.

The new inexpensive far map composite does not require retaining that code.

## Source provenance and decoding

The four JPEGs are the project's original maps, downloaded on 2026-10-14 from
`https://storage.yandexcloud.net/textures/planets/earth/`. They are stored without
resizing or recoloring. Dimensions and SHA256 were measured with `sharp.metadata()`
and Node's SHA256 implementation after download.

- `earth.jpg`: surface, resource 24, sRGB, 8192 × 4096.
  Source: https://storage.yandexcloud.net/textures/planets/earth/earth.jpg
  SHA256: `d9ebb28b82cfad6c47ae9231fadb339accb72aad2fa31ae42dabbd93d75058dc`
- `earth_clouds.jpg`: clouds, resource 26, sRGB, 8192 × 4096.
  Source: https://storage.yandexcloud.net/textures/planets/earth/earth_clouds.jpg
  SHA256: `1a6ed73ee39b1a6dfb516b257cf94866de84222bc6a67648dbe6738c6801aa82`
  The source JPEG is grayscale; browser decoding supplies RGB values.
- `earth_night.jpg`: night emission, resource 27, sRGB, 4096 × 2048.
  Source: https://storage.yandexcloud.net/textures/planets/earth/earth_night.jpg
  SHA256: `631b6fb83bdb75b0ffb8732fb82898b64ab28ebdffc5b9103706b4a72c50a05c`
- `earth_specular.jpg`: specular data, resource 91, NoColorSpace, 4096 × 2048.
  Source: https://storage.yandexcloud.net/textures/planets/earth/earth_specular.jpg
  SHA256: `b4551b94d90bbfc3cc8df022c08f0718d1cda7c90e59f87c9a9297dc1e56d491`

Visual inspection confirmed a surface geography map, separate cloud structures,
night city lights, and an ocean/land specular mask. Download availability does not
establish a new license; these retain the project's source provenance.

`loadEarthTextures` owns the four original textures and releases successful loads
if any asset fails. Its returned `dispose` is idempotent and deduplicates textures.

`prepareRgbCloudTextures` reads the full natural source dimensions, converts sRGB
once, decodes coverage as `sqrt(mean(linearRGB))`, and computes linear albedo as
`min(linearRGB / max(coverage, 1e-4), 1)`. It averages decoded fields using area
overlap before quantizing to bytes. The default maximum width is 2048, so the
8192 × 4096 cloud source produces 2048 × 1024 weather/color maps. It never
upscales. The original source remains owned by its loader; preparation owns only
its two derived textures. Weather R is coverage and its other channels are zero.
Color RGB is linear albedo and alpha is 255. Derived maps have NoColorSpace,
flipY=false, repeated longitude, clamped latitude, mipmaps and linear filtering.

The source texture's flipY is baked into derived rows. Source wrapping, matrix
and color space are preserved. The shared image reader keeps Jupiter's default
1024-wide HTML image reduction and full-size byte DataTexture path.

With the existing Vite server at port 8086, run the isolated map probe:

```powershell
node scripts/check-earth-cloud-lab.mjs --probe=maps
```

The runner opens only the local `tests/clouds/earth/probe.html` in a temporary
headless Chromium profile. It writes `tmpscreenshots/earth-cloud-lab/maps-report.json`.
The probe checks RGB decoding through actual sRGB GPU uploads, natural HTML image
dimensions, both flipY orientations, repeated longitude samples, the bound mask
weather path, cloud scattering color independence from alpha, shadow/extinction
independence from color, shader compilation, GL errors, and released resources.
