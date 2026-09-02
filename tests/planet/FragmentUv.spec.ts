import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { AbstractShader } from '@/core/materials/shaders/AbstractShader'

describe('FragmentUv: попиксельные UV терраформных тел (полюс без сингулярности вершинной развёртки)', () => {
  const frag: string = PlanetShaderTemplate.fragmentShader
  const vert: string = PlanetShaderTemplate.vertexShader
  // Сам расчёт uv из направления вынесен в общий чанк terrainUvFunctions
  // (WaterShaderTemplate переиспользует его же — см. TerrainUv.ts), поэтому
  // конкретные строки формулы живут в РАЗВЁРНУТОМ источнике (#include
  // подставлен), не в сыром шаблоне.
  const resolvedFrag: string = AbstractShader.prepareSource(frag)

  it('гейт USE_TERRAIN_UV переключает попиксельный расчёт uv из направления', () => {
    expect(frag).toContain('#ifdef USE_TERRAIN_UV')
  })

  it('конвенция совпадает с CPU-каноном TerrainHeightField.dirToUv: phi = atan(z, -x), u = phi/2π', () => {
    // см. src/core/terrain/TerrainHeightField.ts dirToUv — тот же порядок
    // аргументов atan2/atan и тот же знак у x, иначе шов диффуза разъедется
    // со швом карты высот
    expect(resolvedFrag).toContain('atan(dirLocal.z, -dirLocal.x)')
  })

  it('широта — acos клампнутой компоненты y направления', () => {
    expect(resolvedFrag).toContain('acos(clamp(dirLocal.y')
  })

  it('вершинник передаёт body-локальное радиальное направление без матриц', () => {
    expect(vert).toContain('vLocalDir = normal;')
  })

  it('выборки текстур фрагментника переведены на попиксельный uv — vUv остаётся только легаси-присвоением', () => {
    expect(frag).not.toContain('texture2D(diffuseMap, vUv)')
    expect(frag).not.toContain('texture2D(nightMap, vUv)')
    expect(frag).not.toContain('texture2D(cloudMap, vUv)')
    expect(frag).not.toContain('texture2D(specularMap, vUv)')
    expect(frag).not.toContain('perturbNormalFromSlope(normal, vEast, vUv)')
    // легаси-ветка (#else) — единственное оставшееся использование vUv
    expect(frag).toContain('vec2 uv = vUv;')
  })

  it('двухдоменный выбор u вместо fract-скачка на шве меридиана', () => {
    // if (u < 0.0) u += 1.0 держал значение непрерывным, но экранная
    // производная u прыгала на ~1 на этой колонке пикселей — GPU брал
    // грубейший мип (полоса мыла). fract даёт разрыв производной каждый
    // на своём меридиане; берём домен с меньшей fwidth в этой точке.
    expect(resolvedFrag).not.toContain('if (u < 0.0) u += 1.0;')
    expect(resolvedFrag).toContain('float u1 = fract(uRaw);')
    expect(resolvedFrag).toContain('float u2 = fract(uRaw + 0.5) - 0.5;')
    expect(resolvedFrag).toContain('float u = fwidth(u1) <= fwidth(u2) ? u1 : u2;')
  })

  it('восток терраформного пути попиксельный из dirLocal — интерполированный varying востока врал у полюса (вертушка TBN)', () => {
    // между соседними вершинами полярного квада азимут varying-востока прыгал
    // на десятки градусов — интерполяция этого не сглаживала. cross с точным
    // попиксельным dirLocal свободен от проблемы; длина по-прежнему
    // ∝ cos(широты) — полюсный гард чанков (len < 1e-4) цел. Сам varying vEast
    // вымер вместе с легаси-путём USE_BUMP.
    expect(frag).toContain('cross(vec3(0.0, 1.0, 0.0), dirLocal)')
    // normalMatrix не биндится во фрагментник three.js автоматически
    expect(frag).toContain('uniform mat3 normalMatrix;')
    expect(frag).not.toContain('vEast')
    // терраформная ветка на локальных аргументах (см. тест ниже)
    expect(frag).toContain('perturbNormalFromSlope(nLocal, eastLocal, uv, terrainSlopeVec)')
  })

  it('терраформная цепочка нормалей локальна: один normalMatrix в конце', () => {
    // локальная база и восток без матриц
    expect(frag).toContain('vec3 nLocal = dirLocal;')
    expect(frag).toContain('vec3 eastLocal = cross(vec3(0.0, 1.0, 0.0), dirLocal);')
    // перturb-слои зовутся с локальными аргументами
    expect(frag).toContain('perturbNormalFromSlope(nLocal, eastLocal, uv, terrainSlopeVec)')
    // финальный переход — один
    expect(frag).toContain('normal = normalize(normalMatrix * nLocal);')
    // старой view-space связки в терраформной ветке нет
    expect(frag).not.toContain('vec3 east = normalMatrix * cross(vec3(0.0, 1.0, 0.0), dirLocal);')
  })

  it('текстурное v — флип картного: dirToUv отдаёт v карты (строка 0 = север), загрузчик флипует изображение (север = v 1)', () => {
    // A/B владельца: старая SphereGeometry сэмплировала нативными uv (v=1
    // на севере, корректно), кубосфера сэмплирует v КАРТЫ напрямую — весь
    // диффуз и slope зеркалились по С-Ю (в точке — рельеф зеркальной
    // широты). CPU-канон dirToUv остаётся в координатах карты (sampleMeters
    // его не трогаем) — флип только на текстурном v фрагментника.
    expect(resolvedFrag).toContain('1.0 - acos(clamp(dirLocal.y')
    expect(resolvedFrag).not.toContain('vec2(u, acos(clamp(')
  })

  // Ревью Task 4 (фикс-раунд 1, №3): константы разворотов в общем чанке
  // terrainUvFunctions не были запиннены — мутация «обменять 2π и π местами»
  // (полностью сломанная развёртка: долгота делится на π, широта на 2π)
  // проходила зелёной, потому что предыдущие ассерты проверяли ТОЛЬКО
  // структуру выражений (наличие atan/acos/деления), не сами делители.
  // Доказано мутацией M2 вручную: временный обмен 6.28318530717958647692 ↔
  // 3.14159265358979323846 в TerrainUv.ts валил этот тест (и водный
  // двойник в WaterMaterial.spec.ts) RED, откат восстанавливал GREEN.
  it('константы разворотов запиннены — 2π у долготы (phi), π у широты (acos) — страж от перепутывания через общий чанк', () => {
    expect(resolvedFrag).toContain('phi / 6.28318530717958647692')
    expect(resolvedFrag).toContain('/ 3.14159265358979323846')
  })
})
