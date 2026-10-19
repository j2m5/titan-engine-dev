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

Automated screenshots and numerical checks are technical evidence. User visual
acceptance is recorded separately. Wind, multiple cloud layers, volume profiles
for Saturn, Venus, Uranus or Neptune, and a dedicated cloud editor remain deferred.

Pinned integration versions: `@takram/three-clouds` 0.7.6,
`@takram/three-atmosphere` 0.19.1, `@takram/three-geospatial` 0.9.1.
