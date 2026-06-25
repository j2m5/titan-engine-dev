# Procedural Nebula System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a parametrized procedural volumetric nebula as a standalone `Object3D` (`new Nebula(params)` → `scene.add(...)`) with adaptive LOD (raymarch core + impostor far LOD), self-emissive multichromatic color, dust absorption, cheap directional light, and a static form.

**Architecture:** A single `Nebula` `Object3D` owns a bounding-proxy mesh with a raymarch `ShaderMaterial` and, for far/weak-hardware cases, an impostor billboard with a cached render-target texture. The density/appearance algorithm is authored and unit-tested as a pure-TS CPU mirror (`NebulaField`) that drives lobe/cavity placement; the GLSL raymarch shader ports the same algorithm for the GPU hot path. Composition of many sub-clouds happens at the density-field level (`lobes[]`) inside one raymarch pass, not as a `Group` of meshes.

**Tech Stack:** TypeScript (strict), Three.js `^0.182`, custom `AbstractShader`/`AbstractShaderMaterial` GLSL pipeline, the `postprocessing` library (`EffectComposer`, depth buffer, bloom), Vitest + jsdom.

## Global Constraints

- TypeScript `strict: true`, `noUnusedLocals: true`, `noFallthroughCasesInSwitch: true` — code must compile clean under `tsc -b`.
- Module is self-contained under `src/core/renderables/Nebula/` — materials and shaders included.
- Import alias: `@/*` → `src/*`. Tests live in `tests/` (root), named `*.spec.ts`, with Vitest `globals: true` (no need to import `describe`/`it`/`expect`/`vi`). The `@/core/graphic/ThreeJS` and `@/core/graphic/Postprocessing` singletons are mocked in `tests/setup.ts`.
- Scene units via `toThreeJSUnits` from `@/core/helpers/scaling`; internal field math in normalized local proxy space `[-1, 1]`.
- Shaders follow the `ShaderProps` + `AbstractShader` pattern; reuse `#include <noiseFunctions>` (`snoise(vec3)`) from `@/core/materials/shaders/lib/chunks`.
- Renderer uses `logarithmicDepthBuffer: true` (near `1e-6`, far `2000 AU`); `BloomEffect` blooms HDR luminance `> 1`.
- Tick convention: `updateObject(delta)` is called on every scene object by `SceneManager.update()` via `scene.traverse`.
- Single-run test command: `npx vitest run <path>` (the bare `vitest` script is watch mode).
- Every git commit message ends with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Work happens on branch `feature/procedural-nebula` (already created).
- Spec of record: `docs/superpowers/specs/2026-06-26-procedural-nebula-design.md`.

---

## File Structure

```
src/core/renderables/Nebula/
  index.ts                     // export { Nebula }
  Nebula.ts                    // Object3D container; updateObject(delta); LOD switch
  NebulaParams.ts              // types + DEFAULT_NEBULA_PARAMS + mergeNebulaParams
  volume/
    NebulaVolume.ts            // Mesh: bounding proxy + raymarch material
    NebulaImpostor.ts          // Mesh: camera-facing billboard with cached texture
    ImpostorBaker.ts           // RTT bake on parallax threshold
  material/
    NebulaRaymarchMaterial.ts  // extends AbstractShaderMaterial
    NebulaRaymarchShader.ts    // extends AbstractShader -> ShaderProps
    NebulaImpostorMaterial.ts  // cheap billboard material
    shader/
      raymarch.template.ts     // ShaderProps: uniforms + vertex + fragment
      chunks/
        NebulaNoise.ts         // GLSL: fbm / ridged / billow / domainWarp
        NebulaDensity.ts       // GLSL: nebulaDensity(p)
        NebulaColor.ts         // GLSL: palette + secondary channel + dust + light
        NebulaDepth.ts         // GLSL: log-depth linearization + soft-intersect
  fields/
    NebulaField.ts             // CPU density mirror (lobe placement + unit tests)
    valueNoise.ts              // CPU hash value-noise + fbm (deterministic)
  presets/
    index.ts                   // emission / reflection / dark presets

tests/nebula/                  // *.spec.ts (Vitest)
```

GPU tasks (shaders, raymarch material, impostor) are **not** unit-tested in jsdom; they are verified manually by adding a `Nebula` to the live scene and observing. The density algorithm itself is locked down by the CPU `NebulaField` tests, and the GLSL mirrors it.

---

## Task 1: Parameter types, defaults, and merge

**Files:**
- Create: `src/core/renderables/Nebula/NebulaParams.ts`
- Test: `tests/nebula/NebulaParams.spec.ts`

**Interfaces:**
- Produces:
  - `interface NebulaParams` (full shape below)
  - `type DeepPartial<T>`
  - `const DEFAULT_NEBULA_PARAMS: NebulaParams`
  - `function mergeNebulaParams(overrides?: DeepPartial<NebulaParams>): NebulaParams`

- [ ] **Step 1: Write the failing test**

```ts
// tests/nebula/NebulaParams.spec.ts
import { Color, Vector3 } from 'three'
import { DEFAULT_NEBULA_PARAMS, mergeNebulaParams } from '@/core/renderables/Nebula/NebulaParams'

describe('NebulaParams', () => {
  it('exposes a valid default param set', () => {
    const p = DEFAULT_NEBULA_PARAMS
    expect(p.seed).toBeTypeOf('number')
    expect(p.shape).toBe('ellipsoid')
    expect(p.size).toBeGreaterThan(0)
    expect(p.palette.stops.length).toBeGreaterThanOrEqual(2)
    expect(p.noise.octaves).toBeGreaterThanOrEqual(1)
  })

  it('deep-merges overrides over defaults without mutating defaults', () => {
    const merged = mergeNebulaParams({ seed: 42, noise: { octaves: 6 } })
    expect(merged.seed).toBe(42)
    expect(merged.noise.octaves).toBe(6)
    // untouched fields fall back to defaults
    expect(merged.noise.lacunarity).toBe(DEFAULT_NEBULA_PARAMS.noise.lacunarity)
    expect(merged.shape).toBe(DEFAULT_NEBULA_PARAMS.shape)
    // defaults untouched
    expect(DEFAULT_NEBULA_PARAMS.seed).not.toBe(42)
  })

  it('clamps quality.resolutionScale into [0.25, 1]', () => {
    expect(mergeNebulaParams({ quality: { resolutionScale: 5 } }).quality.resolutionScale).toBe(1)
    expect(mergeNebulaParams({ quality: { resolutionScale: 0 } }).quality.resolutionScale).toBe(0.25)
  })

  it('produces independent Color/Vector3 clones per call', () => {
    const a = mergeNebulaParams()
    const b = mergeNebulaParams()
    a.palette.secondary.setRGB(1, 0, 0)
    expect(b.palette.secondary.getHex()).not.toBe(a.palette.secondary.getHex())
    expect(a.axisRatios).not.toBe(b.axisRatios)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/nebula/NebulaParams.spec.ts`
Expected: FAIL — cannot resolve `@/core/renderables/Nebula/NebulaParams`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/renderables/Nebula/NebulaParams.ts
import { Color, Vector3 } from 'three'

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}

export type NebulaShape = 'ellipsoid' | 'disk'
export type NebulaLOD = 'raymarch' | 'impostor' | 'auto'

export interface ColorStop {
  t: number // 0..1 position along density
  color: Color
}

export interface NebulaLobe {
  center: Vector3 // local space, components in [-1, 1]
  radius: number // local units
  weight: number // contribution multiplier
  seed: number
}

export interface NebulaCavity {
  center: Vector3 // local space
  radius: number
  strength: number // 0..1 carve amount
}

export interface NebulaParams {
  seed: number

  size: number // proxy half-extent, Three.js units
  shape: NebulaShape
  axisRatios: Vector3 // anisotropy (x,y,z)
  edgeFalloff: number

  lobes: NebulaLobe[]
  cavities: NebulaCavity[]
  noise: {
    octaves: number
    frequency: number
    lacunarity: number
    gain: number
    warpStrength: number
    ridged: number // 0..1 billow<->ridged mix
    contrast: number
  }

  palette: {
    stops: ColorStop[]
    secondary: Color
    secondaryThreshold: number
    emissiveIntensity: number
  }

  dust: {
    strength: number
    threshold: number
    color: Color
  }

  lighting: {
    starPosition: Vector3 | null // world space
    scatterStrength: number
    ambient: number
  }

  quality: {
    maxSteps: number
    resolutionScale: number
    forceLOD: NebulaLOD
    bake3DTexture: boolean
    bakeResolution: number
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

export function makeDefaultNebulaParams(): NebulaParams {
  return {
    seed: 1337,
    size: 1000,
    shape: 'ellipsoid',
    axisRatios: new Vector3(1, 0.8, 1),
    edgeFalloff: 0.35,
    lobes: [],
    cavities: [],
    noise: {
      octaves: 5,
      frequency: 1.6,
      lacunarity: 2.0,
      gain: 0.5,
      warpStrength: 0.35,
      ridged: 0.4,
      contrast: 1.6
    },
    palette: {
      stops: [
        { t: 0.0, color: new Color(0x14062b) },
        { t: 0.45, color: new Color(0x6a1b9a) },
        { t: 0.8, color: new Color(0xff5577) },
        { t: 1.0, color: new Color(0xffd9a0) }
      ],
      secondary: new Color(0x35d0ff),
      secondaryThreshold: 0.6,
      emissiveIntensity: 1.6
    },
    dust: {
      strength: 0.6,
      threshold: 0.55,
      color: new Color(0x0a0608)
    },
    lighting: {
      starPosition: null,
      scatterStrength: 0.8,
      ambient: 0.25
    },
    quality: {
      maxSteps: 96,
      resolutionScale: 1,
      forceLOD: 'auto',
      bake3DTexture: false,
      bakeResolution: 128
    }
  }
}

export const DEFAULT_NEBULA_PARAMS: NebulaParams = makeDefaultNebulaParams()

export function mergeNebulaParams(overrides: DeepPartial<NebulaParams> = {}): NebulaParams {
  const base = makeDefaultNebulaParams()
  const o = overrides as Partial<NebulaParams>

  if (o.seed !== undefined) base.seed = o.seed
  if (o.size !== undefined) base.size = o.size
  if (o.shape !== undefined) base.shape = o.shape
  if (o.axisRatios) base.axisRatios.copy(o.axisRatios as Vector3)
  if (o.edgeFalloff !== undefined) base.edgeFalloff = o.edgeFalloff
  if (o.lobes) base.lobes = o.lobes as NebulaLobe[]
  if (o.cavities) base.cavities = o.cavities as NebulaCavity[]

  Object.assign(base.noise, overrides.noise)
  if (overrides.palette) {
    if (overrides.palette.stops) base.palette.stops = overrides.palette.stops as ColorStop[]
    if (overrides.palette.secondary) base.palette.secondary.copy(overrides.palette.secondary as Color)
    if (overrides.palette.secondaryThreshold !== undefined)
      base.palette.secondaryThreshold = overrides.palette.secondaryThreshold
    if (overrides.palette.emissiveIntensity !== undefined)
      base.palette.emissiveIntensity = overrides.palette.emissiveIntensity
  }
  if (overrides.dust) {
    if (overrides.dust.strength !== undefined) base.dust.strength = overrides.dust.strength
    if (overrides.dust.threshold !== undefined) base.dust.threshold = overrides.dust.threshold
    if (overrides.dust.color) base.dust.color.copy(overrides.dust.color as Color)
  }
  if (overrides.lighting) {
    if (overrides.lighting.starPosition !== undefined)
      base.lighting.starPosition = overrides.lighting.starPosition
        ? (overrides.lighting.starPosition as Vector3).clone()
        : null
    if (overrides.lighting.scatterStrength !== undefined)
      base.lighting.scatterStrength = overrides.lighting.scatterStrength
    if (overrides.lighting.ambient !== undefined) base.lighting.ambient = overrides.lighting.ambient
  }
  Object.assign(base.quality, overrides.quality)

  base.quality.resolutionScale = clamp(base.quality.resolutionScale, 0.25, 1)
  base.quality.bakeResolution = clamp(base.quality.bakeResolution, 64, 256)
  base.quality.maxSteps = clamp(Math.round(base.quality.maxSteps), 8, 256)

  return base
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/nebula/NebulaParams.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/renderables/Nebula/NebulaParams.ts tests/nebula/NebulaParams.spec.ts
git commit -m "feat(nebula): parameter types, defaults, and deep merge

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Deterministic CPU value-noise + fbm

**Files:**
- Create: `src/core/renderables/Nebula/fields/valueNoise.ts`
- Test: `tests/nebula/valueNoise.spec.ts`

**Interfaces:**
- Consumes: `SeededRandom` pattern (mulberry32) — re-implemented here as a pure hash, no import needed.
- Produces:
  - `function hash3(x: number, y: number, z: number, seed: number): number` → `[0, 1)`
  - `function valueNoise3(x: number, y: number, z: number, seed: number): number` → `[-1, 1]`
  - `function fbm3(p: { x: number; y: number; z: number }, seed: number, octaves: number, lacunarity: number, gain: number): number` → roughly `[-1, 1]`

This is the CPU mirror of the GLSL noise. It need not be bit-identical to GLSL simplex; it must be deterministic and have the same octave/lacunarity/gain semantics so field invariants hold.

- [ ] **Step 1: Write the failing test**

```ts
// tests/nebula/valueNoise.spec.ts
import { fbm3, hash3, valueNoise3 } from '@/core/renderables/Nebula/fields/valueNoise'

describe('valueNoise', () => {
  it('hash3 is deterministic and within [0,1)', () => {
    const a = hash3(1, 2, 3, 99)
    const b = hash3(1, 2, 3, 99)
    expect(a).toBe(b)
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThan(1)
    expect(hash3(1, 2, 3, 100)).not.toBe(a) // seed changes output
  })

  it('valueNoise3 is continuous and bounded in [-1,1]', () => {
    for (let i = 0; i < 50; i++) {
      const n = valueNoise3(i * 0.37, i * 0.11, i * 0.93, 7)
      expect(n).toBeGreaterThanOrEqual(-1.0001)
      expect(n).toBeLessThanOrEqual(1.0001)
    }
    // small steps -> small changes (continuity)
    const n0 = valueNoise3(3.0, 1.0, 2.0, 7)
    const n1 = valueNoise3(3.001, 1.0, 2.0, 7)
    expect(Math.abs(n1 - n0)).toBeLessThan(0.05)
  })

  it('fbm3 adds detail without exploding magnitude', () => {
    const v = fbm3({ x: 0.5, y: 0.2, z: 0.9 }, 7, 5, 2.0, 0.5)
    expect(Number.isFinite(v)).toBe(true)
    expect(Math.abs(v)).toBeLessThan(2)
    // determinism
    expect(fbm3({ x: 0.5, y: 0.2, z: 0.9 }, 7, 5, 2.0, 0.5)).toBe(v)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/nebula/valueNoise.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/renderables/Nebula/fields/valueNoise.ts

export function hash3(x: number, y: number, z: number, seed: number): number {
  let h = (seed | 0) ^ 0x9e3779b9
  h = Math.imul(h ^ Math.floor(x * 374761393), 0x85ebca6b)
  h = Math.imul(h ^ Math.floor(y * 668265263), 0xc2b2ae35)
  h = Math.imul(h ^ Math.floor(z * 2246822519), 0x27d4eb2f)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

function smooth(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const zi = Math.floor(z)
  const xf = x - xi
  const yf = y - yi
  const zf = z - zi
  const u = smooth(xf)
  const v = smooth(yf)
  const w = smooth(zf)

  const c000 = hash3(xi, yi, zi, seed)
  const c100 = hash3(xi + 1, yi, zi, seed)
  const c010 = hash3(xi, yi + 1, zi, seed)
  const c110 = hash3(xi + 1, yi + 1, zi, seed)
  const c001 = hash3(xi, yi, zi + 1, seed)
  const c101 = hash3(xi + 1, yi, zi + 1, seed)
  const c011 = hash3(xi, yi + 1, zi + 1, seed)
  const c111 = hash3(xi + 1, yi + 1, zi + 1, seed)

  const x00 = lerp(c000, c100, u)
  const x10 = lerp(c010, c110, u)
  const x01 = lerp(c001, c101, u)
  const x11 = lerp(c011, c111, u)
  const y0 = lerp(x00, x10, v)
  const y1 = lerp(x01, x11, v)
  return lerp(y0, y1, w) * 2 - 1
}

export function fbm3(
  p: { x: number; y: number; z: number },
  seed: number,
  octaves: number,
  lacunarity: number,
  gain: number
): number {
  let sum = 0
  let amp = 0.5
  let freq = 1
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise3(p.x * freq, p.y * freq, p.z * freq, seed + i * 1013)
    norm += amp
    amp *= gain
    freq *= lacunarity
  }
  return norm > 0 ? sum / norm : 0
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/nebula/valueNoise.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/renderables/Nebula/fields/valueNoise.ts tests/nebula/valueNoise.spec.ts
git commit -m "feat(nebula): deterministic CPU value-noise and fbm

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: NebulaField — boundary + shape

**Files:**
- Create: `src/core/renderables/Nebula/fields/NebulaField.ts`
- Test: `tests/nebula/NebulaField.boundary.spec.ts`

**Interfaces:**
- Consumes: `NebulaParams` (Task 1), `fbm3` (Task 2).
- Produces:
  - `class NebulaField` with constructor `(params: NebulaParams)`
  - `boundary(p: Vector3): number` → `[0, 1]` (shape falloff only, no noise)
  - `sampleDensity(p: Vector3): number` → `[0, 1]` (full pipeline; later tasks extend it)

In this task `sampleDensity` returns only the boundary term so the test suite has a stable anchor; Tasks 4–5 layer noise, lobes, cavities, dust into it.

- [ ] **Step 1: Write the failing test**

```ts
// tests/nebula/NebulaField.boundary.spec.ts
import { Vector3 } from 'three'
import { NebulaField } from '@/core/renderables/Nebula/fields/NebulaField'
import { mergeNebulaParams } from '@/core/renderables/Nebula/NebulaParams'

describe('NebulaField boundary', () => {
  it('is maximal at center and zero outside the proxy', () => {
    const field = new NebulaField(mergeNebulaParams({ shape: 'ellipsoid' }))
    expect(field.boundary(new Vector3(0, 0, 0))).toBeGreaterThan(0.5)
    expect(field.boundary(new Vector3(5, 0, 0))).toBe(0) // far outside [-1,1]
  })

  it('density stays within [0,1] across a grid', () => {
    const field = new NebulaField(mergeNebulaParams())
    for (let x = -1.5; x <= 1.5; x += 0.5)
      for (let y = -1.5; y <= 1.5; y += 0.5)
        for (let z = -1.5; z <= 1.5; z += 0.5) {
          const d = field.sampleDensity(new Vector3(x, y, z))
          expect(d).toBeGreaterThanOrEqual(0)
          expect(d).toBeLessThanOrEqual(1)
        }
  })

  it('disk is flatter along Y than ellipsoid for equal axisRatios', () => {
    const ell = new NebulaField(mergeNebulaParams({ shape: 'ellipsoid' }))
    const disk = new NebulaField(mergeNebulaParams({ shape: 'disk' }))
    const probe = new Vector3(0, 0.6, 0)
    expect(disk.boundary(probe)).toBeLessThan(ell.boundary(probe))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/nebula/NebulaField.boundary.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/renderables/Nebula/fields/NebulaField.ts
import { Vector3 } from 'three'
import { NebulaParams } from '@/core/renderables/Nebula/NebulaParams'

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

export class NebulaField {
  private readonly p: NebulaParams
  private readonly invAxis: Vector3

  public constructor(params: NebulaParams) {
    this.p = params
    this.invAxis = new Vector3(
      1 / Math.max(1e-4, params.axisRatios.x),
      1 / Math.max(1e-4, params.axisRatios.y),
      1 / Math.max(1e-4, params.axisRatios.z)
    )
  }

  /** Analytic shape falloff in local space [-1,1]; no noise. Returns [0,1]. */
  public boundary(p: Vector3): number {
    const x = p.x * this.invAxis.x
    const y = p.y * this.invAxis.y
    const z = p.z * this.invAxis.z

    if (this.p.shape === 'disk') {
      const r = Math.sqrt(x * x + z * z)
      const radial = 1 - smoothstep(1 - this.p.edgeFalloff, 1, r)
      const vertical = 1 - smoothstep(1 - this.p.edgeFalloff, 1, Math.abs(y))
      return Math.max(0, radial * vertical)
    }

    const r = Math.sqrt(x * x + y * y + z * z)
    return 1 - smoothstep(1 - this.p.edgeFalloff, 1, r)
  }

  /** Full density pipeline. Extended by later tasks. Returns [0,1]. */
  public sampleDensity(p: Vector3): number {
    return this.boundary(p)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/nebula/NebulaField.boundary.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/renderables/Nebula/fields/NebulaField.ts tests/nebula/NebulaField.boundary.spec.ts
git commit -m "feat(nebula): NebulaField boundary + shape falloff

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: NebulaField — fbm + domain warp + contrast

**Files:**
- Modify: `src/core/renderables/Nebula/fields/NebulaField.ts`
- Test: `tests/nebula/NebulaField.noise.spec.ts`

**Interfaces:**
- Consumes: `boundary` (Task 3), `fbm3` (Task 2).
- Produces: extends `sampleDensity` to apply domain warp + fbm + contrast; adds private `noiseField(p: Vector3): number` → `[0,1]`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/nebula/NebulaField.noise.spec.ts
import { Vector3 } from 'three'
import { NebulaField } from '@/core/renderables/Nebula/fields/NebulaField'
import { mergeNebulaParams } from '@/core/renderables/Nebula/NebulaParams'

describe('NebulaField noise', () => {
  it('introduces spatial variation inside the proxy', () => {
    const field = new NebulaField(mergeNebulaParams({ noise: { warpStrength: 0.4 } }))
    const samples: number[] = []
    for (let i = 0; i < 40; i++)
      samples.push(field.sampleDensity(new Vector3(Math.sin(i) * 0.4, Math.cos(i) * 0.3, (i % 7) * 0.1)))
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length
    const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length
    expect(variance).toBeGreaterThan(0.0005) // not a flat blob
  })

  it('is deterministic for a fixed seed', () => {
    const a = new NebulaField(mergeNebulaParams({ seed: 5 }))
    const b = new NebulaField(mergeNebulaParams({ seed: 5 }))
    const probe = new Vector3(0.2, -0.1, 0.3)
    expect(a.sampleDensity(probe)).toBe(b.sampleDensity(probe))
  })

  it('stays within [0,1]', () => {
    const field = new NebulaField(mergeNebulaParams({ noise: { contrast: 2.5 } }))
    for (let i = 0; i < 60; i++) {
      const d = field.sampleDensity(new Vector3((i % 5) * 0.3 - 0.6, (i % 3) * 0.4 - 0.4, (i % 7) * 0.2 - 0.7))
      expect(d).toBeGreaterThanOrEqual(0)
      expect(d).toBeLessThanOrEqual(1)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/nebula/NebulaField.noise.spec.ts`
Expected: FAIL — variance assertion fails (current `sampleDensity` returns smooth boundary only).

- [ ] **Step 3: Write minimal implementation**

Add imports and replace `sampleDensity` in `NebulaField.ts`:

```ts
import { fbm3 } from '@/core/renderables/Nebula/fields/valueNoise'
```

```ts
  private noiseField(p: Vector3): number {
    const n = this.p.noise
    // domain warp
    const wx = fbm3({ x: p.x + 11.3, y: p.y, z: p.z }, this.p.seed + 101, 3, n.lacunarity, n.gain)
    const wy = fbm3({ x: p.x, y: p.y + 7.7, z: p.z }, this.p.seed + 202, 3, n.lacunarity, n.gain)
    const wz = fbm3({ x: p.x, y: p.y, z: p.z + 19.1 }, this.p.seed + 303, 3, n.lacunarity, n.gain)
    const q = new Vector3(
      p.x + n.warpStrength * wx,
      p.y + n.warpStrength * wy,
      p.z + n.warpStrength * wz
    ).multiplyScalar(n.frequency)

    let base = fbm3(q, this.p.seed, n.octaves, n.lacunarity, n.gain)
    // billow <-> ridged mix
    const billow = Math.abs(base)
    const ridged = 1 - Math.abs(base)
    base = (1 - n.ridged) * billow + n.ridged * ridged
    return Math.min(1, Math.max(0, base))
  }

  public sampleDensity(p: Vector3): number {
    const b = this.boundary(p)
    if (b <= 0) return 0
    const noise = this.noiseField(p)
    let d = b * noise
    d = Math.pow(d, this.p.noise.contrast)
    return Math.min(1, Math.max(0, d))
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/nebula/NebulaField.noise.spec.ts`
Expected: PASS (3 tests). Also re-run Task 3 suite to confirm no regression: `npx vitest run tests/nebula/NebulaField.boundary.spec.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/renderables/Nebula/fields/NebulaField.ts tests/nebula/NebulaField.noise.spec.ts
git commit -m "feat(nebula): NebulaField domain warp + fbm + contrast

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: NebulaField — lobes, cavities, dust mask

**Files:**
- Modify: `src/core/renderables/Nebula/fields/NebulaField.ts`
- Test: `tests/nebula/NebulaField.structure.spec.ts`

**Interfaces:**
- Consumes: `NebulaLobe`, `NebulaCavity` (Task 1).
- Produces:
  - extends `sampleDensity` to add lobe contribution + cavity carving
  - `dustMask(p: Vector3): number` → `[0,1]` (used later by GPU color; tested on CPU here)

- [ ] **Step 1: Write the failing test**

```ts
// tests/nebula/NebulaField.structure.spec.ts
import { Vector3 } from 'three'
import { NebulaField } from '@/core/renderables/Nebula/fields/NebulaField'
import { mergeNebulaParams } from '@/core/renderables/Nebula/NebulaParams'

describe('NebulaField structure', () => {
  it('a lobe raises density in its neighborhood', () => {
    const probe = new Vector3(0.5, 0, 0)
    const plain = new NebulaField(mergeNebulaParams({ seed: 3 }))
    const withLobe = new NebulaField(
      mergeNebulaParams({
        seed: 3,
        lobes: [{ center: new Vector3(0.5, 0, 0), radius: 0.3, weight: 1.5, seed: 9 }]
      })
    )
    expect(withLobe.sampleDensity(probe)).toBeGreaterThan(plain.sampleDensity(probe))
  })

  it('a cavity lowers density at its center', () => {
    const probe = new Vector3(-0.3, 0.1, 0.2)
    const plain = new NebulaField(mergeNebulaParams({ seed: 3 }))
    const withCavity = new NebulaField(
      mergeNebulaParams({
        seed: 3,
        cavities: [{ center: new Vector3(-0.3, 0.1, 0.2), radius: 0.3, strength: 1 }]
      })
    )
    expect(withCavity.sampleDensity(probe)).toBeLessThanOrEqual(plain.sampleDensity(probe))
  })

  it('dustMask is bounded in [0,1] and varies in space', () => {
    const field = new NebulaField(mergeNebulaParams())
    const a = field.dustMask(new Vector3(0.1, 0.2, 0.3))
    const b = field.dustMask(new Vector3(-0.4, 0.05, 0.6))
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThanOrEqual(1)
    expect(a).not.toBe(b)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/nebula/NebulaField.structure.spec.ts`
Expected: FAIL — `dustMask` is not a function; lobe assertion may fail.

- [ ] **Step 3: Write minimal implementation**

Add to `NebulaField.ts` (helpers + extend `sampleDensity`):

```ts
  private lobeContribution(p: Vector3): number {
    let extra = 0
    for (const lobe of this.p.lobes) {
      const dx = p.x - lobe.center.x
      const dy = p.y - lobe.center.y
      const dz = p.z - lobe.center.z
      const d2 = dx * dx + dy * dy + dz * dz
      const r2 = Math.max(1e-4, lobe.radius * lobe.radius)
      extra += lobe.weight * Math.exp(-d2 / r2)
    }
    return extra
  }

  private cavityCarve(p: Vector3): number {
    let carve = 1
    for (const cav of this.p.cavities) {
      const dx = p.x - cav.center.x
      const dy = p.y - cav.center.y
      const dz = p.z - cav.center.z
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
      const inside = 1 - Math.min(1, d / Math.max(1e-4, cav.radius))
      carve *= 1 - cav.strength * inside
    }
    return Math.max(0, carve)
  }

  public dustMask(p: Vector3): number {
    // low-frequency ridged channel, independent seed offset
    const n = fbm3({ x: p.x * 0.9, y: p.y * 0.9, z: p.z * 0.9 }, this.p.seed + 555, 3, this.p.noise.lacunarity, this.p.noise.gain)
    const ridged = 1 - Math.abs(n)
    return Math.min(1, Math.max(0, ridged))
  }
```

Replace `sampleDensity` body:

```ts
  public sampleDensity(p: Vector3): number {
    const b = this.boundary(p)
    if (b <= 0) return 0
    const noise = this.noiseField(p)
    let d = b * (noise + this.lobeContribution(p))
    d *= this.cavityCarve(p)
    d = Math.pow(Math.min(1, Math.max(0, d)), this.p.noise.contrast)
    return Math.min(1, Math.max(0, d))
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/nebula/NebulaField.structure.spec.ts`
Expected: PASS (3 tests). Re-run prior field suites to confirm no regression:
`npx vitest run tests/nebula/` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/renderables/Nebula/fields/NebulaField.ts tests/nebula/NebulaField.structure.spec.ts
git commit -m "feat(nebula): NebulaField lobes, cavities, dust mask

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Presets + factory helpers

**Files:**
- Create: `src/core/renderables/Nebula/presets/index.ts`
- Test: `tests/nebula/presets.spec.ts`

**Interfaces:**
- Consumes: `mergeNebulaParams`, `DeepPartial<NebulaParams>` (Task 1).
- Produces:
  - `const NEBULA_PRESETS: Record<'emission' | 'reflection' | 'dark', DeepPartial<NebulaParams>>`
  - `function makeNebulaParams(preset: keyof typeof NEBULA_PRESETS, overrides?: DeepPartial<NebulaParams>): NebulaParams`

- [ ] **Step 1: Write the failing test**

```ts
// tests/nebula/presets.spec.ts
import { makeNebulaParams, NEBULA_PRESETS } from '@/core/renderables/Nebula/presets'

describe('nebula presets', () => {
  it('exposes the three named presets', () => {
    expect(Object.keys(NEBULA_PRESETS).sort()).toEqual(['dark', 'emission', 'reflection'])
  })

  it('applies a preset then user overrides on top', () => {
    const p = makeNebulaParams('dark', { seed: 77 })
    expect(p.seed).toBe(77)
    // dark preset cranks dust strength above the default 0.6
    expect(p.dust.strength).toBeGreaterThan(0.6)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/nebula/presets.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/renderables/Nebula/presets/index.ts
import { Color } from 'three'
import { DeepPartial, NebulaParams, mergeNebulaParams } from '@/core/renderables/Nebula/NebulaParams'

export const NEBULA_PRESETS: Record<'emission' | 'reflection' | 'dark', DeepPartial<NebulaParams>> = {
  emission: {
    palette: { emissiveIntensity: 2.0, secondary: new Color(0x35d0ff) },
    noise: { ridged: 0.5, contrast: 1.7 }
  },
  reflection: {
    palette: {
      stops: [
        { t: 0.0, color: new Color(0x050a1a) },
        { t: 0.6, color: new Color(0x2a6fb0) },
        { t: 1.0, color: new Color(0xbfe3ff) }
      ],
      emissiveIntensity: 1.2
    },
    lighting: { scatterStrength: 1.2, ambient: 0.3 }
  },
  dark: {
    palette: { emissiveIntensity: 0.8 },
    dust: { strength: 0.9, threshold: 0.4 },
    noise: { contrast: 2.0 }
  }
}

export function makeNebulaParams(
  preset: keyof typeof NEBULA_PRESETS,
  overrides: DeepPartial<NebulaParams> = {}
): NebulaParams {
  const merged = mergeNebulaParams(NEBULA_PRESETS[preset])
  return mergeNebulaParams({ ...overrides, ...presetToPartial(merged) } as DeepPartial<NebulaParams>)
}

// Re-merge: apply preset to defaults, then overrides win. Simpler explicit form:
function presetToPartial(_full: NebulaParams): DeepPartial<NebulaParams> {
  return {}
}
```

NOTE for implementer: the `presetToPartial` indirection above is a placeholder that fails the override-precedence test. Replace `makeNebulaParams` with the direct two-stage merge below and delete `presetToPartial`:

```ts
export function makeNebulaParams(
  preset: keyof typeof NEBULA_PRESETS,
  overrides: DeepPartial<NebulaParams> = {}
): NebulaParams {
  const withPreset = mergeNebulaParams(NEBULA_PRESETS[preset])
  // second merge: start from preset result, apply user overrides on top
  return mergeNebulaParams({
    ...deepClonePartial(withPreset),
    ...overrides
  } as DeepPartial<NebulaParams>)
}
```

Because `mergeNebulaParams` already deep-merges group-by-group, the cleanest correct implementation is to make `mergeNebulaParams` accept an optional base. Implementer: add an overload to `NebulaParams.ts`:

```ts
export function mergeNebulaParams(
  overrides: DeepPartial<NebulaParams> = {},
  base: NebulaParams = makeDefaultNebulaParams()
): NebulaParams { /* ...existing body but start from the passed base... */ }
```

then:

```ts
export function makeNebulaParams(
  preset: keyof typeof NEBULA_PRESETS,
  overrides: DeepPartial<NebulaParams> = {}
): NebulaParams {
  return mergeNebulaParams(overrides, mergeNebulaParams(NEBULA_PRESETS[preset]))
}
```

Update Task 1's `mergeNebulaParams` signature accordingly (replace `const base = makeDefaultNebulaParams()` with the `base` parameter). Re-run Task 1 tests to confirm no regression.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/nebula/presets.spec.ts tests/nebula/NebulaParams.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/renderables/Nebula/presets/index.ts src/core/renderables/Nebula/NebulaParams.ts tests/nebula/presets.spec.ts
git commit -m "feat(nebula): presets + base-aware param merge

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Add `cellular3d` (Worley) to the shared noise chunk

**Files:**
- Modify: `src/core/materials/shaders/lib/chunks/Noise.ts`
- (No new unit test — GLSL; verified when used in Task 11.)

**Interfaces:**
- Produces (GLSL, injected via `#include <noiseFunctions>`):
  - `vec2 cellular3d(vec3 P)` → `vec2(F1, F2)` nearest/second-nearest feature distances.

**Owner approval gate:** This edits the shared noise library. Confirm with the project owner before merging (the owner asked to keep `Noise.ts` lean and add primitives only on demand).

- [ ] **Step 1: Append the Worley function inside the `noiseFunctions` template string**

Insert before the closing backtick of `noiseFunctions` in `Noise.ts`:

```glsl
  // Cellular / Worley noise (Stefan Gustavson style, 3x3x3 search).
  // Returns vec2(F1, F2): nearest and second-nearest feature point distances.
  vec3 cellular_mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 cellular_permute(vec3 x) { return cellular_mod289((34.0 * x + 1.0) * x); }

  vec2 cellular3d(vec3 P) {
    #define K 0.142857142857   // 1/7
    #define Ko 0.428571428571  // 3/7
    #define jitter 1.0
    vec3 Pi = cellular_mod289(floor(P));
    vec3 Pf = fract(P);
    vec3 oi = vec3(-1.0, 0.0, 1.0);
    vec3 of = vec3(-0.5, 0.5, 1.5);
    vec3 px = cellular_permute(Pi.x + oi);
    float F1 = 1e6; float F2 = 1e6;
    for (int i = 0; i < 3; i++) {
      vec3 p = cellular_permute(px[i] + Pi.y + oi);
      for (int j = 0; j < 3; j++) {
        vec3 pp = cellular_permute(p[j] + Pi.z + oi);
        vec3 ox = fract(pp * K) - Ko;
        vec3 oy = mod(floor(pp * K), 7.0) * K - Ko;
        vec3 pz = cellular_permute(pp);
        vec3 oz = fract(pz * K) - Ko;
        vec3 dx = Pf.x - of[i] + jitter * ox;
        vec3 dy = Pf.y - of[j] + jitter * oy;
        for (int k = 0; k < 3; k++) {
          float dz = Pf.z - of[k] + jitter * oz[k];
          float d = dx[k] * dx[k] + dy[k] * dy[k] + dz * dz;
          if (d < F1) { F2 = F1; F1 = d; }
          else if (d < F2) { F2 = d; }
        }
      }
    }
    return sqrt(vec2(F1, F2));
  }
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b`
Expected: PASS (the change is inside a template string; no TS error).

- [ ] **Step 3: Commit**

```bash
git add src/core/materials/shaders/lib/chunks/Noise.ts
git commit -m "feat(noise): add cellular3d (Worley F1/F2) to shared chunk

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: GLSL nebula chunks (noise / density) + raymarch template + shader/material classes

**Files:**
- Create: `src/core/renderables/Nebula/material/shader/chunks/NebulaNoise.ts`
- Create: `src/core/renderables/Nebula/material/shader/chunks/NebulaDensity.ts`
- Create: `src/core/renderables/Nebula/material/shader/raymarch.template.ts`
- Create: `src/core/renderables/Nebula/material/NebulaRaymarchShader.ts`
- Create: `src/core/renderables/Nebula/material/NebulaRaymarchMaterial.ts`
- Test: `tests/nebula/NebulaRaymarchMaterial.spec.ts` (construction smoke only)

**Interfaces:**
- Consumes: `NebulaParams` (Task 1), `AbstractShader`/`AbstractShaderMaterial`/`ShaderProps` patterns.
- Produces:
  - GLSL string exports `nebulaNoiseChunk`, `nebulaDensityChunk` (plain `export const x = \`...\``).
  - `const NebulaRaymarchShaderTemplate: ShaderProps`.
  - `class NebulaRaymarchShader extends AbstractShader`.
  - `class NebulaRaymarchMaterial extends AbstractShaderMaterial` with constructor `(params: NebulaParams)`, `updateMaterial()`, `resetMaterial()`, and `setUniformsFromParams(params)`.

The smoke test only verifies the material constructs with sane uniforms; visual correctness is verified in Task 9.

- [ ] **Step 1: Write the failing smoke test**

```ts
// tests/nebula/NebulaRaymarchMaterial.spec.ts
import { NebulaRaymarchMaterial } from '@/core/renderables/Nebula/material/NebulaRaymarchMaterial'
import { mergeNebulaParams } from '@/core/renderables/Nebula/NebulaParams'

describe('NebulaRaymarchMaterial', () => {
  it('constructs with uniforms derived from params', () => {
    const mat = new NebulaRaymarchMaterial(mergeNebulaParams({ quality: { maxSteps: 64 } }))
    expect(mat.uniforms.uMaxSteps.value).toBe(64)
    expect(mat.transparent).toBe(true)
    expect(mat.depthWrite).toBe(false)
    expect(typeof mat.vertexShader).toBe('string')
    expect(mat.fragmentShader.length).toBeGreaterThan(0)
  })

  it('updateMaterial advances uTime without throwing', () => {
    const mat = new NebulaRaymarchMaterial(mergeNebulaParams())
    const before = mat.uniforms.uTime.value
    mat.updateMaterial()
    expect(mat.uniforms.uTime.value).toBeGreaterThanOrEqual(before)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/nebula/NebulaRaymarchMaterial.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the GLSL chunks**

```ts
// src/core/renderables/Nebula/material/shader/chunks/NebulaNoise.ts
export const nebulaNoiseChunk = `
  // fbm built on snoise(vec3) from <noiseFunctions>
  float nebFbm(vec3 p, int octaves, float lacunarity, float gain) {
    float sum = 0.0; float amp = 0.5; float freq = 1.0; float norm = 0.0;
    for (int i = 0; i < 8; i++) {
      if (i >= octaves) break;
      sum += amp * snoise(p * freq);
      norm += amp;
      amp *= gain; freq *= lacunarity;
    }
    return norm > 0.0 ? (sum / norm) : 0.0;
  }

  vec3 nebDomainWarp(vec3 p, float strength, float lacunarity, float gain) {
    float wx = nebFbm(p + vec3(11.3, 0.0, 0.0), 3, lacunarity, gain);
    float wy = nebFbm(p + vec3(0.0, 7.7, 0.0), 3, lacunarity, gain);
    float wz = nebFbm(p + vec3(0.0, 0.0, 19.1), 3, lacunarity, gain);
    return p + strength * vec3(wx, wy, wz);
  }
`
```

```ts
// src/core/renderables/Nebula/material/shader/chunks/NebulaDensity.ts
export const nebulaDensityChunk = `
  uniform int   uShape;        // 0 ellipsoid, 1 disk
  uniform vec3  uInvAxis;
  uniform float uEdgeFalloff;
  uniform int   uOctaves;
  uniform float uFrequency;
  uniform float uLacunarity;
  uniform float uGain;
  uniform float uWarpStrength;
  uniform float uRidged;
  uniform float uContrast;

  float nebBoundary(vec3 p) {
    vec3 a = p * uInvAxis;
    if (uShape == 1) {
      float r = length(a.xz);
      float radial = 1.0 - smoothstep(1.0 - uEdgeFalloff, 1.0, r);
      float vertical = 1.0 - smoothstep(1.0 - uEdgeFalloff, 1.0, abs(a.y));
      return max(0.0, radial * vertical);
    }
    float r = length(a);
    return 1.0 - smoothstep(1.0 - uEdgeFalloff, 1.0, r);
  }

  // Returns density in [0,1]. Worley cavities/lobes added in Task 11.
  float nebulaDensity(vec3 p) {
    float b = nebBoundary(p);
    if (b <= 0.0) return 0.0;
    vec3 q = nebDomainWarp(p, uWarpStrength, uLacunarity, uGain) * uFrequency;
    float base = nebFbm(q, uOctaves, uLacunarity, uGain);
    float billow = abs(base);
    float ridged = 1.0 - abs(base);
    base = mix(billow, ridged, uRidged);
    float d = b * clamp(base, 0.0, 1.0);
    d = pow(clamp(d, 0.0, 1.0), uContrast);
    return clamp(d, 0.0, 1.0);
  }
`
```

- [ ] **Step 4: Write the raymarch template**

```ts
// src/core/renderables/Nebula/material/shader/raymarch.template.ts
import { Uniform, Vector3 } from 'three'
import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { nebulaNoiseChunk } from './chunks/NebulaNoise'
import { nebulaDensityChunk } from './chunks/NebulaDensity'

export const NebulaRaymarchShaderTemplate: ShaderProps = {
  name: 'NebulaRaymarchShader',
  uniforms: {
    uMaxSteps: new Uniform(96),
    uTime: new Uniform(0),
    uShape: new Uniform(0),
    uInvAxis: new Uniform(new Vector3(1, 1, 1)),
    uEdgeFalloff: new Uniform(0.35),
    uOctaves: new Uniform(5),
    uFrequency: new Uniform(1.6),
    uLacunarity: new Uniform(2.0),
    uGain: new Uniform(0.5),
    uWarpStrength: new Uniform(0.35),
    uRidged: new Uniform(0.4),
    uContrast: new Uniform(1.6),
    uEmissiveIntensity: new Uniform(1.6)
  },
  vertexShader: `
    precision highp float;
    varying vec3 vLocalPos;      // proxy-local position [-1,1]
    varying vec3 vWorldPos;
    void main() {
      vLocalPos = position;       // unit-cube/sphere geometry in [-1,1]
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: `
    precision highp float;
    #include <noiseFunctions>
    ${nebulaNoiseChunk}
    ${nebulaDensityChunk}

    varying vec3 vLocalPos;
    varying vec3 vWorldPos;
    uniform float uMaxSteps;
    uniform float uEmissiveIntensity;

    // Camera position in proxy-local space passed via modelMatrix inverse.
    uniform mat4 uInvModelMatrix;
    uniform vec3 uCameraWorld;

    // Ray-box intersection in local space, box [-1,1]^3.
    vec2 intersectBox(vec3 ro, vec3 rd) {
      vec3 inv = 1.0 / rd;
      vec3 t0 = (vec3(-1.0) - ro) * inv;
      vec3 t1 = (vec3( 1.0) - ro) * inv;
      vec3 tmin = min(t0, t1);
      vec3 tmax = max(t0, t1);
      float tn = max(max(tmin.x, tmin.y), tmin.z);
      float tf = min(min(tmax.x, tmax.y), tmax.z);
      return vec2(tn, tf);
    }

    float dither(vec2 uv) {
      return fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec3 roLocal = (uInvModelMatrix * vec4(uCameraWorld, 1.0)).xyz;
      vec3 rdLocal = normalize(vLocalPos - roLocal);
      vec2 hit = intersectBox(roLocal, rdLocal);
      float tn = max(hit.x, 0.0);
      float tf = hit.y;
      if (tf <= tn) discard;

      int steps = int(uMaxSteps);
      float dt = (tf - tn) / uMaxSteps;
      float t = tn + dt * dither(gl_FragCoord.xy);

      float transmittance = 1.0;
      vec3 accum = vec3(0.0);
      for (int i = 0; i < 256; i++) {
        if (i >= steps) break;
        vec3 p = roLocal + rdLocal * t;
        float d = nebulaDensity(p);
        if (d > 0.001) {
          float a = d * dt * 4.0;
          a = clamp(a, 0.0, 1.0);
          vec3 c = vec3(d) * uEmissiveIntensity; // single-color placeholder; Task 10 adds palette
          accum += transmittance * a * c;
          transmittance *= (1.0 - a);
          if (transmittance < 0.01) break;
        }
        t += dt;
      }
      float alpha = 1.0 - transmittance;
      if (alpha < 0.002) discard;
      gl_FragColor = vec4(accum, alpha); // premultiplied
    }
  `
}
```

- [ ] **Step 5: Write the shader + material classes**

```ts
// src/core/renderables/Nebula/material/NebulaRaymarchShader.ts
import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { NebulaRaymarchShaderTemplate } from './shader/raymarch.template'

class NebulaRaymarchShader extends AbstractShader {
  public constructor() {
    super(NebulaRaymarchShaderTemplate)
  }
}

export { NebulaRaymarchShader }
```

```ts
// src/core/renderables/Nebula/material/NebulaRaymarchMaterial.ts
import { AdditiveBlending, Matrix4, Uniform, Vector3 } from 'three'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { NebulaParams } from '@/core/renderables/Nebula/NebulaParams'
import { NebulaRaymarchShader } from './NebulaRaymarchShader'
import { threeJS } from '@/core/graphic/ThreeJS'

class NebulaRaymarchMaterial extends AbstractShaderMaterial {
  public constructor(params: NebulaParams) {
    super()
    const { uniforms, vertexShader, fragmentShader, defines } = new NebulaRaymarchShader().toJSON()
    this.uniforms = {
      ...uniforms,
      uInvModelMatrix: new Uniform(new Matrix4()),
      uCameraWorld: new Uniform(new Vector3())
    }
    this.vertexShader = vertexShader
    this.fragmentShader = fragmentShader
    this.defines = defines

    this.transparent = true
    this.depthWrite = false
    this.depthTest = true
    this.blending = AdditiveBlending // premultiplied emission; revisit in Task 10

    this.setUniformsFromParams(params)
  }

  public setUniformsFromParams(params: NebulaParams): void {
    const u = this.uniforms
    u.uMaxSteps.value = params.quality.maxSteps
    u.uShape.value = params.shape === 'disk' ? 1 : 0
    u.uInvAxis.value.set(
      1 / Math.max(1e-4, params.axisRatios.x),
      1 / Math.max(1e-4, params.axisRatios.y),
      1 / Math.max(1e-4, params.axisRatios.z)
    )
    u.uEdgeFalloff.value = params.edgeFalloff
    u.uOctaves.value = params.noise.octaves
    u.uFrequency.value = params.noise.frequency
    u.uLacunarity.value = params.noise.lacunarity
    u.uGain.value = params.noise.gain
    u.uWarpStrength.value = params.noise.warpStrength
    u.uRidged.value = params.noise.ridged
    u.uContrast.value = params.noise.contrast
    u.uEmissiveIntensity.value = params.palette.emissiveIntensity
  }

  public updateMaterial(): void {
    this.uniforms.uTime.value = threeJS.clock.getElapsedTime()
  }

  public resetMaterial(): void {
    this.uniforms.uTime.value = 0
  }
}

export { NebulaRaymarchMaterial }
```

- [ ] **Step 6: Run smoke test + type-check**

Run: `npx vitest run tests/nebula/NebulaRaymarchMaterial.spec.ts` → PASS (2 tests).
Run: `npx tsc -b` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/renderables/Nebula/material tests/nebula/NebulaRaymarchMaterial.spec.ts
git commit -m "feat(nebula): raymarch GLSL chunks, template, shader + material

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: NebulaVolume mesh + Nebula container — first on-scene render

**Files:**
- Create: `src/core/renderables/Nebula/volume/NebulaVolume.ts`
- Create: `src/core/renderables/Nebula/Nebula.ts`
- Create: `src/core/renderables/Nebula/index.ts`
- Test: `tests/nebula/Nebula.construct.spec.ts` (hierarchy smoke)

**Interfaces:**
- Consumes: `NebulaRaymarchMaterial` (Task 8), `NebulaParams` (Task 1), `toThreeJSUnits`.
- Produces:
  - `class NebulaVolume extends Mesh` with `updateObject(delta?)` keeping `uInvModelMatrix`/`uCameraWorld` in sync.
  - `class Nebula extends Object3D` with constructor `(params?: DeepPartial<NebulaParams>)`, public `params: NebulaParams`, `updateObject(delta?)`.
  - `index.ts` re-exports `Nebula`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/nebula/Nebula.construct.spec.ts
import { Mesh } from 'three'
import { Nebula } from '@/core/renderables/Nebula'

describe('Nebula construction', () => {
  it('builds an Object3D hierarchy containing a volume mesh', () => {
    const nebula = new Nebula({ seed: 5, size: 500 })
    expect(nebula.params.seed).toBe(5)
    const meshes = nebula.children.filter((c) => c instanceof Mesh)
    expect(meshes.length).toBeGreaterThanOrEqual(1)
    expect(nebula.children[0].frustumCulled).toBe(false)
  })

  it('updateObject runs without throwing', () => {
    const nebula = new Nebula()
    expect(() => nebula.updateObject(0.016)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/nebula/Nebula.construct.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement NebulaVolume**

```ts
// src/core/renderables/Nebula/volume/NebulaVolume.ts
import { BackSide, BoxGeometry, Mesh } from 'three'
import { NebulaParams } from '@/core/renderables/Nebula/NebulaParams'
import { NebulaRaymarchMaterial } from '@/core/renderables/Nebula/material/NebulaRaymarchMaterial'
import { threeJS } from '@/core/graphic/ThreeJS'

class NebulaVolume extends Mesh {
  declare public material: NebulaRaymarchMaterial

  public constructor(params: NebulaParams) {
    // Unit cube in [-1,1]; scaled to physical size on the container.
    super(new BoxGeometry(2, 2, 2), new NebulaRaymarchMaterial(params))
    this.material.side = BackSide
    this.frustumCulled = false
  }

  public updateObject(delta?: number): void {
    this.material.updateMaterial()
    this.updateWorldMatrix(true, false)
    this.material.uniforms.uInvModelMatrix.value.copy(this.matrixWorld).invert()
    this.material.uniforms.uCameraWorld.value.copy(threeJS.camera.position)
  }
}

export { NebulaVolume }
```

- [ ] **Step 4: Implement Nebula container + index**

```ts
// src/core/renderables/Nebula/Nebula.ts
import { Object3D } from 'three'
import { DeepPartial, NebulaParams, mergeNebulaParams } from '@/core/renderables/Nebula/NebulaParams'
import { NebulaVolume } from '@/core/renderables/Nebula/volume/NebulaVolume'
import { toThreeJSUnits } from '@/core/helpers/scaling'

class Nebula extends Object3D {
  public readonly params: NebulaParams
  private readonly volume: NebulaVolume

  public constructor(params: DeepPartial<NebulaParams> = {}) {
    super()
    this.params = mergeNebulaParams(params)
    this.name = 'Nebula'

    this.volume = new NebulaVolume(this.params)
    this.add(this.volume)

    // size is a half-extent in Three.js units; geometry is the [-1,1] cube.
    const s = toThreeJSUnits(this.params.size)
    this.volume.scale.set(s * this.params.axisRatios.x, s * this.params.axisRatios.y, s * this.params.axisRatios.z)
  }

  public updateObject(delta?: number): void {
    this.volume.updateObject(delta)
  }
}

export { Nebula }
```

```ts
// src/core/renderables/Nebula/index.ts
export { Nebula } from '@/core/renderables/Nebula/Nebula'
```

- [ ] **Step 5: Run test + type-check**

Run: `npx vitest run tests/nebula/Nebula.construct.spec.ts` → PASS (2 tests).
Run: `npx tsc -b` → PASS.

- [ ] **Step 6: MANUAL visual verification (GPU — not unit-testable)**

Temporarily, in `Engine` or a scratch entry point, add:
```ts
import { Nebula } from '@/core/renderables/Nebula'
// inside initialize(), after sceneManager.initialize():
const nebula = new Nebula({ size: 2000, edgeFalloff: 0.4 })
threeJS.scene.add(nebula)
;(this as any)._devNebula = nebula
// inside onFrameRendered(), before postprocessing.render:
;(this as any)._devNebula?.updateObject(delta)
```
Run: `npm run dev`, open the app, fly toward the nebula.
Expected: a soft volumetric blob visible from outside; flying inside fills the view with fog that has internal fbm structure; no hard clipping at the proxy faces; no crash in console.
Record a screenshot for the owner feedback loop. Revert the scratch edit before committing (the `Nebula` is added to the scene graph; for dev iteration the manual `updateObject` call is acceptable per the owner's workflow).

- [ ] **Step 7: Commit**

```bash
git add src/core/renderables/Nebula/volume/NebulaVolume.ts src/core/renderables/Nebula/Nebula.ts src/core/renderables/Nebula/index.ts tests/nebula/Nebula.construct.spec.ts
git commit -m "feat(nebula): NebulaVolume proxy + Nebula container, first render

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Color (palette + secondary channel + dust) and cheap directional light in GLSL

**Files:**
- Create: `src/core/renderables/Nebula/material/shader/chunks/NebulaColor.ts`
- Modify: `src/core/renderables/Nebula/material/shader/raymarch.template.ts`
- Modify: `src/core/renderables/Nebula/material/NebulaRaymarchMaterial.ts`
- Test: extend `tests/nebula/NebulaRaymarchMaterial.spec.ts`

**Interfaces:**
- Produces: GLSL `vec3 nebulaColor(float density, float dust, vec3 viewDir, vec3 toStar)`; new uniforms `uPalette0..3`, `uPaletteT` (vec4 of stop positions), `uSecondaryColor`, `uSecondaryThreshold`, `uDustColor`, `uDustStrength`, `uDustThreshold`, `uScatterStrength`, `uAmbient`, `uStarLocal`, `uHasStar`.
- Consumes: `NebulaParams.palette/dust/lighting`.

- [ ] **Step 1: Extend the smoke test**

```ts
// add to tests/nebula/NebulaRaymarchMaterial.spec.ts
it('uploads palette + dust + light uniforms from params', () => {
  const mat = new NebulaRaymarchMaterial(
    mergeNebulaParams({ dust: { strength: 0.7 }, lighting: { scatterStrength: 0.9 } })
  )
  expect(mat.uniforms.uDustStrength.value).toBe(0.7)
  expect(mat.uniforms.uScatterStrength.value).toBe(0.9)
  expect(mat.uniforms.uPalette0).toBeDefined()
  expect(mat.uniforms.uHasStar.value).toBe(0)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/nebula/NebulaRaymarchMaterial.spec.ts`
Expected: FAIL — `uDustStrength` undefined.

- [ ] **Step 3: Write the color chunk**

```ts
// src/core/renderables/Nebula/material/shader/chunks/NebulaColor.ts
export const nebulaColorChunk = `
  uniform vec3  uPalette0; uniform vec3 uPalette1; uniform vec3 uPalette2; uniform vec3 uPalette3;
  uniform vec4  uPaletteT;
  uniform vec3  uSecondaryColor;
  uniform float uSecondaryThreshold;
  uniform vec3  uDustColor;
  uniform float uDustStrength;
  uniform float uDustThreshold;
  uniform float uScatterStrength;
  uniform float uAmbient;
  uniform vec3  uStarLocal;
  uniform float uHasStar;

  vec3 paletteLookup(float t) {
    vec3 c = uPalette0;
    c = mix(c, uPalette1, smoothstep(uPaletteT.x, uPaletteT.y, t));
    c = mix(c, uPalette2, smoothstep(uPaletteT.y, uPaletteT.z, t));
    c = mix(c, uPalette3, smoothstep(uPaletteT.z, uPaletteT.w, t));
    return c;
  }

  vec3 nebulaColor(float density, float dust, vec3 p, vec3 rd) {
    vec3 base = paletteLookup(density);
    // secondary ionization channel
    float sec = smoothstep(uSecondaryThreshold, 1.0, density);
    base = mix(base, uSecondaryColor, sec * 0.6);
    // cheap directional white scatter
    float light = uAmbient;
    if (uHasStar > 0.5) {
      vec3 toStar = normalize(uStarLocal - p);
      light += uScatterStrength * max(dot(-rd, toStar), 0.0);
    }
    base *= light;
    // dust absorption (darkening)
    float dustAmt = uDustStrength * smoothstep(uDustThreshold, 1.0, dust);
    base = mix(base, uDustColor, dustAmt);
    return base;
  }
`
```

- [ ] **Step 4: Wire chunk + dust into the template**

In `raymarch.template.ts`: import `nebulaColorChunk`; add it after `nebulaDensityChunk` in the fragment; add the new uniforms to the `uniforms` block (with neutral defaults); and in `nebulaDensity` expose a dust sample. Replace the marching color line:

```ts
// add near other chunk imports:
import { nebulaColorChunk } from './chunks/NebulaColor'
```

In the fragment string, inject `${nebulaColorChunk}` after `${nebulaDensityChunk}`. Add a GLSL dust sampler (mirror of CPU `dustMask`) inside `NebulaDensity.ts`:

```glsl
  float nebulaDust(vec3 p) {
    float n = nebFbm(p * 0.9 + vec3(55.5), 3, uLacunarity, uGain);
    return clamp(1.0 - abs(n), 0.0, 1.0);
  }
```

Replace the placeholder accumulation color in the loop:

```glsl
        float dust = nebulaDust(p);
        vec3 c = nebulaColor(d, dust, p, rdLocal) * uEmissiveIntensity;
```

Add these uniforms to the template `uniforms` object:

```ts
    uPalette0: new Uniform(new Color(0x14062b)),
    uPalette1: new Uniform(new Color(0x6a1b9a)),
    uPalette2: new Uniform(new Color(0xff5577)),
    uPalette3: new Uniform(new Color(0xffd9a0)),
    uPaletteT: new Uniform(new Vector4(0, 0.45, 0.8, 1)),
    uSecondaryColor: new Uniform(new Color(0x35d0ff)),
    uSecondaryThreshold: new Uniform(0.6),
    uDustColor: new Uniform(new Color(0x0a0608)),
    uDustStrength: new Uniform(0.6),
    uDustThreshold: new Uniform(0.55),
    uScatterStrength: new Uniform(0.8),
    uAmbient: new Uniform(0.25),
    uStarLocal: new Uniform(new Vector3()),
    uHasStar: new Uniform(0)
```
(Add `Color`, `Vector4` to the three import in the template.)

- [ ] **Step 5: Upload the new uniforms in the material**

Extend `setUniformsFromParams` in `NebulaRaymarchMaterial.ts`:

```ts
    const pal = params.palette
    u.uPalette0.value.copy(pal.stops[0]?.color ?? new Color(0x000000))
    u.uPalette1.value.copy(pal.stops[1]?.color ?? pal.stops[0].color)
    u.uPalette2.value.copy(pal.stops[2]?.color ?? pal.stops[pal.stops.length - 1].color)
    u.uPalette3.value.copy(pal.stops[3]?.color ?? pal.stops[pal.stops.length - 1].color)
    u.uPaletteT.value.set(
      pal.stops[0]?.t ?? 0,
      pal.stops[1]?.t ?? 0.45,
      pal.stops[2]?.t ?? 0.8,
      pal.stops[3]?.t ?? 1
    )
    u.uSecondaryColor.value.copy(pal.secondary)
    u.uSecondaryThreshold.value = pal.secondaryThreshold
    u.uDustColor.value.copy(params.dust.color)
    u.uDustStrength.value = params.dust.strength
    u.uDustThreshold.value = params.dust.threshold
    u.uScatterStrength.value = params.lighting.scatterStrength
    u.uAmbient.value = params.lighting.ambient
    u.uHasStar.value = params.lighting.starPosition ? 1 : 0
```
(Add `Color` import; keep `uStarLocal` updated per-frame in `NebulaVolume.updateObject` by transforming `params.lighting.starPosition` into local space — add that there, guarded by `uHasStar`.)

- [ ] **Step 6: Run smoke test + type-check**

Run: `npx vitest run tests/nebula/NebulaRaymarchMaterial.spec.ts` → PASS (3 tests).
Run: `npx tsc -b` → PASS.

- [ ] **Step 7: MANUAL visual verification**

Re-add the dev scratch nebula (Task 9 step 6), `npm run dev`.
Expected: multichromatic gradient (dark core → magenta → pink → warm), teal ionization tint in dense regions, dark dust lanes, one-sided brightening when `lighting.starPosition` is set. Screenshot for owner.

- [ ] **Step 8: Commit**

```bash
git add src/core/renderables/Nebula/material tests/nebula/NebulaRaymarchMaterial.spec.ts
git commit -m "feat(nebula): palette, secondary channel, dust, directional light

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: Depth integration (soft-intersect with the scene) + lobes/cavities (Worley) in GLSL

**Files:**
- Create: `src/core/renderables/Nebula/material/shader/chunks/NebulaDepth.ts`
- Modify: `raymarch.template.ts`, `NebulaDensity.ts`, `NebulaRaymarchMaterial.ts`, `NebulaVolume.ts`
- (No unit test — GPU; manual verification.)

**Interfaces:**
- Produces: GLSL `float linearizeLogDepth(float fragCoordZ)` and a depth-clamped ray far bound; GLSL lobe array (`uLobeCount`, `uLobeData[]`) and Worley cavity carving via `cellular3d`.
- Consumes: composer depth texture (`tDepth`), `cellular3d` from Task 7.

- [ ] **Step 1: Wire the composer depth texture**

In `Postprocessing.ts`, the `EffectComposer` already has `depthBuffer: true`. Expose the depth texture to nebula materials: add a per-frame hook in `NebulaVolume.updateObject` that reads `postprocessing.composer?.inputBuffer.depthTexture` (the `RenderPass` writes scene depth into the composer input buffer) and assigns it to `uSceneDepth`, plus `uResolution` from `threeJS.renderer.getSize`.

```ts
// in NebulaVolume.updateObject, after camera uniform:
import { postprocessing } from '@/core/graphic/Postprocessing'
import { Vector2 } from 'three'
// ...
const depthTex = postprocessing.composer?.inputBuffer.depthTexture ?? null
this.material.uniforms.uSceneDepth.value = depthTex
this.material.uniforms.uHasSceneDepth.value = depthTex ? 1 : 0
threeJS.renderer.getSize(this.material.uniforms.uResolution.value as Vector2)
```

- [ ] **Step 2: Write the depth chunk**

```ts
// src/core/renderables/Nebula/material/shader/chunks/NebulaDepth.ts
export const nebulaDepthChunk = `
  uniform sampler2D uSceneDepth;
  uniform float uHasSceneDepth;
  uniform vec2  uResolution;
  uniform float uCameraNear;
  uniform float uCameraFar;

  // Reconstruct view-space linear depth from a logarithmic depth buffer.
  // gl_FragDepth for logarithmicDepthBuffer = log2(1.0 + w) / log2(1.0 + far)
  float linearizeLogDepth(float d) {
    float logDepthBufFC = 2.0 / log2(uCameraFar + 1.0);
    float w = exp2(d / (logDepthBufFC * 0.5)) - 1.0; // recovers clip w (~ view -z)
    return w;
  }

  // Returns scene linear distance (view-space) at this fragment, or a large value if none.
  float sceneDepthDistance() {
    if (uHasSceneDepth < 0.5) return 1e20;
    vec2 uv = gl_FragCoord.xy / uResolution;
    float d = texture2D(uSceneDepth, uv).x;
    if (d >= 1.0) return 1e20;
    return linearizeLogDepth(d);
  }
`
```

- [ ] **Step 3: Add lobes + Worley cavities to the density chunk**

Append to `NebulaDensity.ts`:

```glsl
  #define NEB_MAX_LOBES 8
  uniform int   uLobeCount;
  uniform vec4  uLobeData[NEB_MAX_LOBES]; // xyz center, w radius
  uniform float uLobeWeight[NEB_MAX_LOBES];
  uniform int   uCavityCount;
  uniform vec4  uCavityData[NEB_MAX_LOBES]; // xyz center, w radius
  uniform float uCavityStrength[NEB_MAX_LOBES];
  uniform float uWorleyStrength; // carve via cellular walls

  float nebLobes(vec3 p) {
    float extra = 0.0;
    for (int i = 0; i < NEB_MAX_LOBES; i++) {
      if (i >= uLobeCount) break;
      vec3 d = p - uLobeData[i].xyz;
      float r2 = max(1e-4, uLobeData[i].w * uLobeData[i].w);
      extra += uLobeWeight[i] * exp(-dot(d, d) / r2);
    }
    return extra;
  }

  float nebCavities(vec3 p) {
    float carve = 1.0;
    for (int i = 0; i < NEB_MAX_LOBES; i++) {
      if (i >= uCavityCount) break;
      float d = length(p - uCavityData[i].xyz);
      float inside = 1.0 - clamp(d / max(1e-4, uCavityData[i].w), 0.0, 1.0);
      carve *= 1.0 - uCavityStrength[i] * inside;
    }
    // Worley cell walls carve filament structure (low frequency)
    vec2 f = cellular3d(p * 1.7);
    float walls = mix(1.0, smoothstep(0.0, 0.4, f.y - f.x), uWorleyStrength);
    return max(0.0, carve * walls);
  }
```

Update `nebulaDensity` to fold lobes + cavities in (mirrors CPU Task 5):

```glsl
    float d = b * (clamp(base, 0.0, 1.0) + nebLobes(p));
    d *= nebCavities(p);
    d = pow(clamp(d, 0.0, 1.0), uContrast);
    return clamp(d, 0.0, 1.0);
```

- [ ] **Step 4: Clamp ray far bound by scene depth in the marcher**

In the fragment `main` of `raymarch.template.ts`, after computing `tf`, convert the scene depth to a local-space `t` limit and clamp `tf`, and apply soft-intersect by fading density near the limit. Add `${nebulaDepthChunk}` to the fragment includes and the uniforms to the template. Implementer note: convert `sceneDepthDistance()` (view-space distance) into the local ray parameter using the known camera world position and the local-to-world scale; clamp `tf = min(tf, tLimit)` and multiply sample density by `smoothstep(0.0, fadeBand, tLimit - t)`.

- [ ] **Step 5: Upload lobe/cavity/Worley/depth uniforms**

Extend `setUniformsFromParams` to pack `params.lobes`/`params.cavities` into the fixed-size arrays (cap at 8, set counts), set `uWorleyStrength` (new param-derived constant, e.g. from `noise.ridged` or a dedicated default `0.5`), and set `uCameraNear`/`uCameraFar` from `config('camera')`. Add `uSceneDepth`/`uHasSceneDepth`/`uResolution` uniforms (defaults: `null`/`0`/`new Vector2(1,1)`).

- [ ] **Step 6: Type-check + smoke**

Run: `npx tsc -b` → PASS.
Run: `npx vitest run tests/nebula/` → all PASS (construction smoke still green).

- [ ] **Step 7: MANUAL visual verification**

Place the dev nebula overlapping a planet/asteroid cluster. `npm run dev`.
Expected: nebula fog fades softly where it meets solid geometry (no hard intersection seam); does not render in front of objects that are nearer; Worley produces filament/cell-wall structure; multiple lobes form an asymmetric multi-center cloud within a single object. Screenshot for owner.

- [ ] **Step 8: Commit**

```bash
git add src/core/renderables/Nebula/material src/core/renderables/Nebula/volume
git commit -m "feat(nebula): log-depth soft-intersect + lobes + Worley cavities

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: Impostor LOD + baker + crossfade

**Files:**
- Create: `src/core/renderables/Nebula/volume/NebulaImpostor.ts`
- Create: `src/core/renderables/Nebula/volume/ImpostorBaker.ts`
- Create: `src/core/renderables/Nebula/material/NebulaImpostorMaterial.ts`
- Modify: `src/core/renderables/Nebula/Nebula.ts` (LOD switch + crossfade in `updateObject`)
- Test: `tests/nebula/NebulaLOD.spec.ts` (LOD selection logic, pure math)

**Interfaces:**
- Produces:
  - `class ImpostorBaker` with `bake(volume: NebulaVolume): Texture` and `shouldRebake(cameraDir: Vector3, threshold: number): boolean`.
  - `class NebulaImpostor extends Mesh` (camera-facing quad, `NebulaImpostorMaterial`).
  - `function selectLOD(screenRadiusPx: number, forced: NebulaLOD): { mode: 'raymarch' | 'impostor'; blend: number }` — exported pure helper, unit-tested.
- Consumes: Task 9 `NebulaVolume`, Task 1 `NebulaLOD`.

The only unit-testable piece here is `selectLOD` (pure). The baker/billboard are GPU and verified manually.

- [ ] **Step 1: Write the failing test for selectLOD**

```ts
// tests/nebula/NebulaLOD.spec.ts
import { selectLOD } from '@/core/renderables/Nebula/volume/lod'

describe('selectLOD', () => {
  it('uses raymarch when the nebula is large on screen', () => {
    expect(selectLOD(800, 'auto').mode).toBe('raymarch')
  })
  it('uses impostor when small on screen', () => {
    expect(selectLOD(40, 'auto').mode).toBe('impostor')
  })
  it('produces a blended band with hysteresis between thresholds', () => {
    const r = selectLOD(300, 'auto')
    expect(r.blend).toBeGreaterThan(0)
    expect(r.blend).toBeLessThan(1)
  })
  it('respects forced LOD', () => {
    expect(selectLOD(40, 'raymarch').mode).toBe('raymarch')
    expect(selectLOD(800, 'impostor').mode).toBe('impostor')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/nebula/NebulaLOD.spec.ts`
Expected: FAIL — `@/core/renderables/Nebula/volume/lod` not found.

- [ ] **Step 3: Implement the pure LOD helper**

```ts
// src/core/renderables/Nebula/volume/lod.ts
import { NebulaLOD } from '@/core/renderables/Nebula/NebulaParams'

const IMPOSTOR_BELOW = 150 // px screen radius: fully impostor below this
const RAYMARCH_ABOVE = 450 // px: fully raymarch above this

export function selectLOD(
  screenRadiusPx: number,
  forced: NebulaLOD
): { mode: 'raymarch' | 'impostor'; blend: number } {
  if (forced === 'raymarch') return { mode: 'raymarch', blend: 1 }
  if (forced === 'impostor') return { mode: 'impostor', blend: 0 }
  if (screenRadiusPx >= RAYMARCH_ABOVE) return { mode: 'raymarch', blend: 1 }
  if (screenRadiusPx <= IMPOSTOR_BELOW) return { mode: 'impostor', blend: 0 }
  const blend = (screenRadiusPx - IMPOSTOR_BELOW) / (RAYMARCH_ABOVE - IMPOSTOR_BELOW)
  return { mode: blend > 0.5 ? 'raymarch' : 'impostor', blend }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/nebula/NebulaLOD.spec.ts` → PASS (4 tests).

- [ ] **Step 5: Implement baker, impostor mesh, impostor material (GPU)**

```ts
// src/core/renderables/Nebula/volume/ImpostorBaker.ts
import { Texture, Vector3, WebGLRenderTarget } from 'three'
import { NebulaVolume } from '@/core/renderables/Nebula/volume/NebulaVolume'
import { threeJS } from '@/core/graphic/ThreeJS'

class ImpostorBaker {
  private target: WebGLRenderTarget
  private lastDir = new Vector3(0, 0, 1)

  public constructor(resolution: number) {
    this.target = new WebGLRenderTarget(resolution, resolution)
  }

  public shouldRebake(cameraDir: Vector3, thresholdRad: number): boolean {
    return this.lastDir.angleTo(cameraDir) > thresholdRad
  }

  public bake(volume: NebulaVolume, cameraDir: Vector3): Texture {
    // Render the volume alone into the target from the current view direction.
    // (Uses an offscreen camera aimed at the volume; implementer wires a temp Scene.)
    this.lastDir.copy(cameraDir)
    const prevTarget = threeJS.renderer.getRenderTarget()
    threeJS.renderer.setRenderTarget(this.target)
    threeJS.renderer.clear()
    // NOTE: render volume via a temp Scene + ortho camera framing [-1,1] proxy.
    threeJS.renderer.render(volume, threeJS.camera)
    threeJS.renderer.setRenderTarget(prevTarget)
    return this.target.texture
  }
}

export { ImpostorBaker }
```

```ts
// src/core/renderables/Nebula/material/NebulaImpostorMaterial.ts
import { AdditiveBlending, ShaderMaterial, Texture, Uniform } from 'three'

class NebulaImpostorMaterial extends ShaderMaterial {
  public constructor(map: Texture | null) {
    super({
      uniforms: { uMap: new Uniform(map), uOpacity: new Uniform(1) },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexShader: `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D uMap;
        uniform float uOpacity;
        void main() { vec4 c = texture2D(uMap, vUv); gl_FragColor = vec4(c.rgb, c.a) * uOpacity; }
      `
    })
  }
}

export { NebulaImpostorMaterial }
```

```ts
// src/core/renderables/Nebula/volume/NebulaImpostor.ts
import { Mesh, PlaneGeometry } from 'three'
import { NebulaImpostorMaterial } from '@/core/renderables/Nebula/material/NebulaImpostorMaterial'
import { threeJS } from '@/core/graphic/ThreeJS'

class NebulaImpostor extends Mesh {
  declare public material: NebulaImpostorMaterial

  public constructor() {
    super(new PlaneGeometry(2, 2), new NebulaImpostorMaterial(null))
    this.frustumCulled = false
  }

  public updateObject(): void {
    this.quaternion.copy(threeJS.camera.quaternion) // billboard
  }
}

export { NebulaImpostor }
```

- [ ] **Step 6: Wire the LOD switch + crossfade into `Nebula.updateObject`**

In `Nebula.ts`: add a `NebulaImpostor` child and an `ImpostorBaker`; each frame compute the projected screen radius of the proxy (project proxy center + a point at `size` onto the screen, measure pixel distance), call `selectLOD`, set `volume.visible`/`impostor.visible` and the impostor opacity / volume emissive scale from `blend` to crossfade, and rebake when `shouldRebake` and mode involves the impostor. Implementer note: compute screen radius via `threeJS.camera` projection of two world points and `threeJS.renderer.getSize`.

- [ ] **Step 7: Type-check + full test run**

Run: `npx tsc -b` → PASS.
Run: `npx vitest run tests/nebula/` → all PASS.

- [ ] **Step 8: MANUAL visual verification**

Fly far from the nebula and back. `npm run dev`.
Expected: distant nebula renders as a cheap billboard with the baked look; approaching it crossfades into the live raymarch with no visible pop or flicker at the threshold; orbiting at distance rebakes only when the angle change is significant. Screenshot for owner.

- [ ] **Step 9: Commit**

```bash
git add src/core/renderables/Nebula/volume src/core/renderables/Nebula/material/NebulaImpostorMaterial.ts src/core/renderables/Nebula/Nebula.ts tests/nebula/NebulaLOD.spec.ts
git commit -m "feat(nebula): impostor LOD, baker, and raymarch<->impostor crossfade

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 13 (optional, profile-gated): 3D-texture bake of the static field

Deferred until profiling shows the analytic raymarch is the bottleneck on target hardware. When pursued: bake `nebulaDensity` into a `Data3DTexture` (resolution `quality.bakeResolution`) once at construction when `quality.bake3DTexture` is true, and sample it in the marcher instead of evaluating fbm+Worley per step. Guard memory by capping resolution at 256³ and disabling for composites above a lobe budget. Add a `bake` smoke test that asserts the `Data3DTexture` dimensions match `bakeResolution`.

## Task 14 (optional, second iteration): half-resolution raymarch

Deferred per spec §8. When pursued: render the volume into a half-res `WebGLRenderTarget` with a depth-aware upsample pass before compositing into the main scene. Requires restructuring how the nebula pass interleaves with the `postprocessing` composer; treat as its own mini-spec.

---

## Self-Review

**Spec coverage:**
- §2 adaptive LOD → Tasks 9 (raymarch), 12 (impostor + crossfade), 13/14 (optional). ✓
- §2 size parametrization, inside/outside → Task 1 (`size`/`axisRatios`), Task 9 (BackSide proxy works inside & outside). ✓
- §2 self-emissive multichromatic + cheap white light → Task 10. ✓
- §2 static form → no time-evolution of shape; `uTime` only reserved, density is time-independent. ✓
- §2 standalone typed API → Tasks 1, 9 (`new Nebula(params)` → `scene.add`). ✓
- §6 every `NebulaParams` group → Task 1 type + Tasks 8/10/11 uniform upload. ✓
- §7 density layers (boundary/lobes/warp/fbm/Worley/contrast/dust) → CPU Tasks 3–5, GPU Tasks 8/10/11. ✓
- §7 multichromy (palette + secondary), HDR bloom via emissiveIntensity → Task 10. ✓
- §7 dust absorption → Tasks 5 (CPU mask) + 10 (GPU). ✓
- §8 BackSide proxy, local-space march, dithering → Tasks 8–9. ✓
- §8 log-depth soft-intersect → Task 11. ✓
- §8 full-res + dithering now, half-res later → Task 8 (dithering) + Task 14 (deferred). ✓
- §9 testing (NebulaField invariants, params, smoke) → Tasks 1–6, 8–9. ✓
- §5 Worley as shared `cellular3d` with owner gate → Task 7. ✓
- §11 implementation order → Tasks map 1:1 onto the seven spec steps plus the two optional ones. ✓

**Placeholder scan:** Task 6 contains an intentional placeholder (`presetToPartial`) that the step explicitly instructs the implementer to delete in favor of the base-aware `mergeNebulaParams` overload — this is a guided red→green, not a silent gap. Tasks 11/12 contain "implementer note" prose for GPU wiring that cannot be reduced to pre-written pixel-exact GLSL (depth-to-local conversion, screen-radius projection, offscreen bake framing); these are the inherently visual/iterative parts called out in the spec and are verified manually. No "TODO"/"TBD"/"handle edge cases" placeholders remain.

**Type consistency:** `NebulaParams`/`DeepPartial`/`mergeNebulaParams`/`makeDefaultNebulaParams` consistent across Tasks 1, 6, 8–12. `NebulaField` methods (`boundary`/`sampleDensity`/`dustMask`/`noiseField`/`lobeContribution`/`cavityCarve`) consistent across Tasks 3–5. GLSL names (`nebFbm`/`nebDomainWarp`/`nebBoundary`/`nebulaDensity`/`nebulaDust`/`nebulaColor`/`nebLobes`/`nebCavities`/`cellular3d`/`linearizeLogDepth`) consistent across Tasks 7–11. Material API (`setUniformsFromParams`/`updateMaterial`/`resetMaterial`) consistent across Tasks 8, 10, 11. `selectLOD` signature consistent in Task 12.
