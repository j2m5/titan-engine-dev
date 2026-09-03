import { planetshine, regolithDiffuse } from './brdfMirror'
import { asteroidBrdfFunctions } from '@/core/materials/shaders/lib/chunks/AsteroidBrdf'
import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'
import { InstancedAsteroidShaderTemplate } from '@/core/materials/shaders/lib/InstancedAsteroidShaderTemplate'
import { BillboardAsteroidMaterial } from '@/core/renderables/DetailedRingStreamingSystem/BillboardAsteroidMaterial'
import { ASTEROID_PROFILES } from '@/core/renderables/DetailedRingStreamingSystem/AsteroidProfiles'

describe('Диффуз реголита (зеркало asteroidRegolithDiffuse)', () => {
  it('в лоб без пика даёт 1 при любом lunarMix — калибровка яркости не плывёт', () => {
    for (const mix of [0, 0.5, 1]) {
      // cosPhase = 0: свет сбоку от оси взгляда, пик не срабатывает
      expect(regolithDiffuse(1, 1, 0, mix, 0.3)).toBeCloseTo(1, 6)
    }
  })

  it('lunarMix = 0 — чистый Ламберт', () => {
    expect(regolithDiffuse(0.3, 0.9, 0, 0, 0)).toBeCloseTo(0.3, 12)
  })

  it('Ломмель-Зелигер держит яркость к лимбу: при NdotL = NdotV = 0.2 остаётся 1, Ламберт даёт 0.2', () => {
    expect(regolithDiffuse(0.2, 0.2, 0, 1, 0)).toBeCloseTo(1, 6)
    expect(regolithDiffuse(0.2, 0.2, 0, 0, 0)).toBeCloseTo(0.2, 6)
  })

  it('тёмная сторона остаётся тёмной: NdotL <= 0 → 0', () => {
    expect(regolithDiffuse(-0.2, 0.8, 0, 1, 0.5)).toBe(0)
    expect(regolithDiffuse(0, 0.8, 0, 1, 0.5)).toBe(0)
  })

  it('оппозиционный пик: при нулевой фазе множитель 1 + surge, к 30° сходит на нет', () => {
    expect(regolithDiffuse(1, 1, 1, 0.8, 0.3)).toBeCloseTo(1.3, 6)
    const g30 = regolithDiffuse(1, 1, Math.cos(Math.PI / 6), 0.8, 0.3)
    expect(g30).toBeGreaterThan(1)
    expect(g30).toBeLessThan(1.002)
  })
})

describe('Planetshine (зеркало asteroidPlanetshine)', () => {
  const R = 10

  it('на солнечной стороне планеты фаза полная, на ночной — ноль (умбра гейта не требует)', () => {
    // Камень на оси планета→звезда: видит освещённое полушарие целиком
    expect(planetshine(1, [30, 0, 0], [1, 0, 0], R)).toBeCloseTo((R / 30) ** 2, 9)
    // Камень за планетой от звезды: видит ночное полушарие
    expect(planetshine(1, [-30, 0, 0], [1, 0, 0], R)).toBe(0)
    // Сбоку — половина
    expect(planetshine(1, [0, 0, 30], [1, 0, 0], R)).toBeCloseTo(0.5 * (R / 30) ** 2, 9)
  })

  it('спадает с расстоянием как квадрат углового радиуса', () => {
    const near = planetshine(1, [20, 0, 0], [1, 0, 0], R)
    const far = planetshine(1, [40, 0, 0], [1, 0, 0], R)
    expect(near / far).toBeCloseTo(4, 9)
  })

  it('обёртка N·L по угловому радиусу: грань боком к планете (nDotP = 0) ещё подсвечена', () => {
    const side = planetshine(0, [20, 0, 0], [1, 0, 0], R)
    const facing = planetshine(1, [20, 0, 0], [1, 0, 0], R)
    expect(side).toBeGreaterThan(0)
    expect(side).toBeLessThan(facing)
    // Грань, отвёрнутая сильнее обёртки, — ноль
    expect(planetshine(-0.9, [20, 0, 0], [1, 0, 0], R)).toBe(0)
  })

  it('без планеты (радиус 0) и внутри планеты — ноль', () => {
    expect(planetshine(1, [20, 0, 0], [1, 0, 0], 0)).toBe(0)
    expect(planetshine(1, [5, 0, 0], [1, 0, 0], R)).toBe(0)
  })
})

describe('AsteroidBrdf GLSL: одна модель для L0 и L1', () => {
  it('чанк объявляет обе функции и зарегистрирован для #include', () => {
    expect(asteroidBrdfFunctions).toContain(
      'float asteroidRegolithDiffuse(float NdotL, float NdotV, float cosPhase, float lunarMix, float surge)'
    )
    expect(asteroidBrdfFunctions).toContain(
      'float asteroidPlanetshine(vec3 N, vec3 dirPlanet, vec3 ringPos, vec3 lightDirRing, float planetRadius)'
    )
    // Зеркало формул (см. brdfMirror.ts)
    expect(asteroidBrdfFunctions).toContain('2.0 * nl / max(nl + nv, 1e-4)')
    expect(asteroidBrdfFunctions).toContain('exp(-g / 0.1)')
    expect(asteroidBrdfFunctions).toContain('0.5 * (1.0 + dot(pHat, lightDirRing))')
    expect(AppShaderChunk.asteroidBrdfFunctions).toBe(asteroidBrdfFunctions)
  })

  it('L0: диффуз через реголит, блик гейтится сырым NdotL, planetshine ложится на альбедо', () => {
    const fs = InstancedAsteroidShaderTemplate.fragmentShader
    const vs = InstancedAsteroidShaderTemplate.vertexShader
    expect(fs).toContain('#include <asteroidBrdfFunctions>')
    expect(fs).toContain('asteroidRegolithDiffuse(NdotL, NdotV, cosPhase, uLunarMix, uOppositionSurge)')
    expect(fs).toContain('asteroidPlanetshine(normal, normalize(vPlanetDirView), vRingPos, uDustLightDirRing, uDustPlanetRadius)')
    expect(fs).toContain('uPlanetshineColor * (uPlanetshineStrength * shine')
    // Блик — только на освещённой стороне по сырому косинусу, не по LS-диффузу (тот до 2)
    // direct = тень планеты × самозатенение слоя (см. RingLayerShadow.spec)
    expect(fs).toContain('spec * specColor * max(NdotL, 0.0) * direct')
    // Направление на центр планеты — в view из вершинника (ring-local начало = планета)
    expect(vs).toContain('vPlanetDirView = normalize((modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz - mvPosition.xyz)')
    for (const name of ['uLunarMix', 'uOppositionSurge', 'uPlanetshineColor', 'uPlanetshineStrength']) {
      expect(InstancedAsteroidShaderTemplate.uniforms[name], name).toBeDefined()
    }
  })

  it('L1: тот же диффуз и planetshine, wrap-освещение «0.5 + 0.5» убрано', () => {
    const m = new BillboardAsteroidMaterial()
    const fs = m.fragmentShader
    expect(fs).toContain(asteroidBrdfFunctions)
    expect(fs).toContain('asteroidRegolithDiffuse(NdotL, normal.z, vLightDirView.z, uLunarMix, uOppositionSurge)')
    expect(fs).toContain('asteroidPlanetshine(normal, normalize(vPlanetDirView), vRingPos, uDustLightDirRing, uDustPlanetRadius)')
    expect(fs).not.toContain('NdotL * 0.5 + 0.5')
    expect(fs).not.toContain('(0.3 - uAmbient)')
    for (const name of ['uLunarMix', 'uOppositionSurge', 'uPlanetshineColor', 'uPlanetshineStrength']) {
      expect(m.uniforms[name], name).toBeDefined()
    }
  })

  it('профили несут ручки BRDF в [0, 1]: тёмный реголит ближе к Ломмелю-Зелигеру, металл — к Ламберту', () => {
    for (const p of Object.values(ASTEROID_PROFILES)) {
      expect(p.lunarMix).toBeGreaterThanOrEqual(0)
      expect(p.lunarMix).toBeLessThanOrEqual(1)
      expect(p.oppositionSurge).toBeGreaterThanOrEqual(0)
      expect(p.oppositionSurge).toBeLessThanOrEqual(1)
    }
    expect(ASTEROID_PROFILES.carbonaceous.lunarMix).toBeGreaterThan(ASTEROID_PROFILES.stony.lunarMix)
    expect(ASTEROID_PROFILES.metallic.lunarMix).toBeLessThan(ASTEROID_PROFILES.stony.lunarMix)
  })
})
