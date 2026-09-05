import { afterEach, describe, expect, it } from 'vitest'
import { Texture } from 'three'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { slopeNormalFunctions } from '@/core/materials/shaders/lib/chunks/SlopeNormal'
import { terrainMacroDetailFunctions, terrainMacroDetailUniforms } from '@/core/materials/shaders/lib/chunks/TerrainMacroDetail'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { STEEP_DETAIL_PATHS } from '@/core/terrain/steepDetailPaths'

const frag: string = PlanetShaderTemplate.fragmentShader
const vert: string = PlanetShaderTemplate.vertexShader

describe('Полоса B в затенении: наклон по вершинам, без шума в пикселе', () => {
  it('атрибут и varying под USE_SLOPE в обоих стадиях', () => {
    const gateV = vert.indexOf('#ifdef USE_SLOPE')
    expect(gateV).toBeGreaterThan(-1)
    expect(vert.indexOf('attribute vec2 midTilt;')).toBeGreaterThan(gateV)
    expect(vert).toContain('vMidTilt = midTilt;')
    expect(frag).toContain('varying vec2 vMidTilt;')
  })

  it('перегрузка SlopeNormal складывает добавку с декодированным вектором до наклона нормали', () => {
    expect(slopeNormalFunctions).toContain('vec3 perturbNormalFromSlope(vec3 surfNormal, vec3 east, vec2 uv, vec2 extraSlope, out vec2 slopeOut)')
    const body = slopeNormalFunctions.slice(slopeNormalFunctions.indexOf('vec2 extraSlope, out vec2 slopeOut)'))
    expect(body).toContain('+ extraSlope')
    expect(frag).toContain('perturbNormalFromSlope(nLocal, eastLocal, uv, vMidTilt, terrainSlopeVec)')
  })

  it('macroSlope средней полосы несёт наклон полосы B, а гейт форм склона — только уклон карты', () => {
    expect(frag).toContain('vec2 macroMapSlope = (macroSlopeSample.xy * 255.0 - 128.0) * (uSlopeRange / 127.0);')
    expect(frag).toContain('vec2 macroSlope = macroMapSlope + vMidTilt;')
    // приёмка 3.png: с суммой в гейте террасы читались горизонталями топокарты на
    // холмистых равнинах (на Луне гейт открывался на 10–47 % точек с уклоном карты 0.05–0.2)
    expect(frag).toContain('applyTerrainMacroDetail(nLocal, albedoMul, dirLocal, eastLocal, macroSlope, length(macroMapSlope), macroCavity, uv, length(vViewPosition));')
    const gateFn = terrainMacroDetailFunctions
    expect(gateFn).toContain('float gate = smoothstep(uMacroStructureSlope.x, uMacroStructureSlope.y, gateSlopeLen);')
    expect(gateFn).not.toContain('smoothstep(uMacroStructureSlope.x, uMacroStructureSlope.y, slopeLen)')
  })

  it('наклон изотропного fbm под гейтом uMacroTiltGate; в чанках и шаблоне нет нового шума в пикселе', () => {
    expect(terrainMacroDetailUniforms).toContain('uniform float uMacroTiltGate;')
    expect(terrainMacroDetailFunctions).toContain('uMacroTiltGate * uMacroNormalScale * MACRO_RELIEF_ASPECT * contrast * gradTangent')
    // счётчик вызовов snoiseGrad в исходнике чанка не вырос против арки A:
    // 1 в macroFbm (цикл по октавам) + 1 в streakPlane (вызывается трижды на
    // плоскости трипланара, но тело одно) = 2 текстовых вхождения
    expect((terrainMacroDetailFunctions.match(/snoiseGrad\(/g) ?? []).length).toBe(2)
    // vMidTilt никуда не подаётся как аргумент шума
    expect(frag).not.toMatch(/snoise\w*\([^;]*vMidTilt/)
  })
})

function seedTexture(name: string, width: number = 4, height: number = 2): void {
  const texture = new Texture()
  texture.name = name
  texture.image = { width, height }
  resourceStorage.addTexture(texture)
}

/** Все ключи, по которым материал ходит через getTextureOrMake (плейсхолдер в jsdom падает на canvas). */
function seedFor(actor: Actor): void {
  for (const name of ['', 'default.png', 'night.jpg']) seedTexture(name)
  for (const resource of actor.resources.all()) seedTexture(resource.getAttribute('path') as string)
  for (const path of Object.values(STEEP_DETAIL_PATHS)) seedTexture(path)
}

/** Стаб тела: ручки в renderingObject.data, без ресурсов/атмосферы/колец. */
function stubActor(data: Record<string, unknown>): Actor {
  return {
    renderingObject: { getAttribute: () => ({ emission: 1, ...data }) },
    physicalObject: { getAttribute: () => 0 },
    children: { where: () => ({ first: () => undefined, isNotEmpty: () => false }) },
    resources: {
      where: () => ({ first: () => undefined }),
      all: () => []
    }
  } as unknown as Actor
}

describe('PlanetMaterial: гейт uMacroTiltGate из midbandParamsOf', () => {
  afterEach(() => resourceStorage.deleteAllTextures())

  it('Луна (дефолт midbandStrength=1): гейт наклона fbm выключен — полоса B несёт наклон сама', () => {
    const moon = Actor.find(19)!
    seedFor(moon)
    const material = new PlanetMaterial(moon)
    expect(material.uniforms.uMacroTiltGate.value).toBe(0)
  })

  it('стаб-тело с midbandStrength=0 (полосы B нет): гейт наклона fbm включён — прежний вид', () => {
    seedTexture('', 4, 2)
    seedTexture('default.png', 4, 2)
    seedTexture('night.jpg', 4, 2)
    const material = new PlanetMaterial(stubActor({ midbandStrength: 0 }))
    expect(material.uniforms.uMacroTiltGate.value).toBe(1)
  })
})
