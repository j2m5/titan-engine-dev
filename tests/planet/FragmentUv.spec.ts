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

  it('двухдоменный выбор u вместо fract-скачка на шве меридиана', () => {
    // if (u < 0.0) u += 1.0 держал значение непрерывным, но экранная
    // производная u прыгала на ~1 на этой колонке пикселей — GPU брал
    // грубейший мип (полоса мыла). fract даёт разрыв производной каждый
    // на своём меридиане; берём домен с меньшей fwidth в этой точке.
    expect(frag).not.toContain('if (u < 0.0) u += 1.0;')
    expect(frag).toContain('float u1 = fract(uRaw);')
    expect(frag).toContain('float u2 = fract(uRaw + 0.5) - 0.5;')
    expect(frag).toContain('float u = fwidth(u1) <= fwidth(u2) ? u1 : u2;')
  })
})
