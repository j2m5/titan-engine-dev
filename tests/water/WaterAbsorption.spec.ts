import { describe, expect, it } from 'vitest'
import { WaterShaderTemplate } from '@/core/materials/shaders/lib/WaterShaderTemplate'
import { absorptionLayer, waterTransmittance } from '@/core/materials/shaders/lib/chunks/waterOctavesMath'
import { blendedColor, depthLayer, dirFromLatLon, foundationColor, type DepthInputs, type Vec3 } from './waterColorMirror'

const frag: string = WaterShaderTemplate.fragmentShader

/** Ветка `#ifdef USE_WATER_DEPTH` в main(): [тело до #else, тело #else]. */
function depthBranch(): { depth: string; constant: string } {
  const main = frag.indexOf('void main()')
  const open = frag.indexOf('#ifdef USE_WATER_DEPTH', main)
  const elseAt = frag.indexOf('#else', open)
  const endAt = frag.indexOf('#endif', elseAt)

  return { depth: frag.slice(open, elseAt), constant: frag.slice(elseAt, endAt) }
}

/**
 * Мини-препроцессор: #ifdef/#ifndef/#if/#elif/#else/#endif по набору define.
 * Условие #if — только `defined(X)` с && || ! и скобками; прочее считается ложью.
 */
function preprocess(source: string, defines: ReadonlySet<string>): string {
  const evalCondition = (expr: string): boolean => {
    const replaced = expr
      .replace(/defined\s*\(\s*(\w+)\s*\)/g, (_m, name: string) => (defines.has(name) ? '1' : '0'))
      .replace(/defined\s+(\w+)/g, (_m, name: string) => (defines.has(name) ? '1' : '0'))

    if (!/^[01\s&|!()]*$/.test(replaced)) return false

    return Boolean(new Function(`return (${replaced})`)())
  }

  const stack: { parent: boolean; active: boolean; taken: boolean }[] = []
  const out: string[] = []
  const isActive = (): boolean => (stack.length === 0 ? true : stack[stack.length - 1].active)

  for (const line of source.split('\n')) {
    const t = line.trim()
    let m: RegExpMatchArray | null

    if ((m = t.match(/^#ifdef\s+(\w+)/)) || (m = t.match(/^#ifndef\s+(\w+)/)) || (m = t.match(/^#if\s+(.*)$/))) {
      const parent = isActive()
      const cond = t.startsWith('#ifdef') ? defines.has(m[1]) : t.startsWith('#ifndef') ? !defines.has(m[1]) : evalCondition(m[1])
      stack.push({ parent, active: parent && cond, taken: cond })
    } else if ((m = t.match(/^#elif\s+(.*)$/))) {
      const top = stack[stack.length - 1]
      const cond = !top.taken && evalCondition(m[1])
      top.active = top.parent && cond
      top.taken = top.taken || cond
    } else if (t === '#else') {
      const top = stack[stack.length - 1]
      top.active = top.parent && !top.taken
      top.taken = true
    } else if (t.startsWith('#endif')) {
      stack.pop()
    } else if (isActive()) {
      out.push(line)
    }
  }

  return out.join('\n')
}

function count(source: string, needle: string): number {
  return source.split(needle).length - 1
}

describe('WaterShaderTemplate: поглощение по глубине (Бер–Ламберт по каналам)', () => {
  it('ветка USE_WATER_DEPTH — строки ровно из брифа, в порядке зависимостей', () => {
    const { depth } = depthBranch()
    const lines = [
      'float depthA = texture2D(uSlopeMap, uv).a;',
      'float depthMeters = depthA * uWaterDepthRangeMeters;',
      'float muV = max(dot(viewDir, normal), 0.1);',
      'vec3 transmittance = exp(-uWaterAbsorption * depthMeters * (1.0 + 1.0 / muV));',
      'float depthAlpha = 1.0 - dot(transmittance, vec3(0.2126, 0.7152, 0.0722));',
      'vec3 baseColor = min(uWaterColor * (1.0 - transmittance) / max(depthAlpha, 1e-3), vec3(1.0));'
    ]
    let at = -1

    for (const line of lines) {
      const next = depth.indexOf(line)
      expect(next, line).toBeGreaterThan(at)
      at = next
    }
  })

  it('линейный mix глубины и потолок uWaterAlphaDeep·depthA убраны', () => {
    expect(frag).not.toContain('mix(uWaterShallowColor, uWaterColor, depthA)')
    expect(frag).not.toContain('uWaterAlphaDeep * depthA')
  })

  it('μv — по аналитической normal, до ветки волн (не по waveNormal)', () => {
    const muV = frag.indexOf('float muV = max(dot(viewDir, normal), 0.1);')
    expect(muV).toBeGreaterThan(frag.indexOf('vec3 normal = normalize(vNormal);'))
    expect(muV).toBeLessThan(frag.indexOf('vec3 waveNormal'))
  })

  it('константный режим (#else) байт-в-байт прежний', () => {
    expect(depthBranch().constant).toBe(
      [
        '#else',
        '        // Без запечённой глубины (карты нет / тело не готово Task 6) —',
        '        // константный режим: единая непрозрачность, единый глубокий цвет.',
        '        vec3 baseColor = uWaterColor;',
        '        float depthAlpha = uWaterAlphaDeep;',
        '      '
      ].join('\n')
    )
  })

  it('uWaterShallowColor остаётся юниформом', () => {
    expect(frag).toContain('uniform vec3 uWaterShallowColor;')
  })

  const combos: [string, string[]][] = [
    ['ничего', []],
    ['только глубина', ['USE_WATER_DEPTH']],
    ['только волны', ['USE_WATER_WAVES']],
    ['глубина + волны', ['USE_WATER_DEPTH', 'USE_WATER_WAVES']]
  ]

  it.each(combos)('объявления юниформ поглощения: %s — ровно одно при глубине, не больше одного без', (_name, defs) => {
    const src = preprocess(frag, new Set(defs))
    const hasDepth = defs.includes('USE_WATER_DEPTH')

    for (const decl of ['uniform vec3 uWaterAbsorption;', 'uniform float uWaterDepthRangeMeters;']) {
      const n = count(src, decl)

      if (hasDepth) {
        expect(n, decl).toBe(1)
        expect(src.indexOf(decl), decl).toBeLessThan(src.indexOf('void main()'))
      } else {
        expect(n, decl).toBeLessThanOrEqual(1)
      }
    }

    // локальные main() — объявлены не больше одного раза, при глубине ровно один
    for (const local of ['float depthMeters =', 'float muV =', 'vec3 transmittance =', 'vec3 baseColor =', 'float depthAlpha =']) {
      const main = src.slice(src.indexOf('void main()'))
      expect(count(main, local), local).toBe(hasDepth || local.startsWith('vec3 baseColor') || local.startsWith('float depthAlpha') ? 1 : 0)
    }
  })
})

describe('CPU-зеркало поглощения (waterColorMirror.ts)', () => {
  const sigma: Vec3 = [0.45, 0.07, 0.03]
  const deep: Vec3 = [0.043, 0.239, 0.4]
  const normal: Vec3 = dirFromLatLon(0, 0)
  const nadir: Vec3 = normal
  const grazing: Vec3 = dirFromLatLon(0, 84)

  it('depthLayer = absorptionLayer(waterTransmittance(depthA·range, max(N·V, 0.1), σ), C)', () => {
    const depth: DepthInputs = { depthA: 0.03, rangeMeters: 200, absorption: sigma }
    const layer = depthLayer(deep, normal, grazing, depth)
    const muV = Math.max(grazing[0] * normal[0] + grazing[1] * normal[1] + grazing[2] * normal[2], 0.1)
    const expected = absorptionLayer(waterTransmittance(6, muV, [...sigma]), [...deep])

    expect(layer.baseColor).toEqual(expected.color)
    expect(layer.depthAlpha).toBe(expected.alpha)
  })

  it('урез: depthA = 0 ⇒ depthAlpha = 0 (прячет стык)', () => {
    expect(depthLayer(deep, normal, nadir, { depthA: 0, rangeMeters: 200, absorption: sigma }).depthAlpha).toBe(0)
  })

  it('мелководье прозрачнее глубины, скользящий взгляд плотнее надира', () => {
    const shallow = depthLayer(deep, normal, nadir, { depthA: 0.01, rangeMeters: 200, absorption: sigma })
    const deeper = depthLayer(deep, normal, nadir, { depthA: 0.1, rangeMeters: 200, absorption: sigma })
    const slanted = depthLayer(deep, normal, grazing, { depthA: 0.01, rangeMeters: 200, absorption: sigma })

    expect(shallow.depthAlpha).toBeLessThan(deeper.depthAlpha)
    expect(shallow.depthAlpha).toBeLessThan(slanted.depthAlpha)
  })

  it('инвариант владельца: waveFade = 0 ⇒ цвет === фундаменту с поглощением', () => {
    const lightDirs: Vec3[] = [dirFromLatLon(60, 0), dirFromLatLon(-10, 130)]
    const views: Vec3[] = [nadir, grazing, dirFromLatLon(30, -20)]
    let samples = 0

    for (const depthA of [0, 0.004, 0.05, 1]) {
      for (const viewDir of views) {
        for (const lightDir of lightDirs) {
          const depth: DepthInputs = { depthA, rangeMeters: 200, absorption: sigma }
          const base = depthLayer(deep, normal, viewDir, depth).baseColor
          const foundation = foundationColor(base, [0.749, 0.914, 1], normal, viewDir, lightDir, 0.08)
          const blended = blendedColor(
            {
              baseColor: deep,
              fresnelTint: [0.749, 0.914, 1],
              reflectionSample: [0.9, 0.9, 0.95],
              skyColor: [0.6, 0.75, 0.85],
              normal,
              waveNormal: dirFromLatLon(-70, 150),
              viewDir,
              lightDir,
              sunColor: [1, 1, 1],
              nightFloor: 0.08,
              alpha2: 1e-4,
              depth
            },
            0
          )

          expect(blended[0]).toBe(foundation[0])
          expect(blended[1]).toBe(foundation[1])
          expect(blended[2]).toBe(foundation[2])
          samples++
        }
      }
    }

    expect(samples).toBe(24)
  })
})
