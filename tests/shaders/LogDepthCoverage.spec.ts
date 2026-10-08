import { describe, it, expect } from 'vitest'
import { ShaderChunk } from 'three'
import { StarOuterLayerShaderTemplate } from '@/core/materials/shaders/lib/StarOuterLayerShaderTemplate'
import { BeltPointsShaderTemplate } from '@/core/materials/shaders/lib/BeltPointsShaderTemplate'
import type { ShaderProps } from '@/core/materials/shaders/AbstractShader'

/**
 * Рендерер пишет логарифмическую глубину (config three.logarithmicDepthBuffer).
 * Материал с depthTest без чанков logdepthbuf пишет обычную перспективную
 * глубину ≈ 1.0 при near 1e-6 — и проигрывает тест глубины любому телу
 * независимо от расстояния: протуберанцы перед диском звезды прятались, точки
 * пояса резались планетами позади них.
 */
describe.each([
  ['протуберанцы (StarOuterLayer)', StarOuterLayerShaderTemplate],
  ['точки пояса (BeltPoints)', BeltPointsShaderTemplate]
])('%s: логарифмическая глубина', (_name: string, template: ShaderProps) => {
  it('вершинник объявляет и пишет vFragDepth после gl_Position', () => {
    const vertex: string = template.vertexShader

    expect(vertex).toContain(ShaderChunk.logdepthbuf_pars_vertex)
    // logdepthbuf_vertex зовёт isPerspectiveMatrix из common
    expect(vertex).toContain('bool isPerspectiveMatrix')
    expect(vertex.lastIndexOf(ShaderChunk.logdepthbuf_vertex)).toBeGreaterThan(vertex.lastIndexOf('gl_Position ='))
  })

  it('фрагментник пишет gl_FragDepth', () => {
    expect(template.fragmentShader).toContain(ShaderChunk.logdepthbuf_pars_fragment)
    expect(template.fragmentShader).toContain(ShaderChunk.logdepthbuf_fragment)
  })
})
