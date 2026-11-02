# Cloud current-output half-float portability

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the additional depth/velocity corruption introduced by packed current output on SwiftShader, preserving exact ordinary MRT parity on native and software rendering.

**Architecture:** Keep one RGBA32UI intermediate and the existing two half-float public attachments. Use two words for half-float RGBA, one word for the original float32 depth bits and one word for the two half-float motion components. Convert depth to half only when the unpack pass writes the public MRT, exactly as the ordinary shader does. This uses the previously unused 16 bits without increasing target size or adding draws.

**Tech Stack:** Three.js, postprocessing, GLSL ES 3, Vitest, Chrome/Playwright, native AMD ANGLE D3D11 and SwiftShader.

**Spec:** The user approved continuing the audit after merging the endurance stage. The outstanding packed-output failure is recorded in `docs/project-audit-2026-10-21.md`, section “Интеграция с актуальным master, 29 октября”. Current baseline reproduction and independent raw-packing diagnostics are in `benchmark-results/cloud-half-float-2026-11-02/`. Preserve all seven meaningful channels, early returns, ownership and cache isolation. This fixes additional packing corruption; it does not redefine the upstream MRT treatment of out-of-range depth.

## Global Constraints

- Base `bf930898a578efde171df42478300309e865ccab`; branch `codex/cloud-half-float-2026-11-02`, established in-place checkout and installed dependencies.
- No new dependencies, renderer detection, tolerance, NaN canonicalization, depth clamp, public format change, extra texture or extra pass.
- Raw float readback confirms that the old mismatch exists in the texture. Independent packing confirms depth `1e30` changes neighboring velocity code `6706` to `6707`; this is not merely rounding or a readback discrepancy.
- Preserve exact half-bit comparison, including depth overflow and all seven meaningful channels; the unwritten fourth channel of the vec3 attachment remains excluded.
- Existing ordinary half overflow may yield nonfinite depth on a backend. Preserve that behavior; do not claim general numerical sanitization or portability to untested GPUs.
- Keep all evidence, including failing baselines. No PR or automatic push; the previous stage is already merged, this fix remains on its work branch for review.

## Review Focus

- Depth above half range must not change either motion component: extend the actual GPU sample table through `65504`, `65520`, `65536`, `1e5`, `1e10`, `1e30` and `-1e30` with fixed signed motion.
- Empty/early-return pixels must still write all seven channels: retain the early-return fixture at odd widths/heights and exact comparisons.
- A swapped word or component may look plausible in motion: use distinct depth, positive/negative velocity, HDR and subnormal color fixtures on both backends.
- Format/layout changes must not reintroduce heavy MRT specialization or leaks: run existing ownership/resize/cache tests and real lighting/pipeline GPU probes.
- A passing software test must not hide native regressions: run the same exact-bit GPU check and lighting/pipeline probes on native AMD, plus typecheck, full unit suite and production build.

### Task 1: Isolate depth from half-packed motion

**Files:**
- Modify `src/core/clouds/takram/prepareCloudCurrentOutput.ts`.
- Extend `tests/clouds/scene/currentOutput.gpu.ts`; retain existing `prepareCloudCurrentOutput.spec.ts` lifecycle/cache coverage.
- Update `docs/project-audit-2026-10-21.md`; create `docs/benchmarks/cloud-half-float-2026-11-02.json` with source-bound results.
- Keep external diagnostics, runners and verifier in `benchmark-results/cloud-half-float-2026-11-02/`.

**Interfaces:** `prepareCloudCurrentOutput(pass: ShaderPass, programCacheKey?: string)` retains its `{warmupScene, dispose(): void}` interface. `checkSceneCloudCurrentOutput(renderer, check)` retains its interface and exact-bit oracle. Private layout becomes `uvec4(halfColorRG, halfColorBA, floatDepthBits, halfVelocityGB)`; unpack restores `vec3(uintBitsToFloat(data.z), unpackHalf2x16(data.w))`. Bump the heavy shader cache suffix to `scene-cloud-packed-current-v2`.

- [x] Extend the existing GPU table with the listed depth boundaries and signed motion `[0.003025, -0.0007]`. Expected: all seven channels are still compared exactly against ordinary MRT, with no duplicated pack/unpack oracle.
- [x] Run `node benchmark-results/cloud-half-float-2026-11-02/run-output.mjs red-expanded swift`. Expected: failure in overflow sample depth and/or neighboring motion with unchanged product code; preserve raw reads.
- [x] Implement the private layout and matching unpack expression, explain why depth stays float32 until MRT export, bump the cache suffix. Expected: same allocation/draw/public texture contract.
- [x] Run exact GPU output checks on SwiftShader and native, existing unit coverage, lighting and pipeline probes on both backends. Expected: no failed assertions, unexpected browser/GL errors or resource imbalance.
- [x] Run typecheck, full Vitest suite, lint and production build; inspect outputs. Expected: all required checks pass; no suppression of new shader errors.
- [x] Archive immutable results, source hashes and executable verifier; update audit with cause, scope and limits; commit using Russian Conventional Commit wording.
- [x] One fresh whole-branch review; adjudicate all findings, fix Important/Critical issues test-first once, archive review/ledger and remove only this plan's scratch directory.

**Task completion command:** `node benchmark-results/cloud-half-float-2026-11-02/verify-result.mjs` (recomputes all meaningful-channel comparisons, identities and required check outcomes; expected exit 0).

## Diagnosed extension during Task 1

The first full SwiftShader lighting run now reaches `checkSceneCloudShadowOutput` and exposes the same existing packing failure (depth `1e30`, half bits `65535 != 32767`). Apply the same layout to `prepareCloudShadowOutput.ts`, bump its cache suffix from v3 to v4, and extend `shadowOutput.gpu.ts` with the same seven boundary depths across columns. Preserve all 1–4 cascade, two-frame, odd-size, split-current true/false, draw-count, exact layer comparison, GL-error and disposal checks. Capture a separate shadow RED before changing its implementation, then GREEN on both backends. Regenerate the source manifest under a new name and rerun affected whole-suite/build checks after this change.

Full SwiftShader lighting subsequently exposes pre-existing nonfinite terminator HDR and shadow values. An isolated unchanged real-march fixture gives identical samples with original and candidate packing; preserve both diagnostics and track this separately. Acceptance for this fix is exact current/shadow parity on both backends, native full lighting and pipeline, SwiftShader pipeline, plus the final-source suite/build. Full SwiftShader lighting remains a recorded failure. Run pipeline timing checks without concurrent GPU/CPU diagnostics; retain the initial contended 250.5ms failure. Do not weaken functional, pixel or timing assertions. Expected shader-failure fixtures must be bounded by their reported CDP timestamp windows; record and review exact remaining shader warning identities.
