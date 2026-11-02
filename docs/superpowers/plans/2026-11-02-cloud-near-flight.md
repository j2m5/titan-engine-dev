# Production near-cloud flight in Alkaid and W26

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Check the merged cloud fixes in actual production Alkaid/W26 near-cloud flights, including terminator motion, LOD transitions and teardown.

**Architecture:** Reproduce against the existing, hash-verified production-v4 bundle from the terminator stage, then verify the diagnosed collision correction on a fresh S3 build. An external browser probe imports the built runtime, moves the actual camera and samples actual cloud targets; no alternate renderer or product debug API. Separate functional GPU readbacks from uninterrupted movement timing.

**Tech Stack:** Existing Vite preview, Playwright native Chrome/AMD ANGLE D3D11, WebGL2, source-bound JSON evidence.

**Spec:** User approved the next priority: near flights through clouds and the terminator on merged master. The previous 30-minute belt soak did not specifically exercise these views. Route/sample counts below are implementer choices for a bounded diagnostic, not performance acceptance thresholds.

## Global Constraints

- Base `a6433388101abde838bc4f52a63a81801588380d`; branch `codex/cloud-near-flight-2026-11-02`, established in-place checkout and dependencies retained.
- Native Chrome, 1280x720, DPR1, authored medium cloud quality, MSAA8, real S3 settings; one page/renderer/context across both scenes and revisits.
- Baseline: reuse `benchmark-results/cloud-terminator-2026-11-02/product-v4` only after verifying all 1480 source hashes and 52 build files. The confirmed collision correction below requires a fresh build (1481 sources/52 build files) and full CLI checks; unchanged standalone shader suites are not repeated.
- Test Thalorn actor130 in Alkaid scenario13 and Halcyra actor120 in W26 scenario12. Use their actual cloud profiles, radius and main-light direction.
- Keep simulation speed1 and use the existing positional follow target for each route pose, so orbital motion does not carry the planet away while cloud assets warm. Record actual relative pose and follow identity.
- Functional matrix: outside cutoff, halfway through LOD transition, above layer, inside layer; near cases at sun angle0/90/120 degrees. Include consecutive near frames and a second full activation after backend release.
- Motion: one continuous120-frame traversal from sun angle75 to105 degrees inside each cloud layer, then120 frames descending from above the layer into it. Preserve raw frame times and cloud diagnostics. Timing windows contain no synchronous readback or screenshots.
- Full actual resolved cloud RGBA16F readbacks must be finite; save raw half-float bytes and exact camera/settings with captures. Inspect current cloud color and shadow optical layers where the built target contract supports direct readback. Do not demand finite deliberately unrepresentable depth sentinels.
- No behavior/quality change without a diagnosed defect and failing regression. Preserve failed attempts. No automatic merge/push or PR.

## Review Focus

- A camera labelled terminator might be on the wrong hemisphere or displaced by collision/floating origin: record actual relative altitude and dot product with the current main light, assert tolerances.
- Backend readiness/fade can produce a plausible far-only screenshot: require selected body, active state, requested/effective weight, owned targets and cloud/shadow updates.
- Readback can use stale/wrong ping-pong targets or hide nonfinite values through JSON: capture immediately after actual frames, include target identity/dimensions and raw uint16 bytes, independently recalculate.
- Motion instrumentation can create extra RAF chains or reset history every frame: reuse RAF identity tracking, preserve/restore descriptors, record generation and frame counters, avoid artificial discontinuity calls.
- Repeated activation/scene changes can leak resources despite functional success: compare menu cloud owners, renderer counts, registries, pending requests and context count after both visits to each scene.

### Task 1: Exercise and archive the real production cloud route

**Files:** Create external probe/runner/validator in `benchmark-results/cloud-near-flight-2026-11-02/`; update `docs/project-audit-2026-10-21.md`; create `docs/benchmarks/cloud-near-flight-2026-11-02.json`.

**Interfaces:** Reuse production `getInitializedSimulationRuntime().container`, existing external `__productionFrame.connect/selectScenario/menu`, and RAF/context tracker. New probe exposes connect, describe, move, capture, motion, snapshot. Runner saves phase progress, source/build identities, raw image buffers, screenshots, network/GL diagnostics and teardown.

- [x] Verify clean baseline and exact source/build identity; inspect built exports and target contracts. Expected:1480 sources/52 build files match, no product change at baseline.
- [x] Implement external route and validator; run a short smoke. Expected:actual medium cloud activation, finite targets and working teardown, or a precise preserved failure for diagnosis. The Thalorn smoke exposed the collision defect before the second planet; both planets are covered by the final full run.
- [x] Run the full matrix and two motion windows per scene sequentially, then revisit each scene and recheck activation/teardown. Expected:all cases present, unique RAF stamps, one engine callback, no unexpected GL/network/runtime errors.
- [x] Independently recalculate half-float validity, route coverage, timing distributions and resource checks; use corrupted copies to prove rejection of missing cases, nonfinite pixels, false readiness, wrong pose, duplicate RAF and leaked resources.
- [x] Save audit/evidence with explicit limits, commit locally, run `node benchmark-results/cloud-near-flight-2026-11-02/verify-result.mjs`. Expected:source-bound evidence validates after full CLI checks for the collision correction.
- [ ] One fresh whole-branch review, adjudicate findings, fix material evidence defects once, archive the completed ledger and remove only this plan's scratch directory.

**Task completion command:** `node benchmark-results/cloud-near-flight-2026-11-02/verify-result.mjs` (expected exit0).

## Confirmed collision correction during Task 1

The followed production camera requested18km above Thalorn but CameraCollision pushed it to60km, above the entire10-26km cloud layer. The existing radius*1.001 spherical clearance grows to tens of kilometres on giants. This is a real route obstruction; never disable collision or accept nominal pose labels as inside-cloud evidence.

Bound the existing proportional clearance to1km for spherical planets only. Small bodies keep their smaller proportional clearance; star and terrain/water collision policies stay unchanged. One kilometre is well above the2m camera near plane and giant float32/contact precision, while remaining below all current catalog cloud bases. No cloud art parameters change. Add actual catalog descent tests and penetration/sweep controls before product code; watch the new cases fail, then implement the bounded clearance and update old spherical-planet expectations. Rebuild with the same S3 settings, bind the fresh sources/build, and run the complete route on that build. Run the full unit/typecheck suite, lint and build after this product change. Preserve the original failed production attempts and their source snapshots.

Files: `src/core/services/CameraCollision.ts`, `tests/services/CameraCollision.spec.ts`, new `tests/services/SphericalCloudClearance.spec.ts`.

- [x] RED: actual catalog cloud descents plus giant penetration controls fail on the old gap; small-moon/star controls pass.
- [x] GREEN: bounded spherical planet clearance, existing collision/terrain/water coverage passes.
- [x] Fresh S3 build/source manifest, full CLI gates, actual full production flight and teardown.

## Verification result

RED:12 failed/4 passed. Focused GREEN:94/94. Full CLI:6303 passed/7 skipped,617 passed files/2 skipped; typecheck/lint/build exit0. Production:28 captures,480 motion frames,4 menu teardowns,622 successful S3 responses, one WebGL context. Independent verifier:12976128 full resolved pixels,52107264 half words including sampled current/shadow tiles,7 corrupted reports rejected. Final source/build identity:1481/52. Twenty-three large raw pixel files remain local with size/SHA manifests; the full verifier fails clearly if they are missing. Timings are diagnostic frame intervals, not GPU time or an FPS gain claim.
