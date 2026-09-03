import { describe, expect, it } from 'vitest'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { terrainDetailFunctions } from '@/core/materials/shaders/lib/chunks/TerrainDetail'

describe('TerrainDetail: домен из точной позиции патча', () => {
  const vert: string = PlanetShaderTemplate.vertexShader
  const frag: string = PlanetShaderTemplate.fragmentShader
  const fn: string = terrainDetailFunctions

  it('вершинник объявляет атрибуты и varying под USE_TERRAIN_DETAIL и передаёт их', () => {
    const gate = vert.indexOf('#ifdef USE_TERRAIN_DETAIL')
    expect(gate).toBeGreaterThan(-1)
    expect(vert).toContain('attribute vec3 detailPos;')
    expect(vert).toContain('attribute vec3 detailPos2;')
    expect(vert).toContain('varying vec3 vDetailPos;')
    expect(vert).toContain('vDetailPos = detailPos;')
    expect(vert).toContain('vDetailPos2 = detailPos2;')
  })

  it('фрагментник зовёт чанк с varying-позициями', () => {
    expect(frag).toContain('varying vec3 vDetailPos;')
    expect(frag).toContain(
      'applyTerrainDetail(nLocal, albedoMul, dirLocal, vDetailPos, vDetailPos2, length(vViewPosition), terrainSlopeTan);'
    )
    expect(frag).not.toContain('applyTerrainDetail(nLocal, albedoMul, dirLocal, length(vViewPosition));')
  })

  it('чанк адресует текстуры позицией, не направлением; мелкий слой — своей позицией', () => {
    expect(fn).toContain('detailPos.zy * uDetailScale')
    expect(fn).toContain('detailPos.xz * uDetailScale')
    expect(fn).toContain('detailPos.xy * uDetailScale')
    // мелкий слой — свой TriplanarUv (uvSmall, от detailPos2/uDetailScale2 —
    // см. triplanarUvFor в applyTerrainDetail, фикс-раунд 2), не сырые p/scale
    expect(fn).toContain('TriplanarUv uvSmall = triplanarUvFor(detailPos2, uDetailScale2);')
    expect(fn).toContain('triplanarNormalDetiled(uDetailNor2Map, uvSmall,')
    expect(fn).not.toContain('dirLocal.zy * uDetailScale')
    expect(fn).not.toContain('uDetailScale2 / max(uDetailScale')
    // веса трипланара — по-прежнему от направления
    expect(fn).toContain('triplanarWeights(dirLocal)')
  })

  it('индекс вариантов W-периодичен: ячейка 4 тайла, хеш решётки по модулю 256, соседи сворачиваются раздельно', () => {
    expect(fn).toContain('8.0 * vnoise(0.25 * (detailPos.zy * uDetailScale')
    expect(fn).not.toContain('vnoise(0.3 *')
    expect(fn).toContain('vec2 i0 = mod(i, 256.0);')
    expect(fn).toContain('vec2 i1 = mod(i + 1.0, 256.0);')
    expect(fn).not.toContain('hash21(i + vec2(1.0, 0.0))')
  })
})
