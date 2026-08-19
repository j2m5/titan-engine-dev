import { describe, expect, it } from 'vitest'
import { ShaderChunk } from 'three'
import { WaterShaderTemplate } from '@/core/materials/shaders/lib/WaterShaderTemplate'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { WaterShader, WATER_WAVE_SMALLEST_PERIOD_METERS } from '@/core/materials/shaders/WaterShader'
import { Actor } from '@/core/models/Actor'
import { distanceForApparentSize } from '@/core/helpers/apparentSize'
import { toThreeJSUnits } from '@/core/helpers/scaling'

// Ядро волн (Task 1, арка water-shader; фикс-раунд 1 ревью учтён — №1 страж
// кванта по фактическому ассету, №2 whiteout-реориентация трипланара, №4
// анизотропные октавы 2/3): getNoise/sunLight/albedo дословно Water.js
// (three/examples/jsm/objects/Water.js) там, где спека не требует адаптации;
// трипланарный whiteout-бленд в body-локальном XYZ, fade по дистанции, гейт
// USE_WATER_WAVES не тронул ни одного символа Task 4 без карты (см. ниже).
const frag: string = WaterShaderTemplate.fragmentShader
const vert: string = WaterShaderTemplate.vertexShader

describe('WaterShaderTemplate: getNoise — дословная структура Water.js, свой ряд периодов', () => {
  it('4 выборки по разным периодам, сумма, *0.5-1.0 (та же форма, что Water.js)', () => {
    expect(frag).toContain('vec4 getNoise(vec2 uv) {')
    expect(frag).toContain('vec4 noise = texture2D(uWaterNormalMap, uv0) +')
    expect(frag).toContain('texture2D(uWaterNormalMap, uv1) +')
    expect(frag).toContain('texture2D(uWaterNormalMap, uv2) +')
    expect(frag).toContain('texture2D(uWaterNormalMap, uv3);')
    expect(frag).toContain('return noise * 0.5 - 1.0;')
  })

  it('ряд периодов 3000/9000 м (октавы 0/1, скаляр) — честно поднят дважды (страж ниже читает фактический ассет)', () => {
    expect(frag).toContain('uv / 3000.0 +')
    expect(frag).toContain('uv / 9000.0 +')
    expect(WATER_WAVE_SMALLEST_PERIOD_METERS).toBe(3000) // синхронизирован с литералом выше (см. её докблок)
  })

  it('октавы 2/3 АНИЗОТРОПНЫ (vec2 на ось) — как у Water.js (8907×9803, 1091×1027), не скаляр (фикс-раунд 1, №4)', () => {
    expect(frag).toContain('uv / vec2(25736.53, 28325.50) +')
    expect(frag).toContain('uv / vec2(92761.91, 87320.33) +')
  })

  it('анизотропные пары получены геометрическим средним = прежнему скаляру (27000/90000), пропорция Water.js сохранена', () => {
    const oct2 = [25736.53, 28325.5]
    const oct3 = [92761.91, 87320.33]

    expect(Math.sqrt(oct2[0] * oct2[1])).toBeCloseTo(27000, 0)
    expect(Math.sqrt(oct3[0] * oct3[1])).toBeCloseTo(90000, 0)
    expect(oct2[1] / oct2[0]).toBeCloseTo(9803 / 8907, 4)
    expect(oct3[0] / oct3[1]).toBeCloseTo(1091 / 1027, 4)
  })

  it('коэффициенты времени 500/860, -1600/2600, 300/280, 9000/-10000 — ×2 от прежней реализации (период тоже ×2)', () => {
    expect(frag).toContain('vec2(t / 500.0, t / 860.0)')
    expect(frag).toContain('vec2(t / -1600.0, t / 2600.0)')
    expect(frag).toContain('vec2(t / 300.0, t / 280.0)')
    expect(frag).toContain('vec2(t / 9000.0, t / -10000.0)')
  })

  it('t = uTime * uWaterWaveSpeed (ручка скорости — множитель времени, не периода)', () => {
    expect(frag).toContain('float t = uTime * uWaterWaveSpeed;')
  })

  it('нет Grad-выборок (мипы решают фильтрацию сами, тайлящаяся карта без стохастики Task 4 террейна)', () => {
    expect(frag).not.toContain('texture2DGradEXT')
    expect(frag).not.toContain('dFdx')
    expect(frag).not.toContain('dFdy')
  })
})

// Путь к фактическому ассету на диске — тот же файл, что грузит движок
// (resourceType 'waterNormal', Task 3). Число текселей страж читает ИЗ
// НЕГО, не литералом (фикс-раунд 1, №1 ревью Task 1): реализация Task 1
// хардкодила 512 по спеке плана, а реальный скачанный ассет — 1024×1024
// (проверено sharp) — страж на 512 молчал бы про фактический провал на 1024.
const WATER_NORMAL_ASSET_PATH = 'storage/images/textures/water/waternormals.jpg'

describe('CPU-страж кванта домена: quant(R) = R_метры · 2^-23, период/N_texels >= 3·quant', () => {
  // Формула — не таблица плана (та честно помечена как потенциально неверная,
  // см. task-1-brief.md): quant выводится из float32 ULP полноразрядной
  // величины ~R (dirLocal ⋅ uWaterWaveScale в WaterShaderTemplate.waterWaveNormal
  // формирует именно такую величину ДО деления на период — см. её докблок в
  // WaterShader.ts). period/N_texels — метров на тексель мельчайшей октавы;
  // требуем запас ×3 над ошибкой квантования, чтобы шум не читался полосами.
  function quantMeters(radiusMeters: number): number {
    return radiusMeters * Math.pow(2, -23)
  }

  async function assetTexelWidth(): Promise<number> {
    const sharp = (await import('sharp')).default
    const metadata = await sharp(WATER_NORMAL_ASSET_PATH).metadata()

    if (!metadata.width) throw new Error('waternormals.jpg: ширина не читается — ассет отсутствует или повреждён')

    return metadata.width
  }

  const EARTH_RADIUS_METERS = 6360 * 1000 // physicalObjects.ts actorId 7 (id 4)
  const YAVIN_IV_RADIUS_METERS = 6100 * 1000 // physicalObjects.ts actorId 83 (id 64)

  it('фактический ассет 1024×1024 (пин текущего состояния — если файл сменится, страж ниже пересчитает сам)', async () => {
    const width = await assetTexelWidth()

    expect(width).toBe(1024)
  })

  it.each([
    ['Земля', EARTH_RADIUS_METERS],
    ['Явин IV', YAVIN_IV_RADIUS_METERS]
  ])('%s (R=%d м): мельчайший период / N_texels(факт. ассета) >= 3 · quant(R)', async (_name, radiusMeters) => {
    const width = await assetTexelWidth()
    const quant = quantMeters(radiusMeters)
    const smallestPeriodTexelMeters = WATER_WAVE_SMALLEST_PERIOD_METERS / width

    expect(smallestPeriodTexelMeters).toBeGreaterThanOrEqual(3 * quant)
  })

  it('запас для Земли на фактических 1024 текселях — +28.8% (число ревью)', async () => {
    const width = await assetTexelWidth()
    const quant = quantMeters(EARTH_RADIUS_METERS)
    const margin = WATER_WAVE_SMALLEST_PERIOD_METERS / width / (3 * quant) - 1

    expect(margin).toBeCloseTo(0.288, 3)
  })

  it('потолок радиуса тела для этого ряда/ассета — 8192 км (страж ровно на границе)', async () => {
    const width = await assetTexelWidth()
    const ceilingRadiusMeters = 8192 * 1000
    const quant = quantMeters(ceilingRadiusMeters)

    expect(WATER_WAVE_SMALLEST_PERIOD_METERS / width).toBeCloseTo(3 * quant, 6)
  })

  it('страж — для честности: обе прежние версии ряда НЕ прошли бы его на фактических 1024 текселях', async () => {
    const width = await assetTexelWidth()
    const quant = quantMeters(EARTH_RADIUS_METERS)

    expect(1000 / width).toBeLessThan(3 * quant) // черновик плана (task-1-brief.md)
    expect(1500 / width).toBeLessThan(3 * quant) // первая реализация Task 1 (страж на 512-литерале молчал про это)
  })
})

describe('WaterShaderTemplate: sunLight/albedo — дословно Water.js (getShadowMask опущен, теней нет)', () => {
  it('sunLight: сигнатура и коэффициенты вызова 100/2/0.5 (дословно)', () => {
    expect(frag).toContain(
      'void sunLight(const vec3 surfaceNormal, const vec3 eyeDirection, float shiny, float spec, float diffuse, inout vec3 diffuseColor, inout vec3 specularColor) {'
    )
    expect(frag).toContain('sunLight(normal, viewDir, 100.0, 2.0, 0.5, waveDiffuseLight, waveSpecularLight);')
  })

  it('sunLight: формулы diffuse/specular не тронуты (единственная адаптация — источник sunDirection)', () => {
    expect(frag).toContain('vec3 reflection = normalize(reflect(-waterSunDirection, surfaceNormal));')
    expect(frag).toContain('float direction = max(0.0, dot(eyeDirection, reflection));')
    expect(frag).toContain('specularColor += pow(direction, shiny) * waterSunColor * spec;')
    expect(frag).toContain('diffuseColor += max(dot(waterSunDirection, surfaceNormal), 0.0) * waterSunColor * diffuse;')
  })

  it('reflectance по Шлику: rf0 = 0.3 (дословно)', () => {
    expect(frag).toContain('float waveRf0 = 0.3;')
    expect(frag).toContain('float waveReflectance = waveRf0 + (1.0 - waveRf0) * pow((1.0 - waveTheta), 5.0);')
  })

  it('scatter — тот же вход baseColor, что и fresnel-mix Task 4 (мелководье/константа сохранены)', () => {
    expect(frag).toContain('vec3 waveScatter = max(0.0, dot(normal, viewDir)) * baseColor;')
  })

  it('albedo — mix дословно Water.js БЕЗ getShadowMask (комментарий-оговорка обязателен)', () => {
    expect(frag).toContain('getShadowMask опущен')
    expect(frag).toContain('color = mix(')
    expect(frag).toContain('waterSunColor * waveDiffuseLight * 0.3 + waveScatter,')
    expect(frag).toContain('vec3(0.1) + waveReflectionSample * 0.9 + waveReflectionSample * waveSpecularLight,')
    expect(frag).toContain('waveReflectance')
  })

  it('reflection = существующий тинт Task 4 (Task 2 подменит источник)', () => {
    expect(frag).toContain('vec3 waveReflectionSample = uWaterFresnelTint;')
  })
})

describe('WaterShaderTemplate: трипланарный whiteout-бленд — реориентация ДО суммирования (фикс-раунд 1, №2)', () => {
  it('вес |N| (нормированная сумма компонент) — не вызов triplanarWeights^4, не #include чанка TriplanarDetail', () => {
    expect(frag).toContain('vec3 w = abs(dirLocal);')
    expect(frag).toContain('w /= max(w.x + w.y + w.z, 1e-6);')
    expect(frag).not.toContain('triplanarWeights(')
    expect(frag).not.toContain('#include <triplanar')
  })

  it('полюсный гард (eastLen<1e-4) остаётся НЕ ТРОНУТЫМ (рулинг контроллера, фикс-раунд 1, №8)', () => {
    expect(frag).toContain('vec3 eastRaw = cross(vec3(0.0, 1.0, 0.0), dirLocal);')
    expect(frag).toContain('float eastLen = length(eastRaw);')
    expect(frag).toContain('if (eastLen < 1e-4) return dirLocal;')
  })

  it('T/B полюсного фрейма БОЛЬШЕ НЕ строятся — реориентация теперь в body-локальном XYZ, не в TBN', () => {
    expect(frag).not.toContain('vec3 T = eastRaw')
    expect(frag).not.toContain('vec3 B = cross(dirLocal, T)')
  })

  it('каждая проекция реориентирована СВОИМ свизлом ДО суммирования — X→.zyx, Y→.xzy, Z→.xyz (порядок triplanarBlendNormal)', () => {
    expect(frag).toContain('vec3 fromX = getNoise(p.zy).zyx * vec3(1.0, 1.5, 1.5);')
    expect(frag).toContain('vec3 fromY = getNoise(p.xz).xzy * vec3(1.5, 1.0, 1.5);')
    expect(frag).toContain('vec3 fromZ = getNoise(p.xy).xyz * vec3(1.5, 1.5, 1.0);')
  })

  it('Y-проекция (.xzy) — дословно одноплоскостная формула Water.js (world.xz + up=world.y)', () => {
    // Water.js: surfaceNormal = normalize(noise.xzy * vec3(1.5,1.0,1.5)) — тот
    // же множитель на ТОЙ ЖЕ свизл-схеме, ноль адаптации для этой проекции.
    expect(frag).toContain('getNoise(p.xz).xzy * vec3(1.5, 1.0, 1.5)')
  })

  it('взвешенная сумма УЖЕ реориентированных проекций — normalize(fromX*w.x + fromY*w.y + fromZ*w.z)', () => {
    expect(frag).toContain('vec3 perturbed = normalize(fromX * w.x + fromY * w.y + fromZ * w.z);')
  })

  it('fade — mix к чистому dir̂ (амплитуда 1→0)', () => {
    expect(frag).toContain('return normalize(mix(dirLocal, perturbed, fade));')
  })

  it('единственный normalMatrix-переход — пертурбация целиком тело-локальна', () => {
    expect(frag).toContain('normal = normalize(normalMatrix * waveLocalNormal);')
  })
})

describe('WaterShaderTemplate: fade по дистанции — юниформ uWaterWaveFadeMeters, начало 0.4×конец', () => {
  it('формула fade пином (та же схема начала, что uDetailFadeRange террейна)', () => {
    expect(frag).toContain('float waveDist = length(vViewPosition);')
    expect(frag).toContain('float waveFade = 1.0 - smoothstep(0.4 * uWaterWaveFadeMeters, uWaterWaveFadeMeters, waveDist);')
  })
})

describe('Парный страж терминатора: одна и та же форма smoothstep(-0.08, 0.25, NdotL) — суша/вода', () => {
  // Task 2 (арка water-shader) добавила ТРЕТЬЕ место: дневной бленд
  // отражения кубмапы использует ТУ ЖЕ форму (см. WaterReflection.spec.ts,
  // блок { } внутри USE_WATER_REFLECTION) — количество вхождений выросло
  // 1 → 2 (Planet's NdotLraw — отдельная, другая переменная, не считается
  // здесь, проверяется следующим тестом).
  it('водный фрагментник — ДВА вхождения (ночной пол Task 4 + дневной бленд отражения Task 2)', () => {
    const matches = frag.match(/smoothstep\(-0\.08, 0\.25, NdotL\)/g) ?? []

    expect(matches.length).toBe(2)
  })

  it('PlanetShaderTemplate использует ТУ ЖЕ форму (см. её NdotLraw)', () => {
    expect(PlanetShaderTemplate.fragmentShader).toContain('smoothstep(-0.08, 0.25, NdotLraw)')
  })
})

describe('Вершинник — БЕЗ волн вовсе (T/B/N считаются попиксельно в фрагментнике, см. TerrainUv/HeightNormal прецедент)', () => {
  it('vertexShader не содержит USE_WATER_WAVES — нулевой footprint на вершинном шейдере', () => {
    expect(vert).not.toContain('USE_WATER_WAVES')
  })
})

// «Без карты — дефайна нет и рендер бит-в-бит» (task-1-brief.md, Step 1 RED):
// снимок ДО Task 1 (WaterShaderTemplate.ts, коммит 14dc2cc) — все блоки
// #ifdef USE_WATER_WAVES ... #endif вырезаны (та же семантика, что реальный
// GLSL-препроцессор с неопределённым USE_WATER_WAVES), результат обязан
// совпасть с этим снимком с точностью до пустых строк (GLSL их игнорирует —
// считать разницу в их количестве регрессией было бы придиркой к пробелам,
// не к содержимому).
//
// Балансирующий парсер строк, не regex (фикс Task 2, арка water-shader):
// Task 2 завела #ifdef USE_WATER_REFLECTION ВНУТРИ #ifdef USE_WATER_WAVES
// (main-body блок — отражению нечего отражать без возмущённой нормали волн,
// см. WaterShaderTemplate). Прежний non-greedy regex останавливался на
// ПЕРВОМ попавшемся #endif — то есть на закрывающей вложенного блока, а не
// на своей — и портил вывод. Парсер считает глубину ЛЮБОГО #ifdef/#endif
// (не только совпадающего guard) — ровно семантика реального препроцессора:
// когда внешний guard не определён, всё вложенное (включая другие guard'ы)
// тоже недостижимо и обязано пропасть целиком.
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
    // тело вырезаемого блока (и любые вложенные ifdef/endif) — не выводим
  }

  return result.join('\n')
}

function normalizeBlankLines(source: string): string {
  return source.replace(/\n[ \t]*\n(?:[ \t]*\n)*/g, '\n\n').trim()
}

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

describe('Паритет: без USE_WATER_WAVES компилируемый фрагментник бит-в-бит прежний (Task 4)', () => {
  it('вырезав все блоки #ifdef USE_WATER_WAVES...#endif, получаем ровно снимок ДО Task 1', () => {
    const stripped = stripGuardedBlock(frag, 'USE_WATER_WAVES')

    expect(normalizeBlankLines(stripped)).toBe(normalizeBlankLines(BASELINE_FRAGMENT_SHADER))
  })
})

describe('WaterShader: uWaterWaveScale — радиус тела (метры) × ручка (дефолт 1)', () => {
  function stubActorWithRadius(radiusKm: number | undefined, data: Record<string, unknown> = {}): Actor {
    return {
      renderingObject: { getAttribute: () => data },
      resources: { where: () => ({ first: () => undefined }) },
      ...(radiusKm !== undefined && { physicalObject: { getAttribute: () => radiusKm } })
    } as unknown as Actor
  }

  it('дефолт (ручки нет): scale = radiusKm * 1000', () => {
    const shader = new WaterShader(stubActorWithRadius(6360))

    expect(shader.uniforms.uWaterWaveScale.value).toBeCloseTo(6360 * 1000, 6)
  })

  it('ручка waterWaveScale домножает радиус, не заменяет его', () => {
    const shader = new WaterShader(stubActorWithRadius(6360, { waterWaveScale: 2 }))

    expect(shader.uniforms.uWaterWaveScale.value).toBeCloseTo(6360 * 1000 * 2, 6)
  })

  it('стаб-актор без physicalObject (существующие тесты WaterMaterial.spec.ts) — scale = 0, конструктор не падает', () => {
    const shader = new WaterShader(stubActorWithRadius(undefined))

    expect(shader.uniforms.uWaterWaveScale.value).toBe(0)
  })
})

describe('WaterShader: uWaterWaveFadeMeters — дефолт по видимому размеру мельчайшей октавы (fov 50°/1080p, 1.5px)', () => {
  function stubActor(data: Record<string, unknown> = {}): Actor {
    return {
      renderingObject: { getAttribute: () => data },
      resources: { where: () => ({ first: () => undefined }) },
      physicalObject: { getAttribute: () => 6360 }
    } as unknown as Actor
  }

  it('дефолт = distanceForApparentSize(мельчайший период, 1.5px, 50°, 1080) в юнитах сцены', () => {
    const shader = new WaterShader(stubActor())
    const expectedUnits = distanceForApparentSize(
      toThreeJSUnits(WATER_WAVE_SMALLEST_PERIOD_METERS / 1000),
      1.5,
      50,
      1080
    )

    expect(shader.uniforms.uWaterWaveFadeMeters.value).toBeCloseTo(expectedUnits, 10)
  })

  it('ручка waterWaveFadeMeters (метры) перекрывает дефолт, конвертируется в юниты сцены на CPU', () => {
    const shader = new WaterShader(stubActor({ waterWaveFadeMeters: 5000 }))

    expect(shader.uniforms.uWaterWaveFadeMeters.value).toBeCloseTo(toThreeJSUnits(5), 10)
  })
})
