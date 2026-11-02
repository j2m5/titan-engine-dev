# Production cloud frame profiling

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Localize the remaining long frame intervals during real Alkaid/Thalorn and W26/Halcyra near-cloud flights, then fix only a demonstrated product defect or document the measured bottleneck and remaining uncertainty.

**Architecture:** Reuse the source-bound production build from the preceding cloud-near-flight stage. An external probe uses the actual runtime, native followed camera, deferred GPU timer queries and separate Chrome trace windows. Retain all attempts and independently validate trajectories, timings, diagnostics and lifecycle.

**Tech Stack:** Node24, Vite preview, Playwright native Chrome/AMD ANGLE D3D11, WebGL2 timer queries, CDP tracing.

**Spec:** The user approved investigating the approximately120ms intervals reported in the preceding stage. Existing authorization covers real S3 scenes, documenting findings and correcting confirmed defects. Method, sample counts and instrumentation below are implementer choices. This is diagnostic work within the established inline/in-place feature-branch workflow.

## Global Constraints

- Start from `f8e1c023` on `codex/cloud-frame-profile-2026-11-02`; retain existing dependencies and previous feature branch. No automatic merge/push/PR.
- Verify1481source hashes and52production build files before/after. Unchanged full application tests/build are not repeated. A product change would require RED/GREEN, appropriate full checks and fresh build/source binding.
- Native Chrome,1280x720,DPR1,medium clouds,MSAA8,realS3; Alkaid13/Thalorn130 and W2612/Halcyra120. One page/renderer/context across scenes.
- Preserve simulation speed1 and native positional follow/collision. Derive inside/above altitudes from actual cloud profiles. Terminator75→105degrees; descent from top+8km to layer midpoint at90degrees.
- Full matrix: each scene/route has plain-before,whole-GPU,nonoverlapping-stage-GPU,cloud-draw-GPU,plain-after windows,256frames each. This covers four64phase cloud-noise cycles. One separate256frame Chrome trace window per scene. Smoke:the first64frames of the same256-frame trajectory per mode on Thalorn, preserving step size rather than compressing the full30degree sweep.
- Warm each window at its initial pose, verify readiness and network quiet, then measure uninterrupted motion. No readbacks/screenshots or GPU result polling inside measured windows.
- Collect query results after the callback returns and the engine is stopped; never stop inside renderFrame. Assert0pendingRAF after stop and1after restart; restore descriptors and delete queries even on failure.
- Whole-frame and component GPU queries run in different windows, never nested. GPU elapsed timestamps include their command-stream scope, not presentation latency. Do not sum medians across windows or map an interval to a current GPU frame without queue/trace evidence.
- Preserve raw per-frame data, exact hooks/manifests, reports and trace. Any large trace may remain local only with explicit size/hash and verifier requirement. No warning suppression, lower quality, disabled collision or cloud-art changes.

## Review Focus

- An apparently long cloud frame could be queued GPU work or presentation scheduling: separate wall/CPU/GPU series and trace, preserve initial transients and frame identities rather than attributing interval i to GPU sample i.
- Near clouds render through a separate composer before the main composer: include depth, shadow/cloud updates, near endpoint and final passes without nested queries or missed ownership.
- GPU polling, per-frame GL getters, tracing or loop stop/restart can create the measured tail: plain controls surround instrumentation, query polling stays outside windows, and every stop/restart checks RAF ownership.
- Nominal motion labels can hide stationary/wrong-body routes: derive expected trajectories from catalog and frame index, check actual altitude/sun dot, follow/time, readiness and unchanged history generation.
- Partial/disjoint queries or teardown failures can yield plausible timings: require complete frame/query coverage, finite nonnegative samples, no context loss/disjoint, exact diagnostics and released scene/query resources; reject corrupted copies.

### Task 1: Measure and archive production cloud frame attribution

**Files:** Create external scripts/evidence under `benchmark-results/cloud-frame-profile-2026-11-02/`; update `docs/project-audit-2026-10-21.md`; create `docs/benchmarks/cloud-frame-profile-2026-11-02.json`.

**Interfaces:** Reuse `__productionFrame.connect/selectScenario/menu`, `__nearFlight.connect/describe/move/ready/snapshot`, and existing RAF/context tracking. New probe exposes `connect(runtimeUrl)` and `measure({id,kind,mode,frames,label})`; returns raw pose/time/RAF/cloud rows, nonoverlapping query samples, observed GL work, restoration and resource snapshots. Runner owns sequential windows, network readiness, tracing, exact input snapshots and failure reports.

- [x] Verify clean baseline/source/build and inspect existing native timing, frame-loop and cloud-composition contracts. Expected:1481/52match; current product unchanged.
- [x] Implement external probe/runner and run a64frame smoke per timing mode. Expected:actual active Thalorn clouds, complete finite queries, one RAF chain, exact restoration, or a preserved precise failure.
- [x] Run the22window full matrix sequentially with realS3 assets and separate traces. Expected:5632frames,5610intervals, prescribed poses, complete queries, no new GL/network/runtime errors, both menus released.
- [x] Recalculate per-window statistics, correlate tails only where evidence supports it, and inspect trace/GL events. Expected:documented localization or explicit remaining uncertainty; no unsupported speedup/root-cause claim.
- [x] Implement independent validator with corrupted-report controls for missing/duplicate query samples, disjoint/loss, wrong/self-consistent stationary routes, extraRAF, unready clouds and leaked resources. Expected:accepted original plus rejected controls.
- [x] Save source-bound audit/evidence, commit locally, run `node benchmark-results/cloud-frame-profile-2026-11-02/verify-result.mjs`. Expected:exit0, exact archive/source identities and independently recomputed results.
- [x] One fresh whole-branch review, adjudicate all findings/boundaries, fix confirmed findings once under the user's all-findings priority, verify and archive the completed journal, clean only this plan's scratch directory.

**Outcome:** full-v2 and control-v1 passed; product unchanged. One fresh gpt-6-astra/medium review:Ready to merge Yes,0Critical/0Important/0Minor. Seven review boundaries adjudicated in the archived progress journal; no deferred findings. Complete evidence verification and owned-scratch cleanup conclude this stage; feature branch retained locally.

**Task completion command:** `node benchmark-results/cloud-frame-profile-2026-11-02/verify-result.mjs` (expected exit0).

## Follow-up control from the completed primary matrix

The primary full-v2 matrix passed5632frames/20480queries and two traces. All five traced long gaps overlap115-119ms DXGI Present scopes while renderer task coverage in those gaps is about2ms.39of41intervals>90ms across the matrix are at indices2/5/8/11. This localizes the observed pause but raises a measurement-start transient hypothesis.

Use separate `profile-settled.browser.js`/`run-settled.mjs` copies so accepted full-v2 inputs remain immutable. On each planet, run a plain ABBA control with0/32/32/0normal engine callbacks after hook/setup and before the256-frame trajectory; then a32callback trace control. Record all lead-in callbacks, including their delays, rather than silently discarding them. No GPU query or GL polling in these controls. Keep the same catalog path, settings, assets and one RAF chain. Expected:10windows/2560measuredframes plus192recorded lead-in frames, two clean menu releases; evaluate the result without assuming the hypothesis is true. Extend validation/analysis to this prescribed control matrix and retain both outcomes.
