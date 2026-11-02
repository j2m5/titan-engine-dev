# Finite empty cloud shadows at the terminator

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Remove the diagnosed empty-shadow NaNs from real terminator lighting on SwiftShader, preserving valid shadow motion and the existing allocation/draw budget.

**Architecture:** Extend the existing production shadow numerics adapter. A march with no contributing samples retains zero extinction/optical depth and bounds only its unused distance sentinel to `[0,65504]`. Its private history depth is `-1` with zero motion, and resolve skips absent neighbors. For an occupied ray, bound pixel motion to the shadow resolution: a component outside that interval already places the previous UV outside the image, so its exact magnitude is irrelevant to history rejection. Keep the optical data and all in-bounds motion unchanged.

**Tech Stack:** TypeScript, Three.js, Takram GLSL ES 3, Vitest, native AMD ANGLE and SwiftShader.

**Spec:** User-authorized audit continuation; open terminator failure in `docs/project-audit-2026-10-21.md`. Diagnostics in `benchmark-results/cloud-terminator-2026-11-02/` establish a finite empty-ray depth of 1,000,000 before storage, NaN afterwards, followed by nonfinite cloud HDR. Ordinary half-float framebuffer conversion also fails on SwiftShader; changing packHalf2x16 alone cannot repair this. A temporary neutral-empty/motion-bound experiment produces finite first and second frames with alpha 1. The prior exact output packing contract remains intact.

## Global Constraints

- Base `6af47da613d328400db56b14013d9ecf636cd938`; branch `codex/cloud-terminator-2026-11-02`, established in-place checkout.
- No renderer detection, new dependencies, public texture-format changes, extra textures or extra render passes.
- Preserve existing live NaN ray-interval guard, occupied optical data, valid motion, exact current/shadow packing comparisons and native timing thresholds.
- Only the unused empty distance is bounded to the finite half range; shorter empty intervals keep their distance. Mixed empty/occupied interpolation must not pull a representable occupied front toward the light.
- This is not a general repair of a backend's half-float converter or a claim that arbitrary occupied depths/HDR fit binary16.
- Retain failed diagnostics and exact source identities. Run timing-sensitive GPU probes sequentially without CPU-heavy checks.
- No PR, merge or push for this stage; commit the verified result on its branch.

## Review Focus

- Empty rays with million-metre and astronomical maximum distances must yield zero optical depth: exercise the actual production march with controlled extinction.
- A very faint contributing ray must remain occupied; use extinction just above minExtinction, without an epsilon-based empty shortcut.
- First-frame/extreme reprojection must remain finite while valid and boundary previous UVs retain their original motion: exercise the production cascade export code with both signs and axes.
- Empty/occupied transitions and filtering must retain finite lighting and shadows: require first/second noon, terminator and night frames, full lighting and pipeline probes on both backends.
- A numerical fix must not regress ownership, packed-output parity or startup latency: retain exact current/shadow GPU checks, existing lifecycle tests and native preparation timing.

### Task 1: Neutral empty shadow rays and bounded history motion

**Files:** Modify `src/core/clouds/takram/sceneCloudShadowNumerics.ts`, `src/core/clouds/takram/SceneCloudBackend.ts`, `tests/clouds/scene/lighting.gpu.ts`, `tests/clouds/scene/probe.ts`. Create `tests/clouds/scene/shadowEmptyRay.gpu.ts`. Update audit; create source-bound `docs/benchmarks/cloud-terminator-2026-11-02.json`.

**Interfaces:** `adaptSceneCloudShadowNumerics(source: string): string` remains unchanged. Add `adaptSceneCloudShadowResolveNumerics(source: string): string`; new `checkSceneCloudShadowEmptyRay(source, resolveSource, draw, check): void` uses the same isolated GPU draw/check signatures as neighboring numerical fixtures. It extracts production march/export sections, supplies controlled inputs, and asserts physical/temporal outcomes without reproducing the implementation.

- [x] Add GPU regressions for zero/subthreshold extinction at distances `100`, `1e6` and `1e30`, occupied/faint rays, empty neutral velocity, valid UVs and extreme offscreen reprojection. Strengthen real lighting assertions to include current HDR and resolved shadow finiteness. Register the new required case.
- [x] Run the isolated regression on SwiftShader and retain RED with unchanged product code. Expected: empty sentinel and extreme velocity fail; occupied/valid cases pass.
- [x] Extend the existing adapter with exact upstream anchors for the empty return, neutral empty export and bounded velocity. Expected: no changed packing/layout/draw contract; occupied optical data unchanged.
- [x] Run isolated GPU regression and full lighting/pipeline on native and SwiftShader sequentially. Expected: all functional assertions pass; expected shader-failure diagnostics remain bounded by their reported time windows. Record exact compiler diagnostics. CDP ReadPixels performance notices are not GL errors, and must remain retained separately from actual GL errors.
- [x] Run typecheck, lint, full Vitest and production build. Expected: all pass, no new warning suppression.
- [ ] Archive source-bound evidence and executable verifier, update audit, commit in Russian Conventional Commit format. Expected: verifier validates source hashes, required probe cases, raw failures and successful checks.
- [ ] Run task completion verifier; request one fresh whole-branch review, adjudicate findings, archive review/ledger, and remove only this plan's scratch workspace.

**Task completion command:** `node benchmark-results/cloud-terminator-2026-11-02/verify-result.mjs` (expected exit 0).

## History-neighbor correction diagnosed during Task 1

Empty current depth uses `-1` with zero motion, and `adaptSceneCloudShadowResolveNumerics(source: string): string` ignores negative depths in the existing closest-fragment search. Wire both adapters in `SceneCloudBackend.ts`. The GPU helper additionally accepts the production resolve source and tests all-empty, mixed and occupied-zero-depth neighborhoods. This prevents the neutral empty tuple from stealing a real cloud's motion; preserve the prior NaN ray guard. RED is `red-history` (8/60 assertions fail); rerun all required final-source checks after this extension.

## Optical-edge correction diagnosed before final review

A zero empty optical front pulls a linearly filtered occupied front toward the light. Preserve the empty maxRayDistance within [0,65504], the finite half-float range, while keeping its extinction/optical depth zero. This changes only the empty sentinel, never occupied depths. Keep the separate absent history depth -1. Extend actual-march GPU cases to a short interval of 100 metres, retain 1e6/1e30, and check that interpolation with an empty neighbor cannot move a representable occupied front toward the light. RED red-optical-edge: 18/79. Repeat final-source regression, full GPU and CLI checks using sources-v3.json; previous successful v2 evidence remains archived.
