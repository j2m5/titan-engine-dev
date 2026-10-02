import { describe, expect, it } from 'vitest'
import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'

const vert: string = PlanetShaderTemplate.vertexShader

/**
 * Мини-препроцессор: #ifdef/#ifndef/#if/#elif/#else/#endif по набору define
 * (как в tests/planet/TerrainNearShadow.spec.ts).
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
    expect(lines.map(l => l.trim())).toEqual(['vec3 morphedPosition = position + morphDelta * morphT;', 'vec3 morphedPosition = position;'])
    expect(main).not.toContain('vec4(position, 1.0)')
    expect(main).not.toContain('normalize(position + patchCenter)')
    expect(main).not.toContain('vPosition = position;')
  })

  it('атрибуты полосы смешиваются с родительскими', () => {
    expect(vert).toContain('mix(midShade, midShadeParent, morphT)')
    expect(vert).toContain('mix(midTilt, midTiltParent, morphT)')
  })

  const flags = ['USE_TERRAIN_UV', 'USE_SLOPE', 'USE_TERRAIN_MACRO_DETAIL']

  for (let mask = 0; mask < 8; mask++) {
    const defines = new Set(flags.filter((_f, i) => mask & (1 << i)))
    const label = defines.size ? [...defines].join(' + ') : 'без дефайнов'

    it(`препроцессор: ${label}`, () => {
      const src = preprocess(AbstractShader.prepareSource(vert), defines)
      const terrain = defines.has('USE_TERRAIN_UV')
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
