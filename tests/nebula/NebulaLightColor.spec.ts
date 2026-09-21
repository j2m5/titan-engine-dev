import { describe, it, expect } from 'vitest'
import { Color } from 'three'
import { Actors, RenderingObjects } from '@storage/database'
import { makeDefaultNebulaParams, mergeNebulaParams } from '@/core/renderables/Nebula/NebulaParams'
import { nebulaParamsFromData, type NebulaRenderingData } from '@/core/renderables/Nebula/NebulaRenderingData'
import { nebulaColorChunk } from '@/core/renderables/Nebula/material/shader/chunks/NebulaColor'
import { createNebulaUniforms } from '@/core/renderables/Nebula/material/shader/raymarch.template'
import { NebulaRaymarchMaterial } from '@/core/renderables/Nebula/material/NebulaRaymarchMaterial'

/** Зеркало световой части nebulaColor для одного канала */
function lit(
  base: [number, number, number],
  ambient: number,
  scatter: number,
  tint: [number, number, number] | null,
  distance: number,
  falloff: number
): [number, number, number] {
  let s: number = scatter

  if (falloff > 0.001) {
    const q: number = distance / falloff
    s /= 1 + q * q
  }

  if (tint === null) return base.map((c: number) => c * (ambient + s)) as [number, number, number]

  const luma: number = 0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2]

  return base.map((c: number, i: number) => c * ambient + tint[i] * luma * s) as [number, number, number]
}

describe('цветной свет — нейтральность дефолта', () => {
  it('движок по умолчанию светит белым и без спада', () => {
    const lighting = makeDefaultNebulaParams().lighting

    expect(lighting.color).toBeNull()
    expect(lighting.falloffRadius).toBe(0)
  })

  it('юниформы стартуют с закрытых гейтов', () => {
    const u = createNebulaUniforms()

    expect(u.uLightTint.value).toBe(0)
    expect(u.uLightFalloff.value).toBe(0)
  })

  it('оба гейта — ветки, а не умножение на ноль', () => {
    expect(nebulaColorChunk).toContain('if (uLightFalloff > 0.001)')
    expect(nebulaColorChunk).toContain('if (uLightTint > 0.5)')
  })

  it('при закрытых гейтах формула тождественна прежней', () => {
    // base * (ambient + scatter): чанк общий на все туманности
    expect(lit([0.3, 0.75, 0.65], 1, 0.4, null, 0.5, 0)).toEqual([0.3 * 1.4, 0.75 * 1.4, 0.65 * 1.4])
  })

  it('ambient-член цветом не красится', () => {
    expect(nebulaColorChunk).toContain('base = base * light + tinted;')
    expect(nebulaColorChunk).not.toMatch(/uAmbient\s*\*\s*uLightColor|uLightColor\s*\*\s*uAmbient/)
  })
})

describe('цветной свет — поведение', () => {
  it('цвет замещает оттенок scatter-члена, а не перемножается с палитрой', () => {
    // Бирюза, умноженная на красно-оранжевый, дала бы бурый
    const [r, g, b] = lit([0.3, 0.75, 0.65], 0, 1, [1, 0.35, 0.1], 0, 0)

    expect(r / g).toBeCloseTo(1 / 0.35, 6)
    expect(g / b).toBeCloseTo(0.35 / 0.1, 6)
  })

  it('яркость отсвета идёт от плотности, а не от цвета света', () => {
    const dim = lit([0.1, 0.1, 0.1], 0, 1, [1, 0.35, 0.1], 0, 0)
    const dense = lit([0.8, 0.8, 0.8], 0, 1, [1, 0.35, 0.1], 0, 0)

    expect(dense[0] / dim[0]).toBeCloseTo(8, 6)
  })

  it('спад вдвое гасит свет на своём радиусе', () => {
    const near = lit([1, 1, 1], 0, 1, null, 0, 0.4)
    const atRadius = lit([1, 1, 1], 0, 1, null, 0.4, 0.4)

    expect(atRadius[0] / near[0]).toBeCloseTo(0.5, 10)
  })
})

describe('цветной свет — слой данных', () => {
  it('hex-строка доезжает цветом, гейт открывается', () => {
    const params = nebulaParamsFromData({ lighting: { starPosition: [0, 0, 0], color: '#ff5a1f', falloffRadius: 0.45 } })
    const material = new NebulaRaymarchMaterial(params)

    expect(params.lighting.color!.getHex()).toBe(new Color('#ff5a1f').getHex())
    expect(params.lighting.falloffRadius).toBe(0.45)
    expect(material.uniforms.uLightTint.value).toBe(1)
    expect(material.uniforms.uLightColor.value.getHex()).toBe(new Color('#ff5a1f').getHex())
    expect(material.uniforms.uLightFalloff.value).toBe(0.45)
  })

  it('отрицательный радиус спада зажимается в ноль', () => {
    expect(mergeNebulaParams({ lighting: { falloffRadius: -1 } }).lighting.falloffRadius).toBe(0)
  })

  it('клон параметров не делит объект цвета с исходником', () => {
    const source = mergeNebulaParams({ lighting: { color: new Color('#ff5a1f') } })
    const copy = mergeNebulaParams(source)

    expect(copy.lighting.color).not.toBe(source.lighting.color)
    expect(copy.lighting.color!.getHex()).toBe(source.lighting.color!.getHex())
  })
})

describe('цветной свет — поставляемые сцены не тронуты', () => {
  it.each(['Helix Nebula', 'Horuset Nebula', 'Ring Nebula', 'MyCn 18'])('%s светит белым', (name: string) => {
    const actor = Actors.find((a) => a.name === name)!
    const data = RenderingObjects.find((r) => r.actorId === actor.id)!.data as NebulaRenderingData
    const lighting = nebulaParamsFromData(data).lighting

    expect(lighting.color).toBeNull()
    expect(lighting.falloffRadius).toBe(0)
  })
})
