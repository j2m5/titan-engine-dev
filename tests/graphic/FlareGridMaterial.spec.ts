import { describe, expect, it } from 'vitest'
import { Texture, Vector2 } from 'three'
import { FlareGridMaterial } from '@/core/graphic/effects/lensflare/FlareGridMaterial'
import { FlareSelectMaterial } from '@/core/graphic/effects/lensflare/FlareSelectMaterial'
import { FlareWindowMaterial } from '@/core/graphic/effects/lensflare/FlareWindowMaterial'
import { MAX_CELL_TEXELS, SOURCE_WINDOW_CELLS } from '@/core/graphic/effects/lensflare/flareGrid'

describe('FlareGridMaterial: сбор сетки', () => {
  const frag = new FlareGridMaterial('flux').fragmentShader

  it('предел цикла сбора — константа из TS', () => {
    expect(frag).toContain(`#define MAX_CELL_TEXELS ${MAX_CELL_TEXELS}`)
  })

  it('центр пишет только вариант centroid', () => {
    expect(new FlareGridMaterial('centroid').defines.OUTPUT_CENTROID).toBe('1')
    expect(new FlareGridMaterial('flux').defines.OUTPUT_CENTROID).toBeUndefined()
  })

  it('поток — сумма × площадь текселя в долях кадра²', () => {
    expect(frag).toContain('gl_FragColor = vec4(flux * areaPerTexel, fluxLum * areaPerTexel);')
  })

  it('пустая ячейка не делит на ноль', () => {
    expect(frag).toContain('fluxLum > 0.0 ? moment / fluxLum : vec2(0.0)')
  })

  it('координаты кадра — те же, что frameCoord: ((u − 0.5)·a, v − 0.5)', () => {
    expect(frag).toContain('vec2((uv.x - 0.5) * aspect, uv.y - 0.5)')
  })

  it('границы ячейки — те же, что у зеркала gatherGrid', () => {
    expect(frag).toContain('ivec2 lo = ivec2(floor(vec2(cell) * cellTexels));')
    expect(frag).toContain('ivec2 hi = min(ivec2(floor(vec2(cell + 1) * cellTexels)), ivec2(sourceSize));')
  })

  it('setSize: размеры буфера и сетки, площадь текселя (1/H)²', () => {
    const material = new FlareGridMaterial('flux')
    material.setSize(960, 540, 64, 36)

    expect(material.uniforms.sourceSize.value).toEqual(new Vector2(960, 540))
    expect(material.uniforms.gridSize.value).toEqual(new Vector2(64, 36))
    expect(material.uniforms.areaPerTexel.value).toBeCloseTo(1 / 540 ** 2, 15)
  })
})

describe('FlareSelectMaterial: отбор максимумов', () => {
  const frag = new FlareSelectMaterial('flux', new Texture()).fragmentShader

  it('правило равенства — как в selectMaxima: меньший индекс выигрывает', () => {
    expect(frag).toContain('nf.a > self || (nf.a == self && nIndex < selfIndex)')
  })

  it('выбор требует ненулевого потока — делитель центра не ноль', () => {
    expect(frag).toContain('bool isMax = self > 0.0;')
    expect(frag).toContain('moment / sumFlux.a')
  })

  it('соседи за краем сетки пропускаются', () => {
    expect(frag).toContain('if (n.x < 0 || n.y < 0 || n.x >= grid.x || n.y >= grid.y) continue;')
  })

  it('буфер центров подключается снаружи, вход потока — через ShaderPass', () => {
    const centroids = new Texture()
    const material = new FlareSelectMaterial('centroid', centroids)

    expect(material.uniforms.centroidBuffer.value).toBe(centroids)
    expect(material.uniforms.inputBuffer).toBeDefined()
    expect(material.defines.OUTPUT_CENTROID).toBe('1')
  })

  it('setGrid: размер сетки', () => {
    const material = new FlareSelectMaterial('flux', new Texture())
    material.setGrid(86, 36)

    expect(material.uniforms.gridSize.value).toEqual(new Vector2(86, 36))
  })
})

describe('FlareWindowMaterial: окно источников', () => {
  const frag = new FlareWindowMaterial().fragmentShader

  it('полуширина окна — константа из TS', () => {
    expect(frag).toContain(`#define SOURCE_WINDOW_CELLS ${SOURCE_WINDOW_CELLS}`)
  })

  it('невыбранная ячейка — нули без обхода окна', () => {
    expect(frag).toContain('if (self <= 0.0) {')
    expect(frag).toContain('gl_FragColor = vec4(0.0);')
  })

  it('сумма потоков и их квадратов выбранных ячеек окна, как sourceWindows', () => {
    expect(frag).toContain('flux += f;')
    expect(frag).toContain('fluxSquared += f * f;')
    expect(frag).toContain('gl_FragColor = vec4(flux, fluxSquared, 0.0, 1.0);')
  })

  it('ячейки за краем сетки пропускаются', () => {
    expect(frag).toContain('if (n.x < 0 || n.y < 0 || n.x >= grid.x || n.y >= grid.y) continue;')
  })

  it('setGrid: размер сетки', () => {
    const material = new FlareWindowMaterial()
    material.setGrid(86, 36)

    expect(material.uniforms.gridSize.value).toEqual(new Vector2(86, 36))
  })
})
