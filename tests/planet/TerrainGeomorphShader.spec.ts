import { describe, expect, it } from 'vitest'
import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { SphereSurfaceShaderTemplate } from '@/core/materials/shaders/lib/SphereSurfaceShaderTemplate'
import { TerrainShaderTemplate } from '@/core/materials/shaders/lib/TerrainShaderTemplate'
import { preprocessGlsl } from '../helpers/glsl'

const vert: string = TerrainShaderTemplate.vertexShader
const sphereVert: string = SphereSurfaceShaderTemplate.vertexShader

/** Индекс объявления имени (attribute/переменная) или -1. */
function declarationAt(src: string, name: string): number {
  const re = new RegExp(`\\b(?:attribute\\s+)?(?:float|vec2|vec3|vec4)\\s+${name}\\b\\s*[;=]`)
  const m = re.exec(src)

  return m ? m.index : -1
}

function firstUseAt(src: string, name: string): number {
  const m = new RegExp(`\\b${name}\\b`).exec(src)

  return m ? m.index : -1
}

const mainBody = (src: string): string => src.slice(src.indexOf('void main()'))

describe('TerrainGeomorph: вершинник рельефа', () => {
  it('позиция морфится смещением к родителю с smoothstep-кривой', () => {
    expect(vert).toContain('float morphT = smoothstep(0.0, 1.0, patchMorph);')
    expect(vert).toContain('vec3 morphedPosition = position + morphDelta * morphT;')
  })

  it('вся геометрия main() идёт от morphedPosition', () => {
    expect(vert).toContain('modelMatrix * vec4(morphedPosition, 1.0)')
    expect(vert).toContain('modelViewMatrix * vec4(morphedPosition, 1.0)')
    expect(vert).toContain('normalize(morphedPosition + patchCenter)')
    expect(vert).toContain('vPosition = morphedPosition;')

    const main = mainBody(vert)
    const lines = main.split('\n').filter(l => /\bposition\b/.test(l.replace(/\/\/.*$/, '')))
    // vDetailPos/vDetailPos2 намеренно от собственной формы патча (position, не morphedPosition):
    // домен детали привязан к собственной форме патча, как до смещения на патч
    expect(lines.map(l => l.trim())).toEqual([
      'vec3 morphedPosition = position + morphDelta * morphT;',
      'vDetailPos = position + detailOrigin;',
      'vDetailPos2 = position + detailOrigin2;'
    ])
    // у сферы морфа нет: та же общая геометрия от немодифицированной позиции
    const sphereLines = mainBody(sphereVert).split('\n').filter(l => /\bposition\b/.test(l.replace(/\/\/.*$/, '')))
    expect(sphereLines.map(l => l.trim())).toEqual(['vec3 morphedPosition = position;'])
    expect(main).not.toContain('vec4(position, 1.0)')
    expect(main).not.toContain('normalize(position + patchCenter)')
    expect(main).not.toContain('vPosition = position;')
  })

  it('атрибуты полосы смешиваются с родительскими', () => {
    expect(vert).toContain('mix(midShade, midShadeParent, morphT)')
    expect(vert).toContain('mix(midTilt, midTiltParent, morphT)')
  })

  const flags = ['USE_SLOPE', 'USE_TERRAIN_MACRO_DETAIL']
  const paths = [
    ['рельеф', vert, true],
    ['сфера', sphereVert, false]
  ] as const

  for (const [path, source, terrain] of paths) for (let mask = 0; mask < 4; mask++) {
    const defines = new Set(flags.filter((_f, i) => mask & (1 << i)))
    const label = `${path}, ${defines.size ? [...defines].join(' + ') : 'без дефайнов'}`

    it(`препроцессор: ${label}`, () => {
      const src = preprocessGlsl(AbstractShader.prepareSource(source), defines)
      const expected: Record<string, boolean> = {
        morphT: terrain,
        morphDelta: terrain,
        patchMorph: terrain,
        midTiltParent: terrain && defines.has('USE_SLOPE'),
        midShadeParent: terrain && defines.has('USE_TERRAIN_MACRO_DETAIL')
      }

      for (const [name, present] of Object.entries(expected)) {
        if (!present) {
          expect(firstUseAt(src, name), name).toBe(-1)
          continue
        }

        const decl = declarationAt(src, name)
        expect(decl, `${name} объявлен`).toBeGreaterThanOrEqual(0)
        expect(decl, `${name}: объявление раньше использования`).toBeLessThanOrEqual(firstUseAt(src, name))
      }

      // morphedPosition объявлен в любом сочетании и до первого использования
      const mp = declarationAt(src, 'morphedPosition')
      expect(mp).toBeGreaterThanOrEqual(0)
      expect(mp).toBeLessThanOrEqual(firstUseAt(src, 'morphedPosition'))
    })
  }
})
