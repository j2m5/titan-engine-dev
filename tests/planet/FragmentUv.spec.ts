import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'

describe('FragmentUv: попиксельные UV терраформных тел (полюс без сингулярности вершинной развёртки)', () => {
  const frag: string = PlanetShaderTemplate.fragmentShader
  const vert: string = PlanetShaderTemplate.vertexShader

  it('гейт USE_TERRAIN_UV переключает попиксельный расчёт uv из направления', () => {
    expect(frag).toContain('#ifdef USE_TERRAIN_UV')
  })

  it('конвенция совпадает с CPU-каноном TerrainHeightField.dirToUv: phi = atan(z, -x), u = phi/2π', () => {
    // см. src/core/terrain/TerrainHeightField.ts dirToUv — тот же порядок
    // аргументов atan2/atan и тот же знак у x, иначе шов диффуза разъедется
    // со швом карты высот
    expect(frag).toContain('atan(dirLocal.z, -dirLocal.x)')
  })

  it('широта — acos клампнутой компоненты y направления', () => {
    expect(frag).toContain('acos(clamp(dirLocal.y')
  })

  it('вершинник передаёт body-локальное радиальное направление без матриц', () => {
    expect(vert).toContain('vLocalDir = normal;')
  })

  it('выборки текстур фрагментника переведены на попиксельный uv — vUv остаётся только легаси-присвоением', () => {
    expect(frag).not.toContain('texture2D(diffuseMap, vUv)')
    expect(frag).not.toContain('texture2D(nightMap, vUv)')
    expect(frag).not.toContain('texture2D(cloudMap, vUv)')
    expect(frag).not.toContain('texture2D(specularMap, vUv)')
    expect(frag).not.toContain('perturbNormalFromHeight(normal, vEast, vUv)')
    expect(frag).not.toContain('perturbNormalFromSlope(normal, vEast, vUv)')
    // легаси-ветка (#else) — единственное оставшееся использование vUv
    expect(frag).toContain('vec2 uv = vUv;')
  })
})
