# Clouds in the main scene

The normal application renders one selected volumetric body at a time. Earth and
Jupiter have volume profiles; Neptune and Korriban keep their authored surface
cloud maps. The Earth and Jupiter lab demos remain available at
`/earth-cloud-lab.html` and `/cloud-lab.html`.

## Configuration and source images

`IPlanetRenderingObject.clouds` / `CloudConfig` is the public override. Explicit
configuration takes precedence over the actor preset; explicit `{ enabled: false }`
disables clouds. Absence resolves the configured actor preset, without searching diffuse
textures for undeclared clouds. Validation reports unsupported or invalid
configuration and uses a far fallback.

The presets are actor 7 / resource 26 (Earth), actor 10 / resource 32 (Jupiter),
actor 13 / resource 37 (Neptune), and actor 88 / resource 113 (Korriban). Original
resource records and actor links remain intact. JPEG versus PNG does not choose
the encoding. Earth, Neptune and Korriban declare `rgb-cloud-map`: encoded RGB
is decoded to linear luminance for coverage and preserves the original authored
far color. Scalar masks declare the channel, range, exponent, inversion and
sample space. A scalar far map may borrow a separately declared color source.
Jupiter declares an appearance source from its original diffuse image and retains
the diffuse surface under the volume.

All images come from production ResourceObserver / ResourceStorage. Clouds borrow
the original Texture, Source and ImageBitmap without loading duplicates, flipping
the bitmap or disposing shared owners. RGB decoding happens before reduction;
Earth's derived coverage is capped at 2048 × 1024. The far endpoint retains the
original source. Tiled cooperative preparation yields between bounded CPU slices;
source preparation wall time and first shader activation are separate costs.

## Quality, selection and composition

Settings exposes Show clouds and low / medium / high quality. Quality changes
retire owned volume resources and prepare the current generation again. The
initial setting is medium. Only one volume and its shadows are active, with no
depth, cloud or shadow work outside the cutoff.

LOD uses distance to the cloud shell, rather than distance to the model datum.
Earth's layer is 4–8 km, full volume below a shell distance of 62 km and far-only
at 142 km. Above the layer these correspond to datum altitudes 70 and 150 km.
Jupiter's layer is 10–30 km, with full / cutoff shell distances 100 / 1000 km
(datum altitudes 130 / 1030 km). Selection considers containment, frustum
intersection, distance and hysteresis.

The main scene retains `SpaceScale = 10^-3.3` units per kilometre. Body-local
metres are `(worldPosition - bodyCenter) * (1000 / SpaceScale)`. Cloud layer
altitude accounts separately for model datum and atmosphere bottom; body rotation
comes from the current surface transform. Engine updates simulation, controls,
follow and collision before rendering. Capturing a screenshot renders with delta
zero and does not advance simulation.

Composition mixes two linear HDR endpoints: `(1 - w) * C_far + w * C_near`.
At zero weight only the far endpoint executes; at full weight only the near
endpoint executes. A fractional frame renders each endpoint once, updates clouds
and shadows once, then executes the final HDR chain once. Main atmosphere slots,
LUTs and lighting remain authoritative; near aerial perspective occurs once.
The application keeps ownership of exposure, bloom and AgX. Earth powder
darkening stays disabled.

Depth uses actual current opaque geometry and visible water, then merges their
depths. It retains the source camera's logarithmic far-plane encoding. Terrain,
foreground geometry and water stop the volume at the visible surface. Separate
far and near receiver materials preserve the sampler limit while borrowing the
exact current Uniform objects. Cloud shadows modulate direct light without
darkening ambient or night emission. Dust, nebula and lens passes remain in the
existing endpoint order. An incompatible visible gravitational lens forces a
diagnosed far fallback; the real lens scenario uses the existing lens path.

## Readiness, failures and ownership

A positive effective weight requires a completed current source, atmosphere slot,
LUT generation, depth, cloud and shadow result. Source replacement or eviction
invalidates old bindings before the next draw, including replacement under the
same resource ID. Stale asynchronous completions dispose only their derivatives.
Invalidation follows the source paths actually read, including missing sources
that arrive later. Unrelated actor textures do not cancel pending preparation.
Scenario changes, quality changes, camera discontinuities, resizing and context
events invalidate history and borrowed output handles.

Unknown, nonselected or depth shader compilation failures disable volume until
genuine WebGL context loss followed by restoration. Changing source, quality or
scenario cannot clear that latch. Positively attributed owned near failures can
retry at a deliberate boundary through owned material epochs; every participating
owned variant is retired once. This mechanism neither repairs an invalid original
far material nor detects failed programs cached before observation. The runtime
never forces context loss automatically.

Clouds release their own depth, volume, shadow and endpoint resources. Shared
renderer, atmosphere LUT and source owners remain with the application. Context
loss retires owned GPU handles before restoration; ResourceStorage retains CPU
image identity and streaming residency while retiring lost GPU handles. The
application binding assumes one shared renderer; simultaneous renderer ownership
is outside that contract. Scenario exits do not dispose that shared renderer.

## Verification and measured limits

`npm run test:clouds:scene:gpu -- --probe=all` runs the registered numerical and
actual-app flight checks. A missing report, missing case, rejected import, stale
completion, absent RAF progression, unexpected WebGL error or nonzero browser exit
fails the runner. Intentional shader failures retain their raw diagnostics and
are classified only within recorded injection timestamp windows.

The flight probe requires `SCENE_CLOUD_PROBE_URL` pointing at a local test server
that serves the normal application and original assets. It runs without historical
files: its terrain reference uses the current Earth at JD 2451545, viewed from
70 km on the sunward side. Optional `SCENE_CLOUD_BASELINE_DIR` selects a saved
`terrain-evidence.json` pose instead and requires matching GPU identity,
viewport, DPR and renderer pixel ratio. `loaded-evidence.json` is not needed.
Neither mode silently treats another device's timings as a comparable baseline.
The runner navigates from the test page to `/`, clicks
the production Solar button, then imports test access. It never constructs a
replacement application scene. Functional frame PNGs and metadata are saved in
ignored `tmpscreenshots/scene-clouds/`; warm performance samples exclude screenshot
capture. No test-only access or debug UI is required in the shipped application.
Returning from the forced far reference waits up to 30 seconds for normal GPU
warmup and full near weight. Producer and endpoint budgets are measured on the
subsequent captured frame, preserving the exact one-update assertions.
For an explicitly scoped remaining-case check, `SCENE_CLOUD_FLIGHT_START=peak`
starts after the completed Earth path. Its report declares `scope: "peak"` and
requires only its executed cases; it does not report a complete flight. Omitting
the variable runs the full path. Other values fail validation.

Performance reports retain GPU/browser identity, viewport/DPR, epoch, quality,
camera, source revisions, current LUT generation, geometry readiness, 120 warmup
frames and 300 measured intervals. RAF intervals measure scheduling and CPU/GPU
backpressure; they are not GPU milliseconds. `renderer.info` memory counts objects,
not bytes. Historical baseline render counters used `autoReset=true` and describe
only the last composer pass; current whole Engine frame counts cannot be compared
to those as whole-frame draw deltas. The six saved Earth baseline poses failed
terrain loading; only the separate loaded shoreline capture is a terrain baseline.

Original Io is tested at its authored physical position as a foreground occluder
of Jupiter's far endpoint. That orbit lies outside the fixed near-volume region,
so it cannot prove foreground moon occlusion of an active main-scene volume.
Actual terrain peaks and water provide main-scene depth checks; the numerical
foreground-volume probe covers the general occlusion contract.

### Recorded main-scene measurements (2026-10-19, before terrestrial light calibration)

At 1280x800, DPR 1, medium quality, JD 2451545 and the saved AMD Radeon Graphics
ANGLE/D3D11 environment, each state used 120 warmup frames and 300 intervals.
RAF p50/p95 in milliseconds were:

- Earth: 150 km far 33.4/50.2; 110 km fractional 116.9/133.5; 70 km near 83.5/100.1.
- Jupiter: 1100 km far 16.8/33.4; 500 km fractional 67.0/83.4; 100 km near 50.1/66.7.

These different camera/geometry states are not paired baseline comparisons.

The exact loaded shoreline comparison retained 135 terrain and 66 water meshes
with ready original resources: RAF 100.0/100.5 ms against baseline 33.5/50.2 ms.
Current whole Engine GPU queries were nondisjoint: 300 samples, p50/p95
93.78/95.41 ms. The baseline has no GPU queries. Memory was 239 geometries,
121 textures and 57 programs against 236/99/43. Three readiness-matched Solar
exits returned exactly to 1 geometry, 2 textures and 0 programs, with cloud,
depth and prepared owners released.

First cold Earth entry completed in 138.52 s, including resource arrival and first
activation. Preparation retained one source generation across unrelated texture
arrivals. The first backend Engine frame took 7.45 s, and pending samples included
a 4.91 s RAF interval and 4.51 s Engine frame. These are inclusive frame observations,
not isolated shader compilation or preparation-kernel costs. The long-frame cause
was not isolated; native and cooperative preparation slices were not measured
independently. No frame-rate acceptance threshold is implied.

A historical fixed-camera dense-cloud comparison showed cooler, darker near clouds than the
original far map. A bounded local aerial bypass found that the blue ordering was
already present in the integrated volume before main aerial composition, at an
oblique sun cosine around 0.677. Main aerial was not its originating stage. This
does not establish a defect in the physical scattering equations.
The diagnostic's strict far-control equality check failed on variations up to
0.5 input half-float ULP; its raw evidence and this limitation are retained.

Main terrestrial clouds now use the current far owner's scene light convention at
the source-light stage, before density scattering and integration. The shared far
equation supplies direct light and ambient light, including current Lambert/day
gates, star color, optional sun/sky tint and the owner's exact atmosphere geometry.
Direct light retains the configured multiple-scattering attenuation relative to
its unshadowed phase reference. Ambient retains the sky height gradient and is
the sole indirect term in this branch. Eclipse visibility multiplies both light
contributions. Alpha, authored albedo, density, extinction, shadow output, main
aerial perspective and final exposure remain unchanged. Existing LUT samplers are
borrowed; no additional sampler or independent scene-light setting is introduced.
Jupiter and standalone lab lighting retain their physical response.

The corrected same-camera production pair has a neutral near field with retained
volume texture. The reviewer accepted that daytime correction: the encoded
interior means changed from approximately (153,157,167) to (176,175,176), while the
flat far reference remains approximately (190,184,179). These image values describe
appearance, not radiance. The restored linear cloud overlay matches exactly, and
the actual production owner snapshot and live setting propagation are recorded.
Volume opacity and self-shadow still produce differences from the flat map.

After calibration, the same saved 70 km pose used another isolated 120/300 run:
RAF p50/p95 83.5/100.2 ms; whole Engine GPU queries 87.884/90.755 ms, 300 samples,
none disjoint. Memory was 167 geometries, 121 textures and 58 programs. These
different object counts and run chronology preclude a matched baseline claim.
The same owned helper/browser binary/host was used; fresh GPU renderer identity
was not independently queried. The raw capture's inherited no-performance limit
is stale; its derived summary explicitly records this measured phase. The
110 km transition had requested/effective weight 0.5000000001503853. Day,
terminator and night frames retained the calibrated branch and exact producer
budgets, with no unexpected WebGL errors.

### Temporal opacity and material overhead (RTX 5070 Ti, 2026-10-19)

The pinned temporal resolve clipped all four history channels using an RGB-derived
factor. A light-only change could therefore alter resolved opacity even when the
current march's opacity was identical. The scene adapter now preserves the RGB
clipping formula and clamps history alpha independently to its neighbourhood's
alpha bounds. The GPU regression exercises the actual clipping kernel and checks
both current and resolved alpha at noon, the terminator and night. This does not
change density, extinction, ray steps or the authored cloud profile.

Unchanged receiver program signatures now reuse their serialized GLSL. Shader
strings, live defines, hooks, custom keys and uniform names still invalidate the
cache; uniform values do not. The cache uses weak material ownership. Depth
collection skips invisible subtrees, and shared water depth materials synchronize
once per distinct owner per frame instead of once per patch.

A local production Solar comparison used HeadlessChrome 155, ANGLE D3D11 on an
NVIDIA GeForce RTX 5070 Ti, 1280x800, DPR 1, medium quality and paused JD 2451545.
Each view waited for resource readiness and 120 settled frames, followed by 30
warmup frames per measured stage. Each stage collected 180 RAF intervals and 181
nondisjoint `EXT_disjoint_timer_query_webgl2` samples around normal Engine rendering.
Screenshots were outside the measured windows. GPU elapsed times include command
submission gaps and are not isolated shader instruction timings.

The Earth surface normal was `(0.0877653995, 0.8327639800, 0.5466272847)` in world
space; views looked along local north, pitched down by 8, 0 and 14 degrees at
12, 6 and 110 km altitude respectively. Whole-frame timings in milliseconds:

| View | GPU p50 before / after | GPU p95 before / after | CPU p50 before / after |
| --- | --- | --- | --- |
| Above, 12 km | 11.72 / 7.73 | 14.79 / 8.34 | 11.8 / 7.6 |
| Inside, 6 km | 9.72 / 7.27 | 10.97 / 8.01 | 10.6 / 7.6 |
| Transition, 110 km | 11.06 / 8.63 | 11.95 / 10.79 | 10.9 / 8.4 |

Camera poses, quality, source generation and visible terrain/water counts matched:
114/60, 117/60 and 102/57. The transition weight was 0.5. Resident geometry counts
differed by 17 between runs, while texture counts matched (121, 121, 120); this is
a local comparison, not a cross-device or memory-reduction claim. The above-layer
depth stage changed from GPU p50 2.83 to 0.65 ms and CPU p50 1.3 to 0.9 ms. Stage
measurements came from separate intervals and should not be summed.

Local raw captures are in ignored `tmpscreenshots/cloud-tuning/baseline/` and
`tmpscreenshots/cloud-tuning/material-cache/` (`measurements.json`, `scene.json`,
environment and view PNGs). The local reproduction helper is
`.superpowers/cloud-tuning/inspect-scene.mjs`; these artifacts are not part of git.
This comparison does not replace the baseline-dependent full flight probe.
Cold entry stalls and further artistic cloud-shape tuning remain open. The next
iteration below addresses part of the temporal noise.

Iteration verification: typecheck and production build passed; 550 unit-test files
passed (5343 tests, 4 configured skips). GPU probes passed: depth 178 checks,
lighting 639, pipeline 1391 and lifecycle 147, with deliberate shader failures
classified by their injection windows. Lint passed with `.superpowers/**` excluded;
the unrestricted command reports 10 errors in pre-existing local scratch probes.

### Vertical shape and sparse temporal stability (2026-10-19)

Earth's vertical weather envelope now uses bias 0.65 instead of 0.35. Its maximum
moves from about 14% to 34% of the existing 4–8 km shell, giving the cloud masses
more height. The authored coverage map, 12 km shape scale, 1.2 km erosion scale,
extinction and raymarch budgets are retained. The optional
`layers[].detail.verticalProfileBias` accepts a finite number in `(0, 1]`; omission
keeps the legacy 0.35 profile. Both the cloud and shadow passes use the same layer
value. Existing authored profiles and Jupiter retain their shape unless configured.

The pinned 4×4 sparse resolve used to replace each fresh pixel with an unfiltered
raymarch sample. Fresh pixels now mix 50% current with clipped history at rest.
Current weight rises to 100% between 0.5 and 2 resolve pixels of motion per frame.
Opacity changes of 0.05–0.15 also raise current weight independently of RGB; fresh
empty rays immediately clear stale clouds even in mixed neighborhoods. Out-of-view
history still rejects, and all first-cycle samples bypass accumulation. Upstream
starts at frame 1, so this bootstrap includes frame 16. Held pixels keep the
existing variance-clipped reprojection. Independent opacity clipping is preserved.

A controlled main-scene comparison used the same environment and Earth normal
as the timing experiment above. After 256 stationary frames, 64 frames were read
back from the linear resolved cloud overlay at 256×160. The stationary camera was
at 12 km, pitched down 8 degrees. The moving camera was at 7 km, pitched up
2 degrees, rotating 1.5 degrees across the sequence. Comparing the new shape with
and without the temporal change isolates accumulation from the shape change:

| View, new shape | Mean absolute red-channel frame change, before / after | Mean absolute alpha frame change, before / after |
| --- | --- | --- |
| Stationary | 0.00010355 / 0.00005940 (−43%) | 0.00013430 / 0.00008782 (−35%) |
| Slow rotation | 0.00051226 / 0.00037314 (−27%) | 0.00090557 / 0.00066764 (−26%) |

With the original shape, stationary reductions were 41% and 36% respectively.
These are full-view frame-difference measurements, not a perceptual noise score;
moving frames include true scene change and the reduced readback omits fine
spatial noise. For the new shape, mean opacity changed from 0.367390 to 0.367309
at rest and 0.541993 to 0.540833 during rotation. The taller profile intentionally
increases coverage relative to the old shape, so cross-profile frame differences
are not used as a noise improvement claim. A separate IGN texture trial did not
improve these measurements; the owned deterministic noise texture is retained.

Local final comparison frames and raw values are in
`tmpscreenshots/cloud-tuning/motion-final/` (`motion.json`, `scene.json`, variant
PNGs). Images show taller, denser cloud masses, but the near view remains soft;
this is an incremental profile adjustment, not completed cumulus art direction.
The inherited 16-frame sparse reconstruction can still soften moving edges.

The GPU regression renders the installed resolve itself with controlled current,
history and velocity textures. It covers small-noise accumulation, held pixels,
fast motion, out-of-view history, a newly clear ray surrounded by clouds, a large
partial-opacity change, the sixteenth bootstrap sample and constant/empty fields.
The mixed-edge regression first reproduced stale alpha 0.45 instead of 0;
the bootstrap regression reproduced color 0.6 instead of 0.8. Both pass after the
review fixes. The lighting probe passes 687 checks across 33 cases, retaining
day/terminator/night opacity invariance and releasing owned GPU resources.
The complete unit suite passes 5353 tests in 550 files, with 4 configured skips;
typecheck, production build and lint excluding local `.superpowers/**` pass.
The pipeline probe passes 819 checks across 17 cases, and lifecycle passes 147
across 14, including quality changes, resize/capture and WebGL context restoration.

Final isolated timings after the review fixes used the same 120-frame settling,
30-frame stage warmup and 181 nondisjoint GPU samples as the prior iteration.
The helper now also waits for terrain and water to be present: an earlier final
run had zero terrain patches above the clouds and was rejected as incomparable.
All three retained views match the previous iteration's terrain/water counts
(114/60, 117/60, 102/57) and textures (121, 121, 120). Resident geometry counts
are 8 lower (221, 224, 233 versus 229, 232, 241), and runtime generation counters
differ between boots; this remains a local comparison. Results in milliseconds:

| View | GPU p50 previous / current | GPU p95 previous / current | CPU p50 previous / current |
| --- | --- | --- | --- |
| Above, 12 km | 7.73 / 7.48 | 8.34 / 8.36 | 7.6 / 7.3 |
| Inside, 6 km | 7.27 / 6.88 | 8.01 / 7.43 | 7.6 / 7.2 |
| Transition, 110 km | 8.63 / 8.05 | 10.79 / 9.07 | 8.4 / 7.9 |

This supports retaining the frame budget for these views, not attributing all
timing differences to the resolve: the shape changes ray occupancy and runs vary.
Final raw timings and production frames are in
`tmpscreenshots/cloud-tuning/shape-temporal-ready/`. The rejected run remains in
`shape-temporal-final/` for traceability. The full baseline-dependent flight probe
was not repeated for this iteration.

Automated screenshots and numerical checks are technical evidence. User visual
acceptance: on 2026-10-19 the user inspected the result live, reported a significant
improvement and approved committing these iterations. Wind, multiple cloud layers, volume profiles
for Saturn, Venus, Uranus or Neptune, and a dedicated cloud editor remain deferred.

### Local sun self-shadow and stable sampling (2026-10-19)

The scene-reference sun march now resolves a fixed 1.2 km neighbourhood, matching
Earth's erosion scale, with the existing low/medium/high budgets of 1/2/4 samples.
Geometric intervals concentrate samples near the current point; midpoint sampling
avoids adding temporal variance from a second jittered ray. The existing distance
LOD still reduces the sample count. The march clips to the cloud-top sphere using
`maxHeight`, including layers that do not cast a shadow map.

The local integral hands its full interval length to the Beer shadow map (BSM),
which supplies the remaining path. Previously it returned the last jittered
sample position, causing overlapping coverage. A homogeneous 120 m GPU regression
initially produced optical depth 0.22 instead of 0.12. Zero local samples now
return zero distance and optical depth, leaving the BSM tail intact; the old 0.5
optical-depth fallback is removed. The sample count also stays within budget at
zero jitter. This fixes the interval contract; BSM remains an approximation of
the actual heterogeneous cloud field.

This patch applies to terrestrial scene-reference lighting. Density, authored
coverage, erosion, primary ray budgets, temporal resolve and shadow-map output
are retained. The physical lab and giant lighting paths retain their existing
march. No texture, uniform or render target is added. Source patches validate
their anchors before publication and restore on disposal.

Using the previous 256-frame warmup and 64-frame temporal protocol, stationary
mean absolute red-channel frame change was 0.00005941 before and 0.00005944 after.
During the same 1.5-degree rotation it was 0.00037314 / 0.00035449; moving frames
include true scene change. Mean opacity differed by less than 0.000001 at rest
and matched during rotation. In opaque pixels (alpha > 0.8), the p10–p90 span of
red radiance divided by opacity increased from 0.02565 to 0.03882 above the layer,
and from 0.04873 to 0.07234 at its edge. These are spatial shading measurements,
not perceptual quality scores. Near views remain soft; finer cloud-shape work is
still open. The user inspected this lighting iteration live and approved committing it.

The final paired timing run reused the same browser, GPU, viewport, epoch and
three camera poses documented above. Each variant settled for 120 frames with
terrain/water present, then collected 181 nondisjoint GPU samples after 30 warmup
frames. Old/new order was reversed inside the layer. Resource counts matched
within each pair: terrain/water 114/60, 117/60, 102/57; resident geometries
229/232/241 and textures 121/121/120. Results in milliseconds:

| View | GPU p50 before / after | GPU p95 before / after | CPU p50 before / after |
| --- | --- | --- | --- |
| Above, 12 km | 7.72 / 7.64 | 8.92 / 8.43 | 7.4 / 7.5 |
| Inside, 6 km | 7.22 / 7.23 | 7.93 / 7.97 | 7.4 / 7.5 |
| Transition, 110 km | 8.08 / 8.24 | 8.99 / 9.45 | 7.9 / 8.1 |

The above-layer cloud pass itself measured GPU p50 3.88 / 3.85 ms. This supports
retaining the local frame budget, not a claimed speedup. Raw paired timings and
production screenshots are in `tmpscreenshots/cloud-tuning/sun-shadow-perf/`.
Temporal baselines are the `legacy` entries of `sun-shadow-temporal-final/`;
the final sampling variant is `mid1200` in `sun-shadow-midpoints/`.

The lighting GPU probe passes 1094 checks across 34 cases. Its new regression
executes the installed sun-march function against analytic media: uniform paths,
empty rays, a sub-kilometre blocker, quality/mip/jitter bounds and a linear density
ramp. It also uses the real Earth-radius intersection at 120 m and 0.5 m below
the cloud top with a zero shadow-top fixture. Full production march checks retain
day/terminator/night alpha, depth and shadow invariance, eclipse behaviour and
owned-resource release. The analytic tail fixture verifies interval bookkeeping,
not BSM reconstruction accuracy in heterogeneous clouds.

The focused cloud suite passes 380 tests in 39 files; typecheck, production build
and lint excluding local `.superpowers/**` pass. The composition GPU probe passes
790 checks across 17 cases, and lifecycle passes 147 across 14, including quality
changes, capture resize and WebGL context restoration. Deliberate shader failures
are classified by their injection windows. The full baseline-dependent flight
probe was not repeated for this bounded lighting change.

Pinned integration versions: `@takram/three-clouds` 0.7.6,
`@takram/three-atmosphere` 0.19.1, `@takram/three-geospatial` 0.9.1.

### Cold activation and gradual appearance (2026-10-19)

The main scene now keeps the far endpoint through source preparation, shader
compilation and one hidden complete near frame. Shader readiness is polled from
the render loop with `KHR_parallel_shader_compile`; no timer or promise retains
disposed cloud materials. The pinned Three r182 adapter checks both program and
shader completion before first-use reflection. Failed links retain Three's normal
checked-draw diagnostics and the existing owned-program recovery boundary.
Without the extension, the renderer follows its synchronous compilation path.
See the [KHR extension specification](https://registry.khronos.org/webgl/extensions/KHR_parallel_shader_compile/).

Preparation includes procedural noise, cloud/shadow current and resolve passes,
depth composition, water depth, near surface materials and the final cloud blend.
Near receivers use the actual quality preset's cascade count before compilation.
Publishing shadows no longer changes the far owner's cascade define; medium/high
activation previously caused redundant near and subsequent far/depth compilation.

A WebGL2 fence follows the hidden near frame. Polling uses a zero timeout; while
the GPU is busy the far endpoint remains selected. Once signaled, the compositor
renders the current camera/frame again before exposing its output. Cancellation,
source/body generation changes and disposal delete the pending fence and clear
compilation references. This does not advance the simulation clock or render a
stale prepared camera view.

Successful activation multiplies the existing distance LOD weight by a 0.6-second
smoothstep. Only completed active presentations advance it, once per frame serial;
individual deltas are capped at 50 ms so a loading pause cannot skip the fade.
Zero-delta screenshots do not advance it, and history resets for capture/resize
do not restart it. Turning clouds off/on or replacing their prepared source does.
Cloud density, lighting, temporal resolve and steady quality budgets are retained.

The cold-start comparison used fresh headless Chrome sessions, NVIDIA RTX 5070 Ti
through ANGLE/D3D11, 1280 x 800, DPR 1, medium quality, epoch JD 2451545 and a
70 km sunward Earth view. Instrumentation records CPU submission time and RAF
intervals independently; first-use GPU timer queries can include queued driver
work and are not treated as isolated shader execution costs.

| Measurement | Before | After |
| --- | --- | --- |
| CPU frame that first selects a nonzero volume weight | 5904.2 ms | 13.0 ms |
| First nonzero weight | 1.0 | 0.0197 |
| Subsequent appearance transition | Immediate | 555.4 ms / 58 frames |
| Maximum RAF interval within the visible transition | No fade | 13.6 ms |
| Maximum source-preparation work slice | 4.1 ms | 4.6 ms |

The new first visible frame still follows a 1580 ms interval while the hidden
first GPU workload retires. Other cold terrain/water compilation produced a
2493.7 ms CPU frame, with a maximum 2498.7 ms RAF interval across the whole boot.
Thus the change moves preparation ahead of the visible transition and removes
redundant compilation; it does not eliminate all cold stalls. Source preparation
wall time was 6.78 / 7.15 seconds in these full-scene boots, including scheduling
and competing scene work. These measurements do not establish steady FPS gains
or performance on weaker cards. Discrete GPUs are the target; the previous AMD
integrated GPU is not a required hardware floor. Low/medium preset cost reduction
and measurements on other discrete GPUs remain separate work.

Raw startup frames, program events, screenshot and comparison values are retained
locally in `tmpscreenshots/cloud-tuning/startup-final/`; the earlier cold reference
is in `startup-baseline/`. The pipeline GPU probe passes 880 checks across 18
cases, readiness 75 across 9, lifecycle 147 across 14, and simulation scheduling
70 across 5. They cover smooth activation, shader recovery, quality changes,
capture/resize, context restoration, ownership release and simulation invariance.
Expected invalid-shader draws are retired and their diagnostics delivered before
closing each explicit failure window; ordinary rendering errors remain failures.

The complete unit suite passes 5366 tests in 552 files, with 4 configured skips;
TypeScript, production build and lint excluding local `.superpowers/**` pass.
Deterministic composition tests additionally cover a pending fence, fresh output
after signaling, cancellation/generation replacement, and wait failure restoration.
The full baseline-dependent flight probe was not repeated for this iteration.

Steady rendering was checked separately after the full suite/build finished.
The same three medium-quality views settled for 120 frames with terrain/water
present, followed by 30 warmup frames and 181 nondisjoint GPU samples per stage.
GPU p50/p95 was 8.14/9.40 ms above, 7.43/8.20 ms inside and 8.57/9.57 ms in the
distance transition; cloud-pass p50 above was 3.96 ms. Counts matched the earlier
sun-shadow views: terrain/water 114/60, 117/60, 102/57; geometries 229/232/241 and
textures 121/121/120. Compared with the earlier run, these medians are slightly
higher; separate boots are not sufficient to attribute the difference.

A diagnostic pair then bypassed only the already-completed preparation checks
in the same live scene, retaining all normal draws and cloud quality. The order
was reversed for the inside view. Production/bypass CPU p50 was 8.1/7.9,
8.1/7.9 and 8.7/8.8 ms; GPU p50 was 8.31/8.05, 7.44/7.47 and 8.89/8.91 ms.
Resources matched within each pair (227/230/239 geometries, 121/121/120 textures).
This does not establish zero overhead, but no consistent GPU increase from the
preparation checks appeared across the views. There is no steady speedup claim.
The production frames and raw samples are in `startup-steady-final/` and the
paired control in `startup-steady-paired/`, under `tmpscreenshots/cloud-tuning/`.

The user inspected the cold-activation iteration live and reported an improvement
before authorizing the following steady-cost work.

### Terrestrial low/medium buffer budgets (2026-10-19)

Terrestrial low and medium now use resolution scales 0.5 and 0.7 instead of
0.65 and 0.8. At a 1920 x 1080 render size, their resolved cloud/history buffers
are 960 x 540 and 1344 x 756. This removes 40.8% and 23.4% of the respective
buffer pixel area; these percentages do not describe total VRAM or frame cost.
The existing sparse temporal reconstruction and HDR composition remain in use.
High, giant presets, primary march steps, sun samples, authored coverage, density
and lighting parameters are unchanged. The shared preset also serves the Earth lab.

Initial 1280 x 800 trials compared resolution, larger primary steps and both
together. Larger steps raised above-layer mean opacity by about 4% on low and
6% on medium, so the retained change only reduces buffer resolution. Fine details
become softer, particularly on low; this is a quality/cost tradeoff.

The final paired run used one headless Chrome 155 session, RTX 5070 Ti through
ANGLE/D3D11, 1920 x 1080 at DPR 1, epoch JD 2451545 and fixed Earth views.
Each variant settled for 120 frames with terrain/water present, then collected
181 nondisjoint GPU samples after 30 stage warmup frames. The legacy variant
overrode only resolution after applying the real production preset; order was
reversed inside the layer. Median GPU times in milliseconds:

| Quality / view | Cloud pass before / after | Whole frame before / after |
| --- | --- | --- |
| Low, above 12 km | 1.367 / 0.852 | 8.427 / 7.994 |
| Low, inside 6 km | 0.720 / 0.562 | 7.663 / 7.519 |
| Low, transition 110 km | 0.978 / 0.649 | 8.721 / 8.877 |
| Medium, above 12 km | 6.345 / 5.060 | 11.265 / 9.970 |
| Medium, inside 6 km | 2.816 / 2.448 | 8.179 / 8.060 |
| Medium, transition 110 km | 4.284 / 3.135 | 11.032 / 9.942 |

Cloud-pass savings were 22-38% on low and 13-27% on medium in these views.
Whole-frame results vary, including a small increase in the low transition view;
this is not an equivalent FPS improvement. Terrain/water counts matched within
pairs: 132/60 for low above/inside, 138/60 for medium above/inside, 120/60 for
both transitions. Resource counts also matched except the first pair, where the
measurement helper allocated its readback target and plane after the legacy timing
(253/121 to 254/122 geometries/textures); the helper does not draw during timings.
No unit tests, builds or other owned GPU probes ran alongside these measurements.

After 128 fixed warmup frames, raw cloud-output mean opacity differed by at most
0.00094 on low and 0.000071 on medium across the three views. Pixelwise alpha MAE
was 0.00189-0.00586 on low and 0.00070-0.00435 on medium, measured at 512 x 288.
The 64-frame stationary sequences at 256 x 144 had mean absolute red-channel
frame change 0.00008254 / 0.00008826 on low and 0.00005350 / 0.00005479 on medium.
Corresponding alpha changes were 0.00007008 / 0.00008388 and
0.00007427 / 0.00007497. These small increases are retained tradeoffs, not noise
improvements. The same sequences also cover 1.5- and 6-degree rotations; their
frame differences include real motion and smoothing, so they are not perceptual
quality scores. Static production/legacy screenshots retain similar broad form.
Live visual acceptance of these presets and measurements on weaker discrete
cards remain open; this GPU alone cannot establish a new hardware minimum.

Raw samples, environment, resource counts and paired production screenshots are
in `tmpscreenshots/cloud-tuning/quality-final-1080/`; initial candidate comparisons
are in `quality-candidates/`. The adapter regression checks actual output-buffer
dimensions through medium/low/high/medium changes at 1080p, alongside existing
geography, density and march-budget checks. It failed with the old dimensions
before the preset change and passes with the new sizes.

The lighting GPU probe passes 1094 checks across 34 cases, composition passes
881 across 18, and lifecycle passes 147 across 14. These cover real cloud lighting,
activation/composition, quality changes, 4K capture resize, context restoration and
owned-resource release. The full baseline-dependent flight probe was not repeated.

The full unit suite passes 5366 tests in 552 files, with 4 configured skips.
TypeScript, production build, lint excluding local `.superpowers/**`, and formatting
of the changed preset/adapter test pass. Independent review found no code issues;
live perceptual acceptance and weaker-card measurements remain as described above.

### Close cloud form and reprojection precision (2026-10-20)

Cloud-hit velocity now reconstructs the hit in view space from the normalized
view ray and Euclidean front distance. The existing `viewReprojectionMatrix`
combines current/previous camera translations on the CPU in double precision.
Previously, projecting a float32 body-relative hit at planetary radius introduced
false motion even with a stationary camera. The current Bayer jitter convention
is retained; no new uniforms, texture fetches or passes are needed.

The GPU regression executes the installed velocity block against a CPU-projected
physical world point. It covers zero/Earth/Jupiter radii, stationary cameras,
translation, rotation, three Bayer phases and 10 m / 200 m / 2000 km hit distances,
including rotated ECEF coordinates and altitude correction. Its tolerance is
0.002 pixels at 1920 x 1080. Before the fix, the stationary Earth/10 m case failed
with 27.33 pixels of error. Anchor validation still occurs before shader publication.

Earth's extinction is now 0.003/m instead of 0.0015/m, with erosion strength 0.65
instead of 0.35. This strengthens cloud cores and internal shading while opening
small breaks around their edges. The 12 km shape period, 1.2 km erosion period,
authored weather, shell and quality budgets remain the same. The shared Earth lab
uses the same profile. Low still disables detail erosion, so only its extinction
changes; medium/high use both parameters. Terrain/water cloud shadows also become
denser. The distant surface-map endpoint remains independently authored.

Controlled candidates compared larger main shapes, stronger erosion, increased
extinction and cubic history reconstruction. Larger shapes stayed too soft, while
cubic reconstruction amplified stationary variation. Extinction 0.006/m gave
stronger form but raised above-layer stationary red-channel variation from about
0.000055 to 0.000206 at 1080p, so the retained profile uses the more moderate value.
The correction to velocity alone reduced edge-view stationary red/alpha variation
from 0.000282/0.000542 to 0.000130/0.000239 with the original density. These are
raw-buffer frame differences, not perceptual quality scores; the denser final
profile changes both contrast and opacity and must be evaluated separately.

The final paired medium run used Chrome 155, RTX 5070 Ti / ANGLE D3D11,
1920 x 1080, DPR 1 and fixed epoch JD 2451545. Each pose settled for 120 frames,
then warmed its variant for 128 draws. Timings use another 30 warmup frames and
181 nondisjoint GPU samples per stage; inside-layer order is reversed. The legacy
variant restores both the old profile and old velocity block on the live instance.
No unit tests, builds or other owned GPU probes ran alongside the measurements.

| Medium / view | Cloud pass before / after | Whole frame before / after |
| --- | --- | --- |
| Above 12 km | 4.767 / 4.620 ms | 10.128 / 9.623 ms |
| Inside 6 km | 2.425 / 1.639 ms | 8.011 / 8.305 ms |
| Transition 110 km | 2.838 / 2.735 ms | 9.742 / 9.596 ms |

Cloud-pass medians are lower in all three views; whole-frame results include a
0.294 ms increase inside the layer, so this is not a uniform FPS improvement.
Resources match within each pair: 248 geometries / 122 textures above and inside,
253 / 121 in transition; terrain/water counts are 132/60 and 120/60 respectively.

After fixed warmup, stationary 64-frame sequences read the raw cloud buffer at
640 x 360. Final red/alpha mean absolute frame changes are 0.000100/0.000094 above
and 0.000213/0.000408 at the edge, versus 0.000055/0.000075 and 0.000282/0.000542
before. The final profile therefore retains more above-layer shading variation
for stronger form while reducing edge variation by about 25%. Maximum false
stationary edge velocity drops from 3.60 resolved pixels to 0.000257. Slow/fast
rotations of 1.5/6 degrees over 64 frames are also recorded; their frame differences
include real motion and changed contrast, so they are not ghosting scores.

Final medium images and samples are in
`tmpscreenshots/cloud-tuning/appearance-balanced-1080/`. Candidate comparisons
are in `appearance-shape/`, `appearance-core/` and `appearance-final-1080/` (the
last contains the rejected 0.006/m profile). The user inspected the final iteration
live and approved it for commit and push.

Low was checked separately with the same protocol, including its disabled detail
erosion. Cloud-pass medians before/after are 0.902/0.882 ms above, 0.566/0.304 ms
inside and 0.653/0.660 ms in transition; whole-frame medians are 8.242/8.149,
7.539/7.380 and 8.724/8.950 ms. Counts match within pairs (251 geometries /
122 textures above/inside, 256/121 in transition). Low remains visibly softer,
with slightly higher transition cost in this run. Screenshots and raw timings
are in `tmpscreenshots/cloud-tuning/appearance-balanced-low-1080/`.

The final lighting GPU probe passes 1310 checks across 35 cases, composition
passes 882 across 18, and lifecycle passes 147 across 14. These cover camera
precision, lighting, near/far activation, quality switches, 4K capture and context
restoration. Expected shader-failure diagnostics stay inside their explicit
injection windows. The shared Earth lab lighting probe passes all 12 checks.
The full baseline-dependent flight probe was not repeated for this iteration.
Independent read-only review found no defects in the reprojection or profile
integration. Measurements on other GPUs remain open.

The full unit suite passes 5366 tests in 552 files, with 4 configured skips.
TypeScript, production build, lint excluding local `.superpowers/**`, and formatting
of all changed TypeScript files pass. The adapter regression also preserves the
authored extinction and erosion strength through low/medium/high round trips.

### Standalone flight and aligned source reduction (2026-10-20)

The standard full flight now works without files captured on the previous device.
Its current-epoch reference and bounded near-endpoint restoration are described
in the verification section above. Supplying a saved terrain reference remains
optional, with explicit environment matching. Early runner failures also retain
their original diagnostics when flight evidence has not yet been created.

Source reduction now uses a simpler path when both source/destination ratios
are positive integers, including the normal Earth 8192 x 4096 to 2048 x 1024 case.
Every contributing source pixel then has unit area. The new path retains the
same decoded sample order, channel sums and final byte rounding, without
calculating fractional overlaps for each sample. Nonintegral dimensions keep the
existing area-weighted path. The 256-sample checkpoints, 4 ms scheduling budget,
source-replacement checks and cancellation behavior are retained.

A local CPU comparison used the real RGB byte decoder and deterministic
4096 x 2048 input reduced by four on each axis. After warming both implementations,
five pairs alternated their order. Median reduction time was 253.57 ms before
and 156.66 ms after (38.2% less); output bytes matched in every pair. Before the
change, the same comparison failed its local 20% improvement gate with a ratio
of 0.993. This timing gate is a local experiment, not a portable CI threshold.
Regression tests independently check block sums, sample order, channel padding,
partial steps, identity/asymmetric blocks and the fractional fallback, plus
abort/image replacement in both reduction paths.

Fresh production Solar runs used Chrome 155, RTX 5070 Ti / ANGLE D3D11,
1280 x 800, DPR 1, medium quality, JD 2451545 and the sunward 70 km Earth pose.
Summed preparation CPU slices fell from 1214.8 to 849.6 ms, with maximum slices
4.2 / 4.1 ms. Preparation wall time was 6807.4 / 6748.3 ms: unrelated cold
terrain/water work landed in different preparation phases, so these runs do not
establish an equivalent reduction in total entry latency. The first visible
volume frame still followed a 1660 ms interval in the final run.

An invasive diagnostic with synchronous readback after each first draw separated
approximately 346 ms at shadow current, 92 ms at shadow resolve and 1189 ms at
cloud current. These include first-use driver work; ordinary asynchronous timer
queries attributed that work to different stages depending on submission order.
No new WebGL program links appeared at first draw. Trials changing cascade
scheduling, closest-neighbor selection, noise LOD or unused irradiance code
retained substantial startup pauses and were not shipped. GPU cold-start stalls
remain open; this iteration claims a CPU preparation improvement only. Appearance,
cloud quality budgets and shaders are unchanged. Other hardware was not tested.

Local measurements are in `tmpscreenshots/cloud-audit-2026-10-20/reduction-*.json`
and `tmpscreenshots/cloud-tuning/startup-current-before/`,
`startup-stage-readback/`, `startup-aligned-final/`. Independent read-only review
found no required corrections in the flight changes or aligned reduction.

The final standard `--probe=all` run passed all nine groups: 2904 checks across
146 cases, including 219 checks / 19 cases in the complete standalone flight.
All groups reported resource release. Three readiness-matched Solar exits
returned to 1 geometry, 2 textures and 0 programs, with no cloud, prepared or depth
owner retained. Shader-failure injection diagnostics stayed within their expected
windows; the runner accepted no unexpected runtime/WebGL errors.

The full unit suite passes 5378 tests in 554 files, with 4 configured skips.
TypeScript, production build, lint excluding local `.superpowers/**`, formatting
of the changed code and `git diff --check` pass.

### Cold current-pass output specialization (2026-10-20)

After merging the current water work, the remaining cloud startup pause was
isolated to the first multiple-render-target (MRT) draw. On the tested D3D11
backend, ANGLE initially compiles the first color output, then generates another
pixel executable when the framebuffer output layout differs. This occurs after
parallel shader linking reports completion. See the
[ANGLE output-layout implementation](https://chromium.googlesource.com/angle/angle/+/refs/heads/main/src/libANGLE/renderer/d3d/ProgramExecutableD3D.cpp).
A disposable diagnostic disabled auxiliary MRT writes without changing shader
code; the first-volume interval dropped to 6.4 ms. That diagnostic loses required
data and is not part of the implementation.

`prepareCloudCurrentOutput` instead exports the expensive cloud march to a single
RGBA32UI texture, packing the existing seven half-float channels with
`packHalf2x16`. A small fullscreen pass unpacks them into the original color and
depth/velocity attachments. The cloud march, temporal resolve, public textures,
quality settings and activation fade retain their existing behavior. The wrapper
also covers early returns, including clear rays and diagnostic views.

The new target follows the current march resolution, including resize and capture;
it costs 16 bytes per current-pass pixel. At 1280 x 800 and medium Earth quality,
that is 224 x 140 x 16 = 501,760 bytes, about 0.48 MiB. The unpack shader joins
parallel warmup and receives the backend's retry cache suffix. History reset,
source replacement, failure recovery and disposal release the target and material
and restore the original compile/cache/render hooks.

Cold comparisons used fresh Chrome 155 profiles, RTX 5070 Ti / ANGLE D3D11,
1280 x 800, DPR 1, medium quality, JD 2451545 and the same sunward 70 km Earth
view. The control repeats the previous output path on the same updated scene.
No build, unit suite or other probe ran during these measurements.

| Measurement                                                         | Previous MRT path (two runs) | Packed current output (two runs) |
| ------------------------------------------------------------------- | ---------------------------- | -------------------------------- |
| Maximum RAF interval from first hidden cloud workload to activation | 1576.4 / 1589.5 ms           | 443.0 / 465.0 ms                 |
| CPU time of first visible volume frame                              | 12.9 / 14.1 ms               | 13.7 / 14.4 ms                   |

The median cloud startup interval fell by about 71%. The remaining roughly
0.45-second first shadow current/resolve specialization is still open. Unrelated
cold terrain/water compilation also remains; this is not a claim that all scene
startup stalls are gone. First-use GPU queries can attribute queued specialization
to adjacent passes, so the RAF intervals, not individual query labels, establish
the measured improvement. No other GPU was tested.

GPU regression fixtures compare all original half-float output bits against the
packed path, including HDR, overflow depth, signed motion, early returns and odd
viewport dimensions. They also check release after repeated setup. The existing
lighting probe now includes this case. Unit coverage checks target reuse on resize,
hook restoration, retry cache identity, atomic rejection of changed shader
contracts, duplicate ownership and disposal of only owned resources.

The readiness fault-injection fixture waits for a synchronous readback and drains
deliberate invalid-program errors before closing each diagnostic window. `finish()`
alone allowed delayed ANGLE output-type diagnostics to arrive during recovery.
The runner's error filter remains unchanged; ordinary recovery still checks its
pixels and requires a clean GL error state.

Cold records and screenshots are retained locally under
`tmpscreenshots/cloud-tuning/startup-post-water-baseline/`,
`startup-unpacked-reference/`, `startup-packed-final-b/` and
`startup-packed-final-c/`.

The final adapter was also compared with the original output path in the same
running Solar scene, using the lit Earth cloud edge and fixed simulation time.
Each view/variant settled for 120 ready frames, followed by 30 additional warmup
frames per timer scope and 181 valid, non-disjoint GPU samples. The inside view
measured packed first; the other pairs measured the original path first.

| Quality / view      | Whole-frame GPU p50, original / packed (ms) | Cloud-pass GPU p50, original / packed (ms) |
| ------------------- | ------------------------------------------- | ------------------------------------------ |
| Medium / above      | 9.027 / 8.928                               | 3.536 / 3.399                              |
| Medium / inside     | 6.788 / 6.715                               | 1.342 / 1.352                              |
| Medium / transition | 9.367 / 9.338                               | 2.379 / 2.432                              |
| Low / above         | 5.540 / 5.585                               | 0.604 / 0.580                              |
| High / above        | 14.315 / 14.663                             | 10.827 / 10.837                            |

Cloud-pass medians changed by -0.137 to +0.053 ms. The largest whole-frame median
increase was 0.348 ms on high; its p95 was 15.195 / 15.158 ms, while isolated
cloud p95 was 10.896 / 10.895 ms. These local pairs do not show a material added
cloud-pass cost and do not establish performance on other GPUs. Each pair kept
the geometry count and added exactly one texture. Visual inspection of the
medium-above screenshots found no visible appearance change. Final records are
in `tmpscreenshots/cloud-tuning/packed-final-perf/paired.json` with adjacent
screenshots. Earlier disposable prototype measurements are kept separately in
`packed-prototype-perf/`; the prototype code was discarded.

The final standard `--probe=all` run passed all nine groups: 2940 checks across
147 cases, including the complete standalone flight (219 checks / 19 cases).
Every group reported resource release. All recorded shader-failure diagnostics
were accepted only inside deliberate fault-injection windows; the runner found
no unexpected runtime/WebGL errors.

The full unit suite passed 5685 tests in 586 files, with 4 configured skips.
TypeScript, lint and the production build passed. The readiness-only fixture
adjustment was then checked again with TypeScript, targeted lint, its standalone
GPU probe and the full GPU run above. Independent review found no required
corrections in either the adapter or the diagnostic barrier.

### Cold shadow cascade output specialization (2026-10-21)

With the packed cloud-current output in place, a first-draw readback diagnostic
isolated the remaining pause to shadow current (369.9 ms) and shadow resolve
(92.1 ms) on medium. `prepareCloudShadowOutput` executes each cascade separately
on low/medium, so both kernels have one framebuffer output. The current kernel exports its
seven half-float channels to a reusable RGBA32UI scratch texture; a small pass
writes the color and velocity back into their original array layers. Resolve
then writes each original history layer directly. Cascade coordinates, map size,
noise frame, raymarch parameters and temporal accumulation remain unchanged.
At this stage High used only the split resolve: its original current material, compile hook,
cache key and render callback were retained. The backend chose this explicitly
by quality; cascade count is not a quality discriminator (medium also has three).
This High fallback is superseded by
[High shadow numerical stability](#high-shadow-numerical-stability-2026-10-24).

The native high-quality production comparison did not consistently reproduce the
original half-float values after splitting the raymarch. A constant-index branch
experiment also increased medium shadow GPU time from about 0.85 to 2.44 ms and
was rejected. Neither experimental high-current variant was enabled. Splitting
High's current pass was deferred at this stage, retaining its first-draw MRT cost. The
observations do not establish a particular driver or floating-point root cause.

The unpack shader joins parallel warmup. Source strings stay intact and the
compile hooks retain prior patches and diagnostic injections. Cache keys separate
the new variants and retain retry epochs. Cleanup restores borrowed render and
compile hooks and releases only the owned scratch target and unpack material.
The scratch target costs 16 bytes per shadow-map pixel regardless of cascade
count: 1 MiB on low/medium (256 x 256). At this stage High did not render into this
scratch target or allocate a full-size packed shadow texture.

Switching a previously used MRT array target to individual layers also requires
detaching its auxiliary attachments. Otherwise a layer can remain attached twice
and WebGL rejects the framebuffer. The numerical GPU fixture deliberately reuses
the original targets to exercise this transition. It compares all seven defined
current channels and all four resolved channels against the original path, for
1–4 cascades, 7 x 5 and 13 x 9 targets, and two deterministic frames, for both full
splitting and resolve-only mode. The original
velocity output is a vec3; its unused fourth component has no parity contract.
The new unpack explicitly fills that padding with zero.

The first paired prototype run exposed the stale-attachment issue and is excluded
from performance evidence. The corrected prototype passed; its code was then
discarded before implementing the adapter from failing contract tests. Final
coverage checks layer order, scratch reuse on resize, compile/cache preservation,
atomic shader-contract rejection, duplicate ownership and resource disposal.
A separate regression verifies that resolve-only mode leaves the current pass
and its shader hooks untouched and accepts a current shader it does not own.

Attachment cleanup is capped by the context's `MAX_COLOR_ATTACHMENTS`, cached
once per context within the binding. Array layer count is independent of that
limit; a context with four color attachments can still receive six/eight shadow
layers through this path. A regression simulates that limit and verifies every
layer is drawn without addressing unavailable attachment slots. This is a contract
test, not a measurement on another GPU. See the
[WebGL 2 framebuffer rules](https://registry.khronos.org/webgl/specs/2.0/#3.7.4).

Final production-scene comparison used native ANGLE/D3D11 on RTX 5070 Ti,
Chrome 155, 1280 x 800 at DPR 1, a fixed Solar epoch and the same cloud edge.
All defined current and resolved channels matched the original half-float data
on low, medium (above and inside the layer) and high (resolve-only). A separate
low/medium run checked frames 0, 1, 63, 64, 121, 242 and 366, including repeated
draws of each path: all 14 comparisons were exact.

Paired steady-state GPU medians, 181 samples per measurement:

| Quality / view  | Shadow before → after | Full frame before → after |
| --------------- | --------------------- | ------------------------- |
| Low / above     | 0.190 → 0.201 ms      | 5.768 → 5.779 ms          |
| Medium / above  | 0.750 → 0.787 ms      | 8.786 → 8.733 ms          |
| Medium / inside | 0.750 → 0.785 ms      | 6.654 → 6.682 ms          |
| High / above    | 1.539 → 1.519 ms      | 14.666 → 14.262 ms        |

Low/medium pay about 0.01–0.04 ms for the extra draws. These paired observations
are not a cross-device performance guarantee or evidence of a general FPS gain;
the intended benefit is first activation. Artifacts are in
`tmpscreenshots/cloud-tuning/shadow-final-quality-perf/` and
`tmpscreenshots/cloud-tuning/shadow-final-low-medium-parity/` (local, ignored).

Fresh-profile medium startup control (same packed cloud-current implementation,
original shadow passes) had a 443.0 ms maximum frame gap during cloud activation.
Two final-adapter runs measured 25.8 and 23.2 ms; first hidden GPU work to first
visible cloud contribution was 467.6 ms in the control and 23.6 / 20.4 ms after.
This interval starts with cloud GPU work and ends at its first visible
contribution. It excludes source preparation and earlier terrain/shader work;
it is not total Solar boot time. These runs do not measure High's remaining
current-pass pause. Raw startup artifacts:
`tmpscreenshots/cloud-tuning/startup-shadow-quality-final-{reference,a,b}/`.

Final verification: TypeScript and 5,691 unit tests passed (four skipped),
production build and lint passed. The complete scene GPU suite passed 3,145
checks across 148 cases, with every probe reporting resource release. Its 17
WebGL warnings were confined to the existing intentional shader-failure windows;
there were no unexpected WebGL errors. The final shadow implementation also
passed independent code review. Testing on other hardware remains deferred.

### Paired shadow unpack (2026-10-24)

The small shadow unpack pass now writes color and velocity together through two
framebuffer attachments. The expensive packed current shader still has a single
output; resolve still writes one history layer at a time. This removes one draw
and one packed-texture read per cascade without changing the raymarch, resolution,
half-float values or scratch memory. Low uses two cascades in the pinned preset.

Before paired unpack, the existing cleanup detaches stale auxiliary attachments
from a previously used MRT target. Each unpack then attaches the selected color
and velocity layers to slots 0/1. Resolve performs the single-attachment cleanup
again. Eight array layers therefore still require only two color attachments for
unpack; the four-attachment context contract remains covered.

The real GPU fixture first failed the new three-draw budget against the previous
four-draw implementation. With paired unpack it passes, including exact comparison
of all defined channels against original MRT, 1–4 cascades, two frames, resize,
reused targets and resource release. The fixture no longer forces a uniform
refresh before the current pass, so changing frame values exercises Three's normal
render-target refresh behavior. Independent code review found no issues.

Production A/B measurement used the previous and new adapters in the same Solar
scene: RTX 5070 Ti, native ANGLE/D3D11, Chrome 155, 1280 x 800, DPR 1, fixed epoch
2451545, above the same lit cloud edge. Each variant has 360 instrumented frames
for submission counts and 181 GPU samples per timing. Current/resolved production
arrays and repeated draws matched exactly on all three qualities; High retained
its original current pass.

| Quality | Shadow draws/frame before → after | Uniform calls/frame before → after | Shadow GPU median before → after | Frame GPU median before → after |
| --- | --- | --- | --- | --- |
| Low | 8 → 6 | 13 → 9 | 0.206 → 0.196 ms | 6.486 → 6.418 ms |
| Medium | 12 → 9 | 19 → 13 | 0.866 → 0.868 ms | 10.355 → 10.319 ms |
| High | 4 → 4 | 6 → 6 | 1.690 → 1.691 ms | 15.132 → 15.133 ms |

This is a reduction in submissions and unpack bandwidth, not a demonstrated
general FPS increase. Medium GPU time is effectively unchanged in this run.
Instrumented mean shadow CPU time was 0.138 → 0.124 ms on Low and 0.172 → 0.151 ms
on Medium, but the unchanged High control also varied (0.066 → 0.056 ms); these
small CPU differences do not establish a portable percentage gain. Artifacts:
`tmpscreenshots/cloud-tuning/shadow-paired-production-clean/` (local, ignored).

Two fresh-profile Medium starts measured a maximum cloud-activation frame gap of
31.9 ms before and 29.9 ms after. First hidden GPU work to visible contribution
was 17.9 → 28.1 ms, so this change does not claim faster activation. The large
heavy-kernel MRT pause did not recur in this check; the tiny unpack now has its own
MRT first-draw specialization. These intervals exclude source preparation and
earlier Solar/terrain loading. Raw captures:
`tmpscreenshots/cloud-tuning/startup-shadow-paired-{before,after}/`.

The High current-splitting investigation was separate at this stage. A synchronous capture
with unchanged inputs reproduced differences even between some repeated original
draws. Retained-kernel low-byte float traces matched for the inspected
matrix/clip/point/sun-position/direction components, with differences appearing at
the sphere intersection and ray origin. This narrows further investigation; it
does not prove full-coordinate equality or establish a particular driver cause.
Overwriting shadow alpha during tracing removes the optical-depth-tail calculation
and hides the discrepancy; the later trace preserved all color channels instead.

A 128-frame original/split comparison used independently accumulated histories.
For the nearest cascade, a sweep of the actual cloud transmittance formula at
fixed receiver depths of 2/4/8/16 km reached a 0.052 absolute difference at 2 km.
This is a shadow-data diagnostic, not a screen-space image metric or a surface
receiver measurement. It does not justify relaxing the equivalence requirement,
so High's split current remained disabled until the numerical fix below. Raw diagnostics are in
`tmpscreenshots/cloud-tuning/high-shadow-2026-10-24-{full-trace,input-trace,direction-trace,independent-history}/`.

The suspected duplicate uniform upload was also rejected: Three's material
refresh already clears `uniformsNeedUpdate`, and instrumenting actual GL calls
found no duplicate uploads before a draw. No performance claim or shader change
is based on that hypothesis.

Verification: `vitest run tests` passed 5,691 tests (four skipped, 587 files),
production build including TypeScript passed, and project lint passed with
`eslint . --ignore-pattern 'storage/local/**'`. Lighting, pipeline and lifecycle
GPU probes passed 2,522 checks across 69 cases, all reporting resource release.
Their seven WebGL warnings were inside intentional shader-failure windows;
there were no unexpected WebGL errors. Other-hardware tests remain deferred.

Unscoped commands also collect unrelated local files: `vitest run` picked up
five failing ring-audit experiments under `.superpowers/full-audit-2026-10-21/`,
and `npm run lint` found 28 `no-explicit-any` errors in ignored DEM tooling under
`storage/local/textures/dem-rebuild-2026-10-21/tooling/`. Those files were preserved;
the scoped project checks above are the passing verification for this change.

### High shadow numerical stability (2026-10-24)

High now uses the packed current pass and paired unpack as well as split resolve.
`sceneCloudShadowNumerics` first adapts its shared cascade kernel to return neutral
shadow color and velocity when either ray interval endpoint is NaN. The live
`isnan` check also requests IEEE-strict compilation on the tested ANGLE/D3D11
path: ANGLE's [HLSL translator](https://github.com/google/angle/blob/main/src/compiler/translator/hlsl/OutputHLSL.cpp)
sets the strict marker, which reaches the
[D3D11 compile flags](https://github.com/google/angle/blob/main/src/libANGLE/renderer/d3d/d3d11/Renderer11.cpp).
The check remains inside the cascade before either output layout is applied.
At this stage Low and Medium did not receive this numerical adaptation; the
follow-up below extends it to every scene quality.

An A/B/A experiment kept the material, targets, textures and all queried GPU
uniform values fixed, changing only the cache key to force a separate GL program.
Identical GLSL produced different High shadow values in program B; returning to
program A restored A's values exactly. This establishes program-associated
numerical behavior, without identifying a specific driver defect or internal
specialization mechanism. With the NaN check, captured translated HLSL included
the strict marker and separately linked MRT/packed kernels agreed. An otherwise
equivalent `isinf` control did not request strict compilation and retained the
original discrepancy. Earlier low-byte traces were not proof that the full input
coordinates matched; the later GPU uniform inspection included every array element.

Final production checks used the integrated backend, without intercepting shader
source. All seven defined current channels and all four resolved channels matched
bit for bit between the guarded original MRT and guarded packed path: frames 0
and 121, eight draws of each path per frame, and two independent 128-frame history
sequences per path. The repeated draws/sequences also matched themselves. Original
velocity alpha remains undefined and is excluded. These checks establish parity
between the two guarded paths; they do not claim identical values to the previous
unguarded High shader. Comparative screenshots showed no obvious visual regression.

The quality preset retains three 512 x 512 cascades, raymarch steps, optical-depth
tail and temporal filtering. High now uses nine shadow draws per frame (three
current, three paired unpack, three resolve), versus four previously, and adds
one reusable 4 MiB RGBA32UI scratch texture. The two-attachment unpack retains the
existing four-attachment compatibility contract.

Paired prototype measurements used RTX 5070 Ti, Chrome 155, native ANGLE/D3D11,
1280 x 800 at DPR 1, fixed Solar epoch and the same lit cloud edge. Each steady
measurement collected 181 GPU samples:

| High variant | Shadow GPU median | Full-frame GPU median |
| --- | --- | --- |
| Previous MRT current / split resolve | 1.692 ms | 15.355 ms |
| Guarded MRT current / split resolve | 1.771 ms | 15.664 ms |
| Guarded packed current / paired unpack / split resolve | 1.878 ms | 15.529 ms |

This pays about 0.19 ms in steady shadow GPU time on the tested device. The benefit
is first activation and repeatable numerical behavior, not a steady FPS increase.
Fresh-profile startup measurements distinguish the prototype from the integrated
code:

| High variant | First shadow GPU work | Gap before first visible cloud frame | First hidden cloud GPU submission to visible contribution |
| --- | --- | --- | --- |
| Previous implementation | 350.8 ms | 336.8 ms | 359.6 ms |
| Guarded packed prototype | 13.4 ms | 8.5 ms | 24.1 ms |
| Integrated backend | 48.9 ms | 41.5 ms | 56.9 ms |

These are individual runs with visible first-draw variability, not guarantees.
The activation interval excludes source preparation and earlier terrain/shader
work; total Solar loading time did not improve. Other-hardware testing remains
deferred.

The permanent `high-shadow-ray-intervals` GPU case consumes the actual High backend
source, isolates ray setup and checks hand-derived radial intervals at planetary
scale in both MRT and packed paths. Its NaN case failed before the adaptation and
now verifies neutral color and defined velocity channels. This small regression
does not substitute for the full production march/history comparison above.
Lighting, pipeline and lifecycle probes passed 2,427 checks across 70 cases, each
reporting resource release, with no unexpected runtime/WebGL errors.
The project unit suite passed 5,691 tests in 587 files (four configured skips).
The production build, including TypeScript, and scoped project lint passed; the
same exclusions for unrelated local experiments/tooling described above apply.

Local ignored evidence: `tmpscreenshots/cloud-tuning/high-shadow-fresh-program/`
for A/B/A, `high-shadow-strict-perf/` for prototype timings and screenshots,
`high-shadow-integrated-parity/` for final current/history readbacks, and
`high-shadow-{cold-baseline,cold-strict-split,integrated-startup}/` for fresh-profile
activation. Runner logs are under `.superpowers/cloud-tuning/high-shadow-*`.

### Explicit density sampling in the scene current pass (2026-10-24)

Stage profiling at 1080p and 1440p identified the main density march as the
remaining steady High bottleneck. Above the layer it cost 20.18/32.00 ms,
versus 0.034/0.058 ms for temporal resolve. Disposable ablations localized most
of the sensitivity to secondary sun density sampling. Caching phase terms did
not improve timings, and skipping clear sun samples slowed them down; neither
change is shipped.

`sceneCloudDensitySampling` changes just the shape and detail reads in the scene
current shader to `textureLod(..., 0.0)`. Both owned procedural volumes (128³
and 32³) have identical linear min/mag filtering and no mipmaps. Explicit LOD
therefore retains their texels and filtering while avoiding implicit derivatives
inside the nested marches. See the texture lookup functions in the
[GLSL ES specification](https://registry.khronos.org/OpenGL/specs/es/3.2/GLSL_ES_Specification_3.20.html).
The adapter validates each unique source anchor and runs before packed output
and warmup on every effect creation. Quality presets, shape data, density,
lighting, ray/sample budgets, render sizes, temporal filtering, draw counts and
GPU texture allocation are unchanged. Shared labs and shadow sampling are
unaffected.

The current pass also returns neutral outputs when a ray interval endpoint is
NaN, before entering density sampling or writing temporal depth/velocity data.
As with the High shadow guard above, the live `isnan` check requests strict
compilation on the tested ANGLE/D3D11 path. Unguarded implicit/explicit programs
had sometimes disagreed, including repeated original draws; inspecting all
active GL uniform values and adding warmup did not explain or remove the
differences. Guarded implicit/explicit prototypes agreed across all three
qualities and independent histories. This supports the bounded guard and
sampling change; it does not identify a driver defect or promise bit identity
with the previous unguarded arithmetic.

Final paired measurements used the integrated backend on RTX 5070 Ti,
Chrome 155, native ANGLE/D3D11, DPR 1 and fixed Solar epoch 2451545. Each cell
below is a GPU median from 181 nondisjoint samples. Above/inside/transition use
altitudes 12/6/110 km and pitches 8/0/14 degrees at the same lit cloud edge.
Each pair had identical camera, visible terrain/water counts, renderer texture
and geometry counts, and source generation. Variant order was reversed inside
the layer. The control reverses both this adapter's LOD reads and NaN guard;
the candidate is the actual production shader.

| Viewport / quality / view | Current GPU, previous → production | Full-frame GPU, previous → production |
| --- | --- | --- |
| 1080p / Medium / above | 5.093 → 3.341 ms | 11.459 → 11.368 ms |
| 1080p / Medium / inside | 1.222 → 1.073 ms | 8.619 → 8.527 ms |
| 1080p / Medium / transition | 3.145 → 1.915 ms | 12.999 → 12.539 ms |
| 1080p / High / above | 22.447 → 10.289 ms | 28.460 → 16.502 ms |
| 1080p / High / inside | 4.920 → 4.658 ms | 11.460 → 11.512 ms |
| 1080p / High / transition | 16.813 → 7.778 ms | 25.588 → 15.707 ms |
| 1080p / Low / above | 0.660 → 0.694 ms | 7.959 → 8.158 ms |
| 1440p / Medium / above | 6.882 → 4.199 ms | 14.211 → 11.561 ms |
| 1440p / Medium / inside | 1.698 → 1.650 ms | 11.400 → 11.593 ms |
| 1440p / Medium / transition | 4.497 → 2.744 ms | 14.920 → 13.156 ms |
| 1440p / High / above | 32.894 → 13.606 ms | 41.158 → 22.544 ms |
| 1440p / High / inside | 4.162 → 4.132 ms | 12.268 → 12.250 ms |
| 1440p / High / transition | 24.561 → 11.089 ms | 36.050 → 23.133 ms |
| 1440p / Low / above | 1.043 → 1.043 ms | 11.161 → 10.677 ms |

High above saves 54%/59% in the current pass and 42%/45% across the full GPU
frame at 1080p/1440p. Current and full-frame measurements use separate intervals;
their medians should not be subtracted to attribute other stages. Dense inside
views and the already cheap Low pass show little or no benefit. Low's 1080p
current median rose by 0.034 ms; no Low acceleration is claimed. A guarded
implicit control for High above measured 22.831/33.777 ms, versus
22.447/32.894 ms unguarded, making the small guard cost visible separately from
the LOD benefit. These local timings do not establish performance on other
hardware, and the hardware-dependent threshold is not a CI test.

The permanent `current-ray-intervals` GPU case executes the actual installed
interval gate with hand-derived finite and NaN fixtures, checking direct and
packed outputs. Its NaN fixture failed before the guard and passed afterward.
It covers the gate, not the full density march. A texture characterization test
checks the actual owned volumes' linear/no-mipmap contract. Final paired
screenshots above and inside the layer showed no obvious appearance regression;
no appearance preset was changed for this optimization.

Integrated numerical comparisons retained the NaN guard in both the implicit
control and explicit production path. At 1080p, all seven defined current
channels matched bit for bit for Low/Medium/High above, inside and in transition,
at frames 0/1/63/64/121; original repeats also matched. Independent 128-frame
histories above the layer matched on every quality. The harness updated camera
jitter each frame, used equal initial history and separate accumulation targets,
and found no nonfinite values. Undefined velocity alpha is excluded. This is
parity between guarded paths, not a bitwise comparison to the former shader.

Motion checks used the full engine pipeline, independent fresh effects warmed
for 128 actual cloud frames, and 64-frame sequences above/inside at total camera
rotations of 0, 1.5 and 6 degrees. Resolved RGBA was sampled at 320 x 180;
these are sampled overlay comparisons, not full-resolution motion readbacks.
High matched exactly in all six cases. Medium alpha also matched exactly;
its largest RGB difference was 0.0007324, with maximum per-channel mean absolute
error 0.00002877. Repeated same-shader Medium controls also differed: implicit
above reached 0.0004883 and production inside reached 0.0006104. Thus the full
Medium pipeline was not bit-repeatable in this diagnostic even without changing
sampling. This records the variability before the shadow follow-up below rather
than claiming exact Medium motion parity or assigning it to a specific driver
mechanism.

Lighting, pipeline and lifecycle GPU probes passed 2,541 checks across 71 cases,
all reporting resource release. Seven WebGL warnings occurred only in expected
shader-failure windows; there were no unexpected runtime/WebGL errors.
`vitest run tests` passed 5,692 tests in 587 files (four configured skips).
The production build including TypeScript and project lint with
`eslint . --ignore-pattern 'storage/local/**'` passed. The previously documented
exclusions for unrelated local experiments and DEM tooling still apply.
Independent code and evidence reviews found no actionable defects.
Local ignored evidence is under `tmpscreenshots/cloud-tuning/`: initial
`main-profile-{1080,1440}`, final paired timings and screenshots in
`main-sampling-final-{1080,1440}`, integrated current/history readbacks in
`main-sampling-integrated-parity-1080`, and motion results in
`main-sampling-final-motion` and `main-sampling-medium-motion-repeat`.
Runner logs and the before/after performance acceptance are under
`.superpowers/cloud-tuning/main-sampling-*`. Other-hardware testing remains
deferred.

### Low and Medium shadow stability follow-up (2026-10-24)

Per-frame captures localized the remaining Medium variation to current shadow
draws. Some frames differed across independently recreated effects; resolved
shadow history retained those differences and propagated them into cloud RGB.
Cloud opacity and depth/velocity remained equal. Sparse captures initially saw
only the retained history difference, so the investigation was expanded to all
64 frames before identifying the current pass as the earlier source.

Applying the existing High interval guard to Medium was the only prototype
change. Repeated shadow current/resolve, cloud current and sampled overlay
outputs then matched in both tested views. `SceneCloudBackend` now installs
`adaptSceneCloudShadowNumerics` for every scene quality before packing and
warmup, including effect recreation. Invalid intervals return neutral outputs;
the same live NaN check also selects the strict compiler path described above.
This does not claim bit identity with the former unguarded kernel or identify a
specific driver defect. Quality presets and appearance settings are unchanged.

The permanent ray-interval GPU regression now consumes actual Low, Medium and
High backend sources. Before the change, Low's NaN fixture emitted
`[0, NaN, NaN, 1]` instead of neutral shadow data; after the change all three
qualities passed finite/NaN cases in both direct and packed output paths.

Integrated repeated-sequence checks now cover Low and Medium, above the layer
with a 1.5-degree rotation and inside with a stationary camera. Each view used
four independently recreated effects, 128 actual warm frames and 64 captured
frames. All defined full-resolution shadow current/resolve and cloud current
channels matched bit for bit; the 320 x 180 sampled resolved cloud overlay also
matched, with no nonfinite values. The production sources were used directly,
without injecting a diagnostic guard. This establishes repeatability for these
sequences, not a guarantee for every camera path or driver.

The six earlier Medium motion scenarios were then repeated above/inside at
0/1.5/6-degree rotations. With guarded shadow inputs, the implicit density
control and explicit production current pass matched exactly in all sampled
RGBA frames. This closes the observed Medium discrepancy from the previous
sampling investigation without changing its density or lighting budgets.

Paired cost measurements used RTX 5070 Ti, Chrome 155, native ANGLE/D3D11,
1920 x 1080 at DPR 1, fixed Solar epoch and the same above-layer camera.
Each stage collected 181 nondisjoint GPU samples. The variant order included a
repeated control; camera, visible terrain/water, geometry/texture counts and
source generation matched within each quality.

| Variant, in measurement order | Shadow GPU median | Full-frame GPU median |
| --- | --- | --- |
| Medium, previous unguarded | 0.795 ms | 11.016 ms |
| Medium, guarded production | 0.768 ms | 11.257 ms |
| Medium, unguarded repeat | 0.795 ms | 11.091 ms |
| Low, guarded production | 0.180 ms | 7.982 ms |
| Low, previous unguarded | 0.175 ms | 7.814 ms |
| Low, guarded repeat | 0.180 ms | 7.823 ms |

The guard adds about 0.005 ms to Low's shadow pass in this run. Medium shadow
cost did not increase, while its full-frame median was 0.17–0.24 ms higher in
the guarded sample. Stage/frame medians use separate intervals and do not
isolate a total frame cost by subtraction. This change provides repeatability;
no whole-frame acceleration is claimed. Comparative Low/Medium screenshots
showed no obvious appearance regression.

Lighting, pipeline and lifecycle passed 2,508 GPU checks across 73 cases, with
resource release and no unexpected runtime/WebGL errors. Seven warnings were
inside intentional failure windows. Local ignored reports under
`tmpscreenshots/cloud-tuning/` are `medium-numerics-all-frames` for localization,
`medium-numerics-guarded` for the single-change prototype,
`medium-numerics-integrated` for final stage comparisons,
`medium-numerics-final-motion` for the six Medium scenarios and
`medium-numerics-final-perf` for timing/screenshot pairs. Logs are under
`.superpowers/cloud-tuning/medium-numerics-*`.

Final project verification passed: 5,692 unit tests in 587 files (four configured
skips), production build including TypeScript, and project lint with the same
documented local-tooling exclusion. Independent review found no actionable
code or evidence issues. The task-owned probe server was stopped after testing.

### Optimization follow-up after explicit density sampling (2026-10-24)

The next disposable probe applied the same explicit base-level shape/detail
reads to shadow current, keeping the numerical guard and all quality budgets.
On RTX 5070 Ti, Chrome 155, native ANGLE/D3D11 at 1920 x 1080, DPR 1, above the
same lit cloud edge (12 km, 8-degree pitch), each interval collected 181
nondisjoint GPU samples after settling. Measurement order was original,
explicit LOD, original repeat for each quality:

| Quality | Original shadow median | Explicit LOD | Original repeat |
| --- | --- | --- | --- |
| High | 1.731 ms | 1.730 ms | 1.757 ms |
| Medium | 0.697 ms | 0.697 ms | 0.697 ms |
| Low | 0.170 ms | 0.170 ms | 0.170 ms |

There was no meaningful speedup, including in the separately measured full
frame. The shadow change was rejected before integration or expanded parity
testing. The earlier main-pass improvement does not generalize to shadow
sampling on this device.

The same scene then refreshed High's main-pass sensitivity after commit
`647710d8`. Each interval collected 121 nondisjoint GPU samples. These runs
included image-changing diagnostic controls, which are not implementation
candidates:

| Variant, in measurement order | Current GPU median | Full-frame GPU median |
| --- | --- | --- |
| Production | 9.486 ms | 15.453 ms |
| Disable local sun optical depth (diagnostic only) | 5.138 ms | 11.051 ms |
| Replace multiple scattering with one exponential (diagnostic only) | 8.978 ms | 14.745 ms |
| Disable shadow-map optical-depth tail (diagnostic only) | 8.600 ms | 14.478 ms |
| Cache phase terms outside the march | 9.306 ms | 14.923 ms |
| Skip zero-weather secondary sun samples | 9.500 ms | 15.695 ms |
| Production repeat | 9.269 ms | 15.795 ms |

Caching phase terms did not beat the repeated production current pass, and
skipping clear sun samples did not improve it either. Neither rewrite is
integrated. The local sun march remains the largest measured sensitivity;
these compiler-altering controls are not additive cost estimates and do not
justify removing lighting or reducing its sample budget. Stage and full-frame
medians come from separate intervals, so they should not be subtracted from
one another.

One further candidate skipped the exponential part of the density profile when
its coefficients are zero. Captured scene uniforms had zero `expTerms` and
`exponents`, with linear/constant terms 0.75/0.25 in all four channels. An initial
High run measured 10.096/10.110 ms for production before/after, 9.562 ms for an
unconditional linear-only prototype, and 9.779 ms for a uniform branch checking
zero exponential coefficients. Unconditional specialization needs an explicit
configuration contract before it can be considered for integration.

The generic follow-up retained the original formula as fallback and required
both coefficients and exponents to be zero. A/B/A intervals collected 181
nondisjoint samples each:

| Quality / view | Original current median | Conditional linear path | Original repeat |
| --- | --- | --- | --- |
| High / above | 9.228 ms | 9.100 ms | 9.325 ms |
| High / inside | 2.921 ms | 4.422 ms | 4.338 ms |
| Medium / above | 3.297 ms | 3.275 ms | 3.287 ms |
| Low / above | 0.692 ms | 0.691 ms | 0.692 ms |

The conditional path matched every defined current output channel bit-for-bit
at frames 0/1/63/64/121 for Low/Medium/High above, inside and at the transition,
and the final resolved outputs after 128 frames above the layer for all three
qualities. Intermediate resolved frames were not compared. Same-shader repeat
controls also matched, with no nonfinite values. Its benefit was small and
concentrated in High above the layer; the High inside timing was not repeatable,
despite equal resource counts. This branch is also left out of production.
This motivated the specialization investigated below, with its configuration
contract and fresh parity/performance checks established before integration.
No additional shader change was shipped by this exploratory follow-up.

Local ignored evidence: `tmpscreenshots/cloud-tuning/shadow-density-prototype/`,
`main-cost-after-density/`, `main-linear-profile/` and `main-profile-followup/`,
with runner logs under `.superpowers/cloud-tuning/`. Other-hardware validation
remains deferred.

### Compile-time specialization of linear density profiles (2026-10-24)

The scene appearance binding already supports exactly one authored layer. A
disposable rewrite of weather/media density into scalar arithmetic did not beat
the smaller linear-profile specialization, so the broader rewrite was rejected.
The integrated `sceneCloudDensityProfile` checks all four packed layer profiles
once during effect creation. Only when every `expTerm` and `exponent` is zero
does it omit the exponential summand from `getLayerDensity`. Linear and constant
coefficients remain uniforms; any nonlinear profile keeps the full upstream
formula. The owned profiles are fixed for the effect's lifetime, and effect
recreation repeats this choice before packed output preparation and warmup.
There is no per-sample branch or hardcoded density ramp in the shader.

The change affects scene current shaders, including the physical giant path.
Shadow and lab shaders, authored profiles, sample budgets, quality scales,
texture allocations, draw counts and history filtering are unchanged.

The permanent `linear-density-profile` GPU case executes the installed function
against literal expected values and counts its exponential evaluations. It
failed on the original formula's unnecessary evaluation, then passed with the
specialization. Additional cases execute the emitted fallback with a nonzero
term alone, exponent alone and a nonlinear last channel, protecting the check
across all four profiles.

Integrated comparisons used RTX 5070 Ti, Chrome 155, native ANGLE/D3D11 at
1920 x 1080, DPR 1, fixed Solar epoch and the same lit cloud edge. Each High
interval collected exactly 512 nondisjoint GPU samples; Medium/Low collected
256. All 64 noise phases occurred equally often. The table reports mean
current-pass time, with the original measured before and after production:

| Quality / view | Original before / after | Specialized production |
| --- | --- | --- |
| High / above | 9.460 / 9.422 ms | 8.895 ms |
| High / inside | 3.820 / 3.539 ms | 3.498 ms |
| Medium / above | 3.336 / 3.330 ms | 3.233 ms |
| Low / above | 0.695 / 0.694 ms | 0.678 ms |

Above the layer, this saves about 6% of High current time, 3% of Medium and 2%
of Low on the tested device. The separately measured High full-frame mean
fell from 15.540/15.561 ms to 15.115 ms (about 3%). Medium full-frame controls
varied noticeably, so its stage saving is not a claim of equal whole-frame
acceleration. Texture/geometry counts, terrain/water population and source
generation matched within each quality. Comparative High screenshots showed
no obvious visual regression.

High inside-layer timing remained variable, including original-to-original
repeats: an earlier balanced run measured original 3.825/3.690 ms and prototype
3.811 ms. Shorter 181-sample medians had misleadingly suggested a large
regression. Equal noise-phase counts and mean timings removed that conclusion;
they do not establish noise phase as the sole cause of variability or justify
a specific inside-layer speedup claim.

The integrated shader matched all seven defined current channels bit-for-bit
at frames 0/1/63/64/121 for Low/Medium/High above, inside and at the transition.
Same-source repeat controls matched too. The final resolved output after 128
frames above the layer matched for each quality; intermediate resolved frames
were not compared in this static check. No nonfinite values were found.

Motion comparisons recreated independent original/production effects, warmed
128 frames, then captured 64 frames of a six-degree camera turn above and inside
the layer at Medium and High. Every RGBA value sampled into the 320 x 180
overlay target matched in all four scenarios, with no nonfinite values.

One fresh-browser High activation per variant at 1280 x 800 measured first
main-cloud GPU work at 1.931/1.662 ms (original/production). The interval from
first hidden cloud GPU submission to visible contribution was 26.5/24.7 ms,
and the gap before the first visible frame was 11.4/9.8 ms. These individual
trials do not establish a startup speedup. The total instrumented interval
was longer in production (original 6.934 seconds, production 10.374 seconds to visible contribution),
with most additional delay before backend creation, including source
preparation at 3.330 versus 6.112 seconds.

Lighting, pipeline and lifecycle passed 2,507 GPU checks across 74 cases, all
reporting resource release. Seven WebGL warnings occurred inside intentional
failure windows; no unexpected runtime/WebGL errors were reported. Independent
code review found no actionable issues.

Final project verification passed: 5,692 unit tests in 587 files (four configured
skips), production build including TypeScript, and project lint using the same
documented local-tooling exclusion. The task-owned probe server was stopped.

Local ignored evidence under `tmpscreenshots/cloud-tuning/`:
`single-layer-prototype/`, `linear-profile-prototype/`, `linear-profile-cycles/`,
`linear-profile-integrated/`, `linear-profile-motion/` and
`linear-profile-cold-{baseline,integrated}/`. Runner and validation logs use
the `linear-profile-*` prefix under `.superpowers/cloud-tuning/`.
Other-hardware validation remains deferred.

## Night-side solar sampling (2026-10-24)

The terrestrial reference light mixes a smooth sunrise ramp with
`max(muS, 0)`. Both direct terms are exactly zero at `muS <= -0.08`;
ambient radiance can still be nonzero. The source now uses the existing
zero-budget exit for its local sun march and skips the complementary BSM
lookup in that region. Primary density, ambient, opacity, resolve and shadow-map
generation retain their existing paths. This optimization does not infer
darkness from eclipse visibility and does not change physical giant/lab lighting.

The ramp start is shared with the lighting formula. Eligibility uses
`muS > min(sceneCloudSunRampStart, 0)`, so both direct-light terms must be
zero before work is omitted. Lit and twilight samples retain the configured
1/2/4 local samples and the original BSM partition. The local integrator itself
is unchanged.

The permanent `scene-reference-sun-shadow-culling` GPU case executes the
installed solar call block and march against an analytic medium. It checks
actual density/BSM sample counts, optical depth and tail offset at both sides
of the twilight boundary, all three budgets, and with/without a BSM layer.
It also executes the shared light split to check exact zero direct light and
preserved ambient. Before implementation, a night fixture produced optical
depth 2 with one local and one BSM sample; it failed the expected zero-work
contract. The integrated lighting probe then passed 1,958 checks in 43 cases.

The earlier attempt to batch independent weather reads in the solar ray was
rejected. On High above the layer, groups of two/four increased mean current
time to 9.497/9.818 ms versus original repeats of 8.905/8.878 ms. No batching
was incorporated into the production shader.

The integrated shader matched all seven defined current channels bit-for-bit
at frames 0/1/63/64/121 for Low/Medium/High, day/twilight/night, and views above,
inside and at the transition (27 combinations). Same-source repeats matched.
The final resolved output after 128 frames above the layer matched in all nine
quality/lighting combinations; this static check does not compare intermediate
resolved frames. No nonfinite values were found.

Motion checks recreated independent original/production effects, warmed 128
frames, and captured 64 frames of a six-degree camera turn into a 320 x 180
floating-point overlay target. All sampled RGBA values matched for Medium/High
above and inside on the day/night sides, plus both qualities above at twilight
(ten sequences). Cloud coverage remained nonzero in every case.

Final timing used RTX 5070 Ti, Chrome 155, native ANGLE/D3D11, 1920 x 1080,
DPR 1 and a fixed Solar epoch. Each interval collected exactly 512 nondisjoint
GPU samples on High, or 256 on Medium/Low, with all 64 noise phases equally
represented. Original controls bracketed each production measurement. These
are mean times in milliseconds; current and full-frame intervals were measured
separately and are not additive:

| Quality / light / view | Original current before / after | Production current | Original frame before / after | Production frame |
| --- | --- | --- | --- | --- |
| Low / day / above | 0.667 / 0.667 | 0.664 | 7.487 / 7.365 | 7.343 |
| Low / night / above | 0.664 / 0.667 | 0.440 | 7.210 / 7.286 | 7.124 |
| Medium / day / above | 3.244 / 3.240 | 3.237 | 10.264 / 10.263 | 10.433 |
| Medium / night / above | 3.120 / 3.123 | 1.919 | 10.265 / 10.049 | 8.828 |
| High / day / above | 8.900 / 8.948 | 9.211 | 15.227 / 15.192 | 15.245 |
| High / day / inside | 4.159 / 4.109 | 4.201 | 10.852 / 10.736 | 10.578 |
| High / night / above | 8.364 / 8.336 | 5.723 | 12.430 / 12.465 | 10.861 |
| High / night / inside | 4.820 / 4.828 | 1.805 | 10.776 / 10.910 | 8.279 |
| High / twilight / above | 8.295 / 8.303 | 6.058 | 12.809 / 12.823 | 10.545 |

Night current time above the layer fell about 34%/39%/32% at Low/Medium/High.
The separately measured High night frame fell about 13% above and 24% inside;
inside current time fell about 63%. The twilight view is centered at
`muS = -0.08349`, close to the cutoff, so its gain includes visible cloud
points with exactly zero direct light. Samples with a nonzero twilight ramp
retain their original shadow work.

There is a daytime tradeoff: High current time above increased about 3.2%,
with full-frame mean within 0.4% of both controls. Low/Medium daytime current
time stayed close to the original, but Medium full-frame mean increased about
1.7% in this run. This is a conditional night-side optimization, not a general
daytime acceleration. Earlier prototype full-frame gains were larger; the
table reports the final integrated measurements. Camera, viewport, cloud source
generation, terrain/water population and GPU texture/geometry counts matched
within every original/production/original group. High daytime screenshots showed
no obvious visual regression; exact cloud comparisons are described above.

The full-frame gain is a mean-time claim: High above at night had p95
13.385 ms in production versus 12.898/12.980 ms in the original controls.
This run does not establish an improvement in every frame-time percentile.

Final lighting, pipeline, receiver and lifecycle probes passed 2,993 GPU checks
across 94 cases, all reporting resource release. Seven WebGL warnings belonged
to intentional failure windows; no unexpected runtime/WebGL errors were reported.
Project verification passed 5,692 tests in 587 files (four configured skips),
production build including TypeScript, and lint with the documented local-tooling
exclusion. Independent code and evidence review found no actionable issues.
The task-owned probe server was stopped. Other-hardware validation remains deferred.

Local ignored evidence: `tmpscreenshots/cloud-tuning/sun-density-batches/`,
`sun-night-prototype/`, `sun-night-budget/`, `sun-night-parity/`,
`sun-culling-integrated/` and `sun-culling-timing/`. Runners and validation logs
are under `.superpowers/cloud-tuning/`, using the same prefixes.

### Frame-tail investigation after master integration (2026-10-24)

After integrating the audit fixes from master, a fresh High/1080p comparison
repeated the same day/night cloud-edge poses on RTX 5070 Ti and Chrome 155,
native ANGLE/D3D11. Each original/production/original group used 512 current-pass
samples and 1,024 whole-frame samples with balanced 64-phase coverage. Camera,
viewport, source generation, terrain/water and GPU resource counts matched
within each group. Other hardware remains untested.

The diagnostic records elapsed CPU-side `Engine.renderFrame` call time,
including command submission and any waits, and intervals between successive
frame-call starts. The latter are browser scheduling measurements, not display
presentation timestamps. CPU stage intervals can overlap and are not additive.

| View / variant | Current GPU mean | Whole-frame GPU p95 | CPU call p95 | Frame-start interval p95 |
| --- | --- | --- | --- | --- |
| Day / original | 8.045 ms | 14.457 ms | 13.7 ms | 14.9 ms |
| Day / production | 8.085 ms | 14.464 ms | 12.2 ms | 14.9 ms |
| Day / original repeat | 7.998 ms | 14.375 ms | 11.8 ms | 14.6 ms |
| Night / original | 7.450 ms | 11.996 ms | 12.7 ms | 13.2 ms |
| Night / production | 5.263 ms | 12.713 ms | 12.6 ms | 12.9 ms |
| Night / original repeat | 7.426 ms | 11.950 ms | 12.5 ms | 12.9 ms |

The earlier approximately 3% daytime current-pass cost did not recur at that
size in this run: production was 0.5–1.1% above the two controls. Night current
time remained about 29% lower. Its whole-frame GPU p95 increased, but the
frame-start p95 matched the repeated original control. In the night production
interval, CPU-call/GPU-interval correlation was 0.888, versus 0.138/0.064 for
the controls. This points to investigating CPU submission and scheduling before
attributing the full-frame tail to slower cloud GPU work; it does not prove
the absence of presentation stalls.

A separate same-shader experiment moved the GPU query from the whole frame to
`Postprocessing.render`, then restored the original boundary. With 1,024 samples
per interval, GPU p95 was 13.080/12.539/13.955 ms, while CPU-call p95 also varied
(13.0/12.5/14.7 ms). Changing the query boundary did not isolate the cause.
Mean elapsed scene-update calls were 3.26–3.47 ms and postprocessing calls
6.32–6.62 ms; nested stages are included in these values. Further CPU profiling
is needed before selecting a specific implementation change.

No additional cloud shader rewrite resulted from this investigation. Local
ignored evidence is in `tmpscreenshots/cloud-tuning/frame-tail-merged/` and
`frame-tail-scope/`; runner logs use those prefixes under
`.superpowers/cloud-tuning/`.
