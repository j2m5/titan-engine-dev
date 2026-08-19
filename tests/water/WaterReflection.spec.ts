import { describe, expect, it } from 'vitest'
import { CubeTexture, ShaderChunk } from 'three'
import { WaterShaderTemplate } from '@/core/materials/shaders/lib/WaterShaderTemplate'
import { WaterMaterial } from '@/core/renderables/Water/WaterMaterial'
import { WaterShader } from '@/core/materials/shaders/WaterShader'
import { Actor } from '@/core/models/Actor'
import { ZENITH_DARKEN, dirFromLatLon, reflectionSampleBlend, skyColorGradient, type Vec3 } from './waterColorMirror'

// Task 2 (арка water-shader): отражение фоновой кубмапы. Consumes: чанк
// SkyboxSample (createSkyboxSampleUniforms, флип-конвенция uSkyFlipX) — единая
// точка выборки фона (см. её докблок, SkyboxBackground/BlackHole — те же
// потребители); возмущённая нормаль волн Task 1 (waveLocalNormal). Produces:
// USE_WATER_REFLECTION (гейт по факту доставки кубмапы конструктором
// WaterMaterial, СТАТИЧЕН на весь срок жизни материала — не как
// USE_WATER_DEPTH/USE_WATER_WAVES, которые updateMaterial переоценивает
// каждый кадр); reflect в мировых осях; дневной бленд той же формой
// терминатора; дисторсия Water.js; подстановка в albedo вместо тинта.
const frag: string = WaterShaderTemplate.fragmentShader
const vert: string = WaterShaderTemplate.vertexShader

describe('WaterShaderTemplate: отражение — сэмпл ТОЛЬКО через чанк SkyboxSample (ЖЕЛЕЗНЫЙ констрейнт)', () => {
  it('#include <skyboxSampleUniforms>/<skyboxSampleFunctions> — общий чанк, не копия', () => {
    expect(frag).toContain('#include <skyboxSampleUniforms>')
    expect(frag).toContain('#include <skyboxSampleFunctions>')
  })

  it('сэмплирование идёт через sampleSkyboxHdr(...), не raw textureCube/texture(uSkyboxMap, ...)', () => {
    expect(frag).toContain('sampleSkyboxHdr(uSkyboxMap, normalize(reflectDir), uSkyFlipX)')
    expect(frag).not.toContain('textureCube(')
    expect(frag).not.toMatch(/texture\(\s*uSkyboxMap/)
  })

  it('флип-конвенция фона — тот же uSkyFlipX, что у SkyboxBackground/BlackHole (не собственный юниформ)', () => {
    expect(frag).not.toContain('uniform float uSkyFlipX;') // приходит ТОЛЬКО из #include <skyboxSampleUniforms>
    expect(frag).toContain('uSkyFlipX')
  })
})

// Фикс-раунд 1 ревью Task 2, находка №2: первая версия заводила мировой
// varying vWorldPosition = modelMatrix·position — в f32 это ПОЛНАЯ
// гелиоцентрическая координата (Земля на 1 а.е.: ulp ≈ 14 км), а
// cameraPosition-vWorldPosition — катастрофическое сокращение (вплоть до
// нулевого вектора). Фикс: мировые НАПРАВЛЕНИЯ получаются поворотом уже
// RTC-безопасных view-space величин (viewDir/waveDist, camera-relative), а
// не переносом полноразрядных мировых координат — vWorldPosition убран
// целиком, вершинник вернулся к безусловному виду Task 1 (см. паритетный
// тест ниже — байт-в-байт, не только «без гейта»).
describe('WaterShaderTemplate: отражение — мировые оси БЕЗ мировых координат на GPU (находка №2)', () => {
  it('нормаль — поворот mat3(modelMatrix) body-локальной возмущённой нормали', () => {
    expect(frag).toContain('vec3 worldNormal = normalize(mat3(modelMatrix) * waveLocalNormal);')
  })

  it('взгляд — уже RTC-безопасный view-space viewDir, повёрнутый в мир transpose(mat3(viewMatrix)), НЕ вычитание мировых координат', () => {
    expect(frag).toContain('vec3 worldViewDir = transpose(mat3(viewMatrix)) * viewDir;')
    expect(frag).not.toContain('cameraPosition')
  })

  it('vWorldPosition убран целиком — ни в вершиннике, ни во фрагментнике (RTC-опасный полноразрядный мировой varying)', () => {
    expect(vert).not.toContain('vWorldPosition')
    expect(frag).not.toContain('vWorldPosition')
  })

  it('modelMatrix объявлен явно во фрагментнике (three не биндит его туда автоматически, в отличие от вершинника); viewMatrix — билдин three, без явного объявления', () => {
    expect(frag).toContain('uniform mat4 modelMatrix;')
    expect(frag).not.toContain('uniform mat4 viewMatrix;')
  })
})

// Фикс-раунд 1 ревью Task 2, находка №1: Water.js писал дисторсию для сцены
// В МЕТРАХ (0.001 + 1/distance), у нас 1 юнит сцены ≈ 1995 км — без перевода
// добавка была на 4-5 порядков больше единичного reflectDir, normalize()
// переставал зависеть от взгляда («чужое небо»). Находка №3: worldNormal.xy
// — не аналог тангенциального surfaceNormal.xz Water.js (несёт саму
// радиальную ось, сила искажения гуляла бы по долготе) — фикс: тангенциальная
// проекция (dev), не сырой .xy среза мировой нормали.
describe('WaterShaderTemplate: дисторсия Water.js — единицы метры (находка №1), тангенциальная проекция (находка №3)', () => {
  it('dist переведён в метры ДО деления (waveDist * WATER_METERS_PER_UNIT, не сырой юнит сцены)', () => {
    expect(frag).toContain('float distMeters = waveDist * WATER_METERS_PER_UNIT;')
    expect(frag).toContain('const float WATER_METERS_PER_UNIT = ')
  })

  it('гард на dist=0: max(distMeters, 1e-6) — деление на дистанцию не голое (несогласованность прежней версии устранена)', () => {
    expect(frag).toContain('reflectDir += worldDev * (0.001 + 1.0 / max(distMeters, 1e-6)) * uWaterDistortion;')
  })

  it('дисторсия — тангенциальная проекция waveLocalNormal на плоскость к waveDirLocal (dev), не worldNormal.xy', () => {
    expect(frag).toContain(
      'vec3 dev = waveLocalNormal - waveDirLocal * dot(waveLocalNormal, waveDirLocal);'
    )
    expect(frag).toContain('vec3 worldDev = mat3(modelMatrix) * dev;')
    expect(frag).not.toContain('worldNormal.xy')
    expect(frag).not.toContain('reflectDir.xy')
  })

  it('reflect() — дословная форма Water.js (reflect(-view, normal)), полный 3D-вектор дисторсии, не срез .xy', () => {
    expect(frag).toContain('vec3 reflectDir = reflect(-worldViewDir, worldNormal);')
  })

  it('ручка uWaterDistortion объявлена, не зашитый литерал', () => {
    expect(frag).toContain('uniform float uWaterDistortion;')
  })
})

describe('WaterShaderTemplate: дневной бленд отражения — та же форма терминатора, что ночной пол waves-цвета', () => {
  // Приёмочный фикс (владелец: молочный океан/яркое пятно/гало из космоса,
  // см. WaterWaves.spec.ts describe «CPU-зеркало цвета») развёл терминатор
  // на ДВЕ переменные — NdotL фундамента (normal) и waveNdotL waves-ветки
  // (waveNormal) — дневной бленд отражения ПЕРЕИСПОЛЬЗУЕТ waveDayFactor
  // (посчитан один раз в начале блока USE_WATER_WAVES, до сэмпла отражения
  // И до собственного ночного пола waves-цвета) — своего smoothstep-вызова
  // и своих NdotL/lightDirection здесь больше не заводит (было третье
  // место до фикса, теперь ровно два — см. WaterWaves.spec.ts).
  it('reflection = mix(skySample, skyColor, waveDayFactor) — ночь честный skySample, день градиентное небо', () => {
    expect(frag).toContain('vec3 skySample = sampleSkyboxHdr(uSkyboxMap, normalize(reflectDir), uSkyFlipX);')
    expect(frag).toContain('waveReflectionSample = mix(skySample, skyColor, waveDayFactor);')
  })

  it('дневной бленд НЕ заводит собственных NdotL/lightDirection/dayFactor внутри блока { } — переиспользует внешний waveDayFactor', () => {
    expect(frag).not.toContain('waveReflectionSample = mix(skySample, uWaterFresnelTint, dayFactor);')
    expect(frag).not.toContain('waveReflectionSample = mix(skySample, uWaterFresnelTint, waveDayFactor);') // приёмочная волна 2, №1 — плоский тинт больше не источник дневного неба

    // vViewLightDirection считывается РОВНО один раз во всём фрагментнике
    // (фундаментный блок) — реориентационный блок отражения раньше заводил
    // второй такой же вызов внутри { }, теперь переиспользует lightDirection
    // фундамента через уже посчитанный waveDayFactor.
    const lightDirectionDeclarations = frag.match(/vec3 lightDirection = normalize\(vViewLightDirection\);/g) ?? []

    expect(lightDirectionDeclarations.length).toBe(1)
  })
})

// Приёмочная волна 2, №1 (владелец, скрин на подлёте): дневное "небо" было
// плоским uWaterFresnelTint на всю полусферу — при скользящем взгляде
// waveReflectance→1 и albedo≈0.1+reflection·0.9 читались одним сплошным
// светлым цветом по всему видимому диску («молоко»), не посветлением к
// горизонту, как у настоящего неба. Фикс — градиент по высоте отражённого
// луча относительно зенита ФРАГМЕНТА (waveDirLocal, аналитический dir̂, не
// возмущённая волнами нормаль).
describe('WaterShaderTemplate: дневное небо — градиент зенит/горизонт (приёмочная волна 2, №1)', () => {
  it('зенит фрагмента — waveDirLocal (аналитический dir̂), НЕ waveLocalNormal (возмущённая волнами)', () => {
    expect(frag).toContain('vec3 worldZenith = normalize(mat3(modelMatrix) * waveDirLocal);')
  })

  it('upFactor — dot(отражённый луч, зенит), зажат в [0,1]', () => {
    expect(frag).toContain('float upFactor = clamp(dot(normalize(reflectDir), worldZenith), 0.0, 1.0);')
  })

  it('skyColor = mix(горизонт=tint, зенит=tint·ZENITH_DARKEN, upFactor) — горизонт светлее зенита', () => {
    expect(frag).toContain('vec3 skyColor = mix(uWaterFresnelTint, uWaterFresnelTint * ZENITH_DARKEN, upFactor);')
  })

  it('ZENITH_DARKEN — константа (~0.35), НЕ юниформ-ручка (YAGNI, владелец явно просил не плодить ручки)', () => {
    expect(frag).toContain('const float ZENITH_DARKEN = 0.35;')
    expect(frag).not.toContain('uniform float uZenithDarken')
    expect(frag).not.toContain('uniform float uWaterZenithDarken')
  })

  it('ночная сторона НЕ тронута — skySample кубмапы по-прежнему честный (без зенитного затемнения)', () => {
    // skyColor участвует ТОЛЬКО в дневной половине mix(skySample, skyColor,
    // waveDayFactor) — сам skySample (ночь) вычисляется до skyColor и от
    // него не зависит.
    const skySampleLine = frag.indexOf('vec3 skySample = sampleSkyboxHdr(')
    const skyColorLine = frag.indexOf('vec3 skyColor = mix(')

    expect(skySampleLine).toBeGreaterThan(-1)
    expect(skyColorLine).toBeGreaterThan(skySampleLine)
  })
})

// CPU-зеркало (waterColorMirror.ts) — численный порт skyColorGradient/
// reflectionSampleBlend, тот же класс стража, что остальные CPU-зеркала.
describe('CPU-зеркало skyColorGradient: зенит темнее горизонта, ночь не тронута', () => {
  const tint: Vec3 = [0x87 / 255, 0xb8 / 255, 0xd8 / 255] // DEFAULT_WATER_FRESNEL_TINT
  const zenith = dirFromLatLon(90, 0) // зенит "вверх"

  it('луч в зенит (upFactor=1) — tint·ZENITH_DARKEN', () => {
    const sky = skyColorGradient(tint, zenith, zenith)

    expect(sky[0]).toBeCloseTo(tint[0] * ZENITH_DARKEN, 12)
    expect(sky[1]).toBeCloseTo(tint[1] * ZENITH_DARKEN, 12)
    expect(sky[2]).toBeCloseTo(tint[2] * ZENITH_DARKEN, 12)
  })

  it('луч к горизонту (upFactor=0, reflectDir перпендикулярен зениту) — tint как есть, без затемнения', () => {
    const horizonRay = dirFromLatLon(0, 0) // перпендикулярен zenith=(0,1,0)

    const sky = skyColorGradient(tint, horizonRay, zenith)

    expect(sky[0]).toBeCloseTo(tint[0], 12)
    expect(sky[1]).toBeCloseTo(tint[1], 12)
    expect(sky[2]).toBeCloseTo(tint[2], 12)
  })

  it('луч НИЖЕ горизонта (dot<0) — upFactor зажат в 0, не даёт "перезасветку" за пределами tint', () => {
    const belowHorizon = scaleForTest(zenith, -1)

    const sky = skyColorGradient(tint, belowHorizon, zenith)

    expect(sky[0]).toBeCloseTo(tint[0], 12)
    expect(sky[1]).toBeCloseTo(tint[1], 12)
    expect(sky[2]).toBeCloseTo(tint[2], 12)
  })

  it('зенит СТРОГО темнее горизонта (ZENITH_DARKEN < 1, не косметика)', () => {
    expect(ZENITH_DARKEN).toBeLessThan(1)
    expect(ZENITH_DARKEN).toBeGreaterThan(0)
  })

  it('ночь (waveDayFactor=0) игнорирует skyColor целиком — reflectionSampleBlend === skySample', () => {
    const skySample: Vec3 = [0.02, 0.02, 0.05] // тёмное звёздное небо
    const blended = reflectionSampleBlend(skySample, tint, zenith, zenith, 0)

    expect(blended).toEqual(skySample)
  })

  it('полный день (waveDayFactor=1) игнорирует skySample целиком — reflectionSampleBlend === skyColorGradient', () => {
    const skySample: Vec3 = [0.02, 0.02, 0.05]
    const expected = skyColorGradient(tint, zenith, zenith)
    const blended = reflectionSampleBlend(skySample, tint, zenith, zenith, 1)

    expect(blended[0]).toBeCloseTo(expected[0], 12)
    expect(blended[1]).toBeCloseTo(expected[1], 12)
    expect(blended[2]).toBeCloseTo(expected[2], 12)
  })
})

function scaleForTest(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s]
}

describe('WaterShaderTemplate: гейт USE_WATER_REFLECTION — вложен в USE_WATER_WAVES дважды (декларации + main)', () => {
  it('ровно два вхождения #ifdef USE_WATER_REFLECTION (блок деклараций, блок потребления в main)', () => {
    const matches = frag.match(/#ifdef USE_WATER_REFLECTION/g) ?? []

    expect(matches.length).toBe(2)
  })

  it('подстановка идёт вместо тинта Task 1: vec3 waveReflectionSample = uWaterFresnelTint; остаётся дефолтом ДО гейта', () => {
    expect(frag).toContain('vec3 waveReflectionSample = uWaterFresnelTint;')
  })
})

// Балансирующий line-based парсер (дубликат WaterWaves.spec.ts, тот же
// приём, ниже приведено обоснование в исходном файле): non-greedy regex
// останавливался бы на ПЕРВОМ #endif, а USE_WATER_REFLECTION вложен внутрь
// USE_WATER_WAVES — нужен парсер, считающий глубину любого #ifdef/#endif.
// Контракт ограничен (находка ревью фикс-раунда 1 №6, честно, не молчание):
// считает только `#ifdef`/`#ifndef` как открывающие директивы, `#endif`
// строгим построчным равенством после trim() — `#if`/`#elif`/`#endif` с
// хвостовым комментарием на той же строке НЕ распознаются и сломают баланс.
// В этом файле (и в WaterShaderTemplate.ts) такие формы не используются —
// латентная мина для будущего guard'а, не текущий баг.
function stripGuardedBlock(source: string, guard: string): string {
  const lines = source.split('\n')
  const result: string[] = []
  let depth = 0

  for (const line of lines) {
    const trimmed = line.trim()

    if (depth === 0) {
      if (trimmed === `#ifdef ${guard}`) {
        depth = 1
        continue
      }
      result.push(line)
      continue
    }

    if (trimmed.startsWith('#ifdef ') || trimmed.startsWith('#ifndef ')) {
      depth++
    } else if (trimmed === '#endif') {
      depth--
    }
  }

  return result.join('\n')
}

function normalizeBlankLines(source: string): string {
  return source.replace(/\n[ \t]*\n(?:[ \t]*\n)*/g, '\n\n').trim()
}

// Снимок Task 1 (фрагментник ДО Task 2, коммит b002690) — та же конструкция
// (${ShaderChunk[...]} — реальная интерполяция шаблонной строки JS в
// исходники three.js, НЕ ручная транскрипция чанка), что BASELINE_FRAGMENT_SHADER
// в WaterWaves.spec.ts: копия ровно того, что было в WaterShaderTemplate.ts
// до правок Task 2, символ в символ.
const BASELINE_FRAGMENT_SHADER = `
    precision highp float;

    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_fragment']}

    uniform sampler2D uSlopeMap;
    uniform vec3 uWaterColor;
    uniform vec3 uWaterShallowColor;
    uniform float uWaterAlphaDeep;
    uniform vec3 uWaterFresnelTint;
    uniform float uWaterNightFloor;

    varying vec3 vNormal;
    varying vec3 vViewLightDirection;
    varying vec3 vViewPosition;
    varying vec3 vLocalDir;

    #ifdef USE_WATER_DEPTH
      #include <terrainUvFunctions>
    #endif

    void main() {
      ${ShaderChunk['logdepthbuf_fragment']}

      vec3 normal = normalize(vNormal);
      vec3 viewDir = normalize(vViewPosition);

      #ifdef USE_WATER_DEPTH
        // Мелководье из канала A slope-карты — запечённая глубина воды,
        // декод НАПРЯМУЮ [0,1] (см. scripts/lib/slopeMapEncode.ts, Task 1):
        // 0 на урезе (мелко/берег), 1 на насыщении shallowRangeMeters от
        // уровня. В отличие от R/G (уклон) и B (cavity) канал A без
        // множителя и без знаковой перекодировки — сырое значение текселя.
        vec3 dirLocal = normalize(vLocalDir);
        vec2 uv = terrainUv(dirLocal);
        float depthA = texture2D(uSlopeMap, uv).a;
        vec3 baseColor = mix(uWaterShallowColor, uWaterColor, depthA);
        // Альфа → 0 на урезе: закрывает z-fighting стыка воды и берега без
        // масок (см. WaterMaterial докблок depthWrite=false).
        float alpha = uWaterAlphaDeep * depthA;
      #else
        // Без запечённой глубины (карты нет / тело не готово Task 6) —
        // константный режим: единая непрозрачность, единый глубокий цвет.
        vec3 baseColor = uWaterColor;
        float alpha = uWaterAlphaDeep;
      #endif

      // Френель Шлика-класса: грань тела светлеет к тинту — грубая замена
      // честному отражению неба/окружения, которого у Task 4 («базовый вид»)
      // ещё нет. Показатель 5 — классический ход Шлика при F0≈0.
      float fresnel = pow(1.0 - max(dot(viewDir, normal), 0.0), 5.0);
      vec3 color = mix(baseColor, uWaterFresnelTint, fresnel);

      // Ночная сторона темнее, не чёрная: вода не светится сама, но полный
      // ноль на терминаторе неправдоподобен (рассеянный свет неба/атмосферы).
      // Терминатор — та же зона, что у PlanetShaderTemplate (эстетическая
      // консистентность суши/воды); ночной пол — ручка uWaterNightFloor
      // (дефолт 0.08, честно помеченный), приёмка вида — за владельцем.
      vec3 lightDirection = normalize(vViewLightDirection);
      float NdotL = dot(normal, lightDirection);
      float dayFactor = smoothstep(-0.08, 0.25, NdotL);
      color *= mix(uWaterNightFloor, 1.0, dayFactor);

      gl_FragColor = vec4(color, alpha);

      ${ShaderChunk['tonemapping_fragment']}
      ${ShaderChunk['colorspace_fragment']}
    }
  `

describe('Паритет: без USE_WATER_REFLECTION компилируемый фрагментник бит-в-бит Task 1 (без волн вовсе)', () => {
  it('вырезав USE_WATER_WAVES (значит, и вложенный в него USE_WATER_REFLECTION), получаем ровно снимок ДО Task 1', () => {
    // Тот же снимок, что и WaterWaves.spec.ts (общий baseline двух арок):
    // отсутствие USE_WATER_WAVES автоматически означает отсутствие
    // USE_WATER_REFLECTION (вложен внутрь) — тестируется здесь для полноты
    // паритетного контракта Task 2, не дублирует, а подтверждает вложенность.
    const stripped = stripGuardedBlock(frag, 'USE_WATER_WAVES')

    expect(normalizeBlankLines(stripped)).toBe(normalizeBlankLines(BASELINE_FRAGMENT_SHADER))
  })

  // Находка ревью фикс-раунда 1 №4 (блайндспот): мутация «закрыть гейт
  // USE_WATER_REFLECTION ДО #include» (переместить оба #include за #endif,
  // сделав их безусловными) проходила прежний набор из пяти toContain/
  // not.toContain — ни один из них не завязан именно на чанк. Добавлены
  // отдельные утверждения на #include/sampleSkyboxHdr — RED на этой мутации
  // подтверждён вручную (см. task-2-report.md, раздел находки №4).
  it('вырезав ТОЛЬКО USE_WATER_REFLECTION (волны остаются) — reflection = тинт Task 1 (waveReflectionSample), без skySample/дневного бленда/чанка', () => {
    const stripped = stripGuardedBlock(frag, 'USE_WATER_REFLECTION')

    expect(stripped).toContain('vec3 waveReflectionSample = uWaterFresnelTint;')
    expect(stripped).not.toContain('skySample')
    expect(stripped).not.toContain('uSkyboxMap')
    expect(stripped).not.toContain('worldNormal')
    expect(stripped).not.toContain('#include <skyboxSample')
    expect(stripped).not.toContain('sampleSkyboxHdr')
    // Остальная структура волновой ветки Task 1 не тронута (albedo-mix цел)
    expect(stripped).toContain('color = mix(')
    expect(stripped).toContain('waterSunColor * waveDiffuseLight * 0.3 + waveScatter,')
  })
})

// Находка ревью фикс-раунда 1 №5: закрыта устранением vWorldPosition (№2) —
// вершинник больше НЕ несёт ни одной строки Task 2 ни в каком режиме, класс
// «безусловная правка вершинника проскакивает мимо паритетных тестов»
// закрыт структурно (нечего страховать stripGuardedBlock'ом — снимать
// нечего), но страж по образцу фрагментного всё равно заведён явно, чтобы
// будущая правка вершинника не проскочила молча.
const BASELINE_VERTEX_SHADER = `
    precision highp float;

    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_vertex']}

    uniform vec3 lightPosition;

    varying vec3 vNormal;
    varying vec3 vViewLightDirection;
    varying vec3 vViewPosition;
    varying vec3 vLocalDir;

    void main() {
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mvPosition;

      vec4 viewLightDirection = viewMatrix * vec4(lightPosition, 1.0);

      vNormal = normalize(normalMatrix * normal);
      // Нормаль воды = dir̂ (аналитическая, не из карты): патчи водной
      // оболочки строит тот же writeTerrainPatchAttributes, что и рельеф —
      // атрибут normal радиален всегда (см. terrainPatchGeometry.ts), волн
      // и мелкой пертурбации у Task 4 нет. vNormal — уже готовый view-space
      // dir̂ для Френеля во фрагментнике.
      //
      // Body-локальное радиальное направление — отдельно, для терраформного
      // UV (канал A той же slope-карты, что и суша): та же конвенция vLocalDir,
      // что у PlanetShaderTemplate — без нормали, без матриц, только normal.
      vLocalDir = normal;
      vViewLightDirection = normalize(viewLightDirection.xyz - mvPosition.xyz);
      vViewPosition = -mvPosition.xyz;

      ${ShaderChunk['logdepthbuf_vertex']}
    }
  `

describe('Паритет вершинника: байт-в-байт Task 1 БЕЗУСЛОВНО (находка ревью фикс-раунда 1 №5)', () => {
  it('vertexShader равен снимку Task 1 без всякого strip — Task 2 не добавила вершиннику ни единого символа', () => {
    expect(normalizeBlankLines(vert)).toBe(normalizeBlankLines(BASELINE_VERTEX_SHADER))
  })
})

describe('WaterShader: uWaterDistortion — ручка дисторсии отражения (дефолт 20)', () => {
  function stubActor(data: Record<string, unknown> = {}): Actor {
    return {
      renderingObject: { getAttribute: () => data },
      resources: { where: () => ({ first: () => undefined }) },
      physicalObject: { getAttribute: () => 6360 }
    } as unknown as Actor
  }

  it('дефолт (ручки нет) = 20', () => {
    const shader = new WaterShader(stubActor())

    expect(shader.uniforms.uWaterDistortion.value).toBe(20)
  })

  it('ручка waterDistortion перекрывает дефолт', () => {
    const shader = new WaterShader(stubActor({ waterDistortion: 7.5 }))

    expect(shader.uniforms.uWaterDistortion.value).toBe(7.5)
  })
})

// Проводка кубмапы + гейт USE_WATER_REFLECTION — WaterMaterial, не WaterShader
// (текстура доставляется конструктором материала, не CPU-путём "data", см. её
// докблок). stubActor — тот же образец, что WaterMaterial.spec.ts.
describe('WaterMaterial: доставка кубмапы фона + гейт USE_WATER_REFLECTION (арка water-shader, Task 2)', () => {
  function stubActor(): Actor {
    return {
      renderingObject: { getAttribute: () => ({}) },
      resources: { where: () => ({ first: () => undefined }) },
      physicalObject: { getAttribute: () => 6360 }
    } as unknown as Actor
  }

  it('без кубмапы (аргумент не передан) — гейт не ставится, сэмплер null (обратная совместимость вызовов Task 1)', () => {
    const material = new WaterMaterial(stubActor())

    expect(material.defines.USE_WATER_REFLECTION).toBeUndefined()
    expect(material.uniforms.uSkyboxMap.value).toBeNull()
  })

  it('без кубмапы (явный null) — тот же результат', () => {
    const material = new WaterMaterial(stubActor(), null)

    expect(material.defines.USE_WATER_REFLECTION).toBeUndefined()
    expect(material.uniforms.uSkyboxMap.value).toBeNull()
  })

  it('кубмапа доставлена конструктором — гейт ставится сразу, сэмплер получает ЭТУ ЖЕ текстуру', () => {
    const texture = new CubeTexture()
    const material = new WaterMaterial(stubActor(), texture)

    expect(material.defines.USE_WATER_REFLECTION).toBe('1')
    expect(material.uniforms.uSkyboxMap.value).toBe(texture)
  })

  it('гейт СТАТИЧЕН: updateMaterial() (гоняющий USE_WATER_DEPTH/USE_WATER_WAVES) его не трогает', () => {
    const texture = new CubeTexture()
    const material = new WaterMaterial(stubActor(), texture)

    material.updateMaterial()
    material.updateMaterial(1000)

    expect(material.defines.USE_WATER_REFLECTION).toBe('1')
  })

  it('resetMaterial() НЕ снимает гейт отражения (в отличие от USE_WATER_DEPTH/USE_WATER_WAVES) — кубмапа не часть слопа/waterNormal стрима', () => {
    const texture = new CubeTexture()
    const material = new WaterMaterial(stubActor(), texture)

    material.resetMaterial()

    expect(material.defines.USE_WATER_REFLECTION).toBe('1')
    expect(material.uniforms.uSkyboxMap.value).toBe(texture)
  })
})
