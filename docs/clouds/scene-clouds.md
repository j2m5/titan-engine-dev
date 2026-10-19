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
that serves the normal application and original assets, and
`SCENE_CLOUD_BASELINE_DIR` pointing at the saved `loaded-evidence.json` and
`terrain-evidence.json`. The runner navigates from the test page to `/`, clicks
the production Solar button, then imports test access. It never constructs a
replacement application scene. Functional frame PNGs and metadata are saved in
ignored `tmpscreenshots/scene-clouds/`; warm performance samples exclude screenshot
capture. No test-only access or debug UI is required in the shipped application.
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
