import { describe, expect, it } from 'vitest'
import { ShaderChunk } from 'three'
import { WaterShaderTemplate } from '@/core/materials/shaders/lib/WaterShaderTemplate'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { WaterShader, WATER_WAVE_SMALLEST_PERIOD_METERS } from '@/core/materials/shaders/WaterShader'
import { Actor } from '@/core/models/Actor'
import { distanceForApparentSize } from '@/core/helpers/apparentSize'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import {
  OCTANT_DIRECTIONS,
  angleDeg,
  dot,
  waterWaveNormalPerturbed,
  waterWaveNormalWithoutSignFix
} from './waterWaveNormalMirror'
import {
  blendedAlpha,
  blendedColor,
  dirFromLatLon,
  foundationAlpha,
  foundationColor,
  waveAlpha as waveAlphaMirror,
  wavesColor,
  type Vec3
} from './waterColorMirror'

// Ядро волн (Task 1, арка water-shader; фикс-раунд 1 ревью учтён — №1 страж
// кванта по фактическому ассету, №2 whiteout-реориентация трипланара, №4
// анизотропные октавы 2/3; финальное whole-branch ревью учтено — БЛОКЕР №1:
// несущая компонента трипланара теряла знак оси проекции, см. describe ниже
// «CPU-зеркало waterWaveNormal»): getNoise/sunLight/albedo дословно Water.js
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
    expect(frag).toContain('sunLight(waveNormal, viewDir, 100.0, 2.0, 0.5, waveDiffuseLight, waveSpecularLight);')
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
    expect(frag).toContain('vec3 waveScatter = max(0.0, dot(waveNormal, viewDir)) * baseColor;')
  })

  it('albedo — mix дословно Water.js БЕЗ getShadowMask (комментарий-оговорка обязателен), результат в свою переменную wavesColor', () => {
    expect(frag).toContain('getShadowMask опущен')
    expect(frag).toContain('vec3 wavesColor = mix(')
    expect(frag).toContain('waterSunColor * waveDiffuseLight * 0.3 + waveScatter,')
    // Приёмочная волна 4, №1: Water.js vec3(0.1) — вклад ambient ЗЕРКАЛЬНОЙ
    // сцены, у нас зеркала нет — адаптация тонирует тот же вклад градиентным
    // skyColor (0.1·skyColor), не плоской серой константой.
    // Блик — белый waterSunColor, не тинт неба: у Water.js reflectionSample —
    // честное небо с солнцем в нём, у нас константный голубой градиент, и
    // глинт выходил голубым (пик 1.1 в синем, 0.14 в красном).
    expect(frag).toContain('0.1 * skyColor + waveReflectionSample * 0.9 + waterSunColor * waveSpecularLight,')
    expect(frag).not.toContain('waveReflectionSample * waveSpecularLight')
    expect(frag).toContain('waveReflectance')
  })

  it('reflection = градиентный skyColor (Task 2 добавила зенит/горизонт, приёмочная волна 3 сделала его безусловным дефолтом — см. WaterReflection.spec.ts)', () => {
    expect(frag).toContain('vec3 waveReflectionSample = skyColor;')
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
    expect(frag).toContain('vec3 fromX = getNoise(p.zy).zyx * vec3(1.0, 1.5, 1.5) * vec3(axisSign.x, 1.0, 1.0);')
    expect(frag).toContain('vec3 fromY = getNoise(p.xz).xzy * vec3(1.5, 1.0, 1.5) * vec3(1.0, axisSign.y, 1.0);')
    expect(frag).toContain('vec3 fromZ = getNoise(p.xy).xyz * vec3(1.5, 1.5, 1.0) * vec3(1.0, 1.0, axisSign.z);')
  })

  it('Y-проекция (.xzy) — дословно одноплоскостная формула Water.js (world.xz + up=world.y), знаковая поправка отдельным множителем', () => {
    // Water.js: surfaceNormal = normalize(noise.xzy * vec3(1.5,1.0,1.5)) — тот
    // же множитель на ТОЙ ЖЕ свизл-схеме, ноль адаптации для этой проекции;
    // sign(dirLocal.y) — отдельный сомножитель ПОВЕРХ (см. describe ниже).
    expect(frag).toContain('getNoise(p.xz).xzy * vec3(1.5, 1.0, 1.5)')
  })

  it('БЛОКЕР финального ревью №1: несущая компонента каждой проекции домножена на sign(dirLocal.ось), не только на абс. вес', () => {
    expect(frag).toContain('vec3 axisSign = sign(dirLocal);')
    expect(frag).toContain('vec3(axisSign.x, 1.0, 1.0)')
    expect(frag).toContain('vec3(1.0, axisSign.y, 1.0)')
    expect(frag).toContain('vec3(1.0, 1.0, axisSign.z)')
  })

  it('взвешенная сумма УЖЕ реориентированных проекций — normalize(fromX*w.x + fromY*w.y + fromZ*w.z)', () => {
    expect(frag).toContain('vec3 perturbed = normalize(fromX * w.x + fromY * w.y + fromZ * w.z);')
  })

  it('fade — mix к чистому dir̂ (амплитуда 1→0)', () => {
    expect(frag).toContain('return normalize(mix(dirLocal, perturbed, fade));')
  })

  it('единственный normalMatrix-переход — пертурбация целиком тело-локальна', () => {
    expect(frag).toContain('vec3 waveNormal = normalize(normalMatrix * waveLocalNormal);')
  })

  it('waveNormal — СВОЯ переменная, не общий normal (приёмочный фикс: normal фундамента больше не перезаписывается)', () => {
    expect(frag).not.toContain('normal = normalize(normalMatrix * waveLocalNormal);')
  })
})

// CPU-зеркало waterWaveNormal (тот же класс стража, что знак cavity —
// численный порт GLSL, читаемый ОТДЕЛЬНО от строковых пинов выше): блокер
// финального whole-branch ревью, №1. Несущая компонента трипланарного
// бленда (декод B-канала ассета, статистически смещённого к +z, см.
// waterWaveNormalMirror.ts) без знаковой поправки ВСЕГДА положительна — на
// октантах, где dirLocal отрицателен по оси, perturbed указывал «в мир», а
// не «наружу» (dot(perturbed,dirLocal) < 0, угол > 90°, местами до 180°).
describe('CPU-зеркало waterWaveNormal: знак несущей компоненты трипланара (БЛОКЕР финального ревью, №1)', () => {
  it('RED на прежнем коде (без sign-фикса): минимум на одном октанте perturbed смотрит НАЗАД (dot < 0)', () => {
    const worst = OCTANT_DIRECTIONS.map(([, dir]) => dot(waterWaveNormalWithoutSignFix(dir), dir)).reduce(
      (min, d) => Math.min(min, d),
      Infinity
    )

    // -X-Y-Z: несущая компонента каждой проекции положительна по построению
    // (декод смещён к +z), а dirLocal отрицателен по всем трём осям —
    // perturbed и dirLocal антипараллельны без поправки.
    expect(worst).toBeLessThan(0)
  })

  it('GREEN на текущем коде (со sign-фиксом): dot(perturbed, dirLocal) > 0 на ВСЕХ 8 октантах', () => {
    for (const [name, dir] of OCTANT_DIRECTIONS) {
      const perturbed = waterWaveNormalPerturbed(dir)

      expect(dot(perturbed, dir), `октант ${name}`).toBeGreaterThan(0)
    }
  })

  it('углы до/после фикса — таблица (мельче ~15° на всех 8 октантах после фикса)', () => {
    for (const [, dir] of OCTANT_DIRECTIONS) {
      const before = angleDeg(waterWaveNormalWithoutSignFix(dir), dir)
      const after = angleDeg(waterWaveNormalPerturbed(dir), dir)

      // фикс обязан не УХУДШИТЬ угол ни на одном октанте (на +X+Y+Z, где все
      // знаки положительны, sign()=+1 везде — фикс там тождественный, угол
      // совпадает буквально; на остальных 7 — строго улучшает)
      expect(after).toBeLessThanOrEqual(before)
      expect(after).toBeLessThan(15) // страж числом (не только знаком) — ревью замерило 3.2–14.5°
    }
  })
})

describe('WaterShaderTemplate: fade по дистанции — юниформ uWaterWaveFadeMeters, начало 0.4×конец', () => {
  it('формула fade пином (та же схема начала, что uDetailFadeRange террейна)', () => {
    expect(frag).toContain('float waveDist = length(vViewPosition);')
    expect(frag).toContain('float waveFade = 1.0 - smoothstep(0.4 * uWaterWaveFadeMeters, uWaterWaveFadeMeters, waveDist);')
  })
})

// Приёмочный фикс владельца: скрин из космоса показал молочный океан по
// всему диску + размытое яркое пятно в центре + голубое гало за лимбом
// (блум от переяркой воды). Корень (диагноз контроллера, подтверждён
// математикой): fade глушил ТОЛЬКО возмущение нормали (waterWaveNormal уже
// честно деградирует в dir̂), но НЕ состав формулы цвета — waves-ветка
// перезаписывала `color` безусловно на любой дистанции. Water.js
// reflectance держит пол 0.3 (30% тинта/отражения даже в надир, theta=1,
// где фундаментный pow5-Френель даёт ≈0) — молочность всего диска;
// sunLight-спекуляр pow100 по гладкой сфере — яркое пятно. Спека §2: «за
// fade-порогом вода деградирует РОВНО в базовый вид фундамента».
describe('WaterShaderTemplate: приёмочный фикс — fade смешивает ВЕСЬ состав цвета, не только нормаль', () => {
  it('color = mix(color, wavesColor, waveFade) — итоговый блендинг, не безусловная перезапись', () => {
    expect(frag).toContain('color = mix(color, wavesColor, waveFade);')
    expect(frag).not.toMatch(/\n\s*color = mix\(\s*\n\s*waterSunColor/) // старая безусловная перезапись `color =` полной формулой убрана
  })

  it('фундаментный color посчитан ДО #ifdef USE_WATER_WAVES (byte-в-byte тем же путём, что и без волн)', () => {
    const waveBlockStart = frag.indexOf('#ifdef USE_WATER_WAVES', frag.indexOf('void main()'))
    const foundationColorLine = frag.indexOf('vec3 color = mix(baseColor, uWaterFresnelTint, fresnel);')
    const nightFloorLine = frag.indexOf('color *= mix(uWaterNightFloor, 1.0, dayFactor);')

    expect(foundationColorLine).toBeGreaterThan(-1)
    expect(nightFloorLine).toBeGreaterThan(foundationColorLine)
    expect(waveBlockStart).toBeGreaterThan(nightFloorLine) // ночной пол фундамента отработал ДО waves-блока
  })

  it('wavesColor несёт СВОЙ ночной пол (waveDayFactor, не общий dayFactor) — иначе fade=0 не был бы численно равен фундаменту', () => {
    expect(frag).toContain('wavesColor *= mix(uWaterNightFloor, 1.0, waveDayFactor);')
  })
})

describe('CPU-зеркало цвета (waterColorMirror.ts): приёмочный фикс — критерии 1-3', () => {
  const baseColor: Vec3 = [0.043, 0.239, 0.4] // uWaterColor-подобный
  const shallowLikeColor: Vec3 = [0.18, 0.545, 0.62]
  const fresnelTint: Vec3 = [0.749, 0.914, 1.0]
  const skyColor: Vec3 = [0.6, 0.75, 0.85] // градиентный skyColor-подобный (приёмочная волна 4, №1)
  const sunColor: Vec3 = [1, 1, 1]
  const nightFloor = 0.08

  const normals: Vec3[] = [
    dirFromLatLon(89, 0), // почти полюс — грань полюсного гарда, но не сам полюс
    dirFromLatLon(0, 0),
    dirFromLatLon(-5, 40), // около терминатора
    dirFromLatLon(35, -160), // произвольная точка (в т.ч. «Тихий океан»)
    dirFromLatLon(1, 89) // близко к грани (grazing) относительно viewDirs ниже
  ]
  const viewDirs: Vec3[] = [dirFromLatLon(80, 10), dirFromLatLon(10, -20), dirFromLatLon(-30, 170)]
  const lightDirs: Vec3[] = [dirFromLatLon(60, 0), dirFromLatLon(-10, 130), dirFromLatLon(20, -90)]
  const baseColors: Vec3[] = [baseColor, shallowLikeColor]

  // waveNormal/reflectionSample НАМЕРЕННО другие, не связанные с normal —
  // критерий 1 обязан держаться НЕЗАВИСИМО от того, что вернула бы waves-
  // ветка (иначе fade=0 «случайно» совпадал бы только когда waveNormal≈normal).
  const foreignWaveNormals: Vec3[] = [dirFromLatLon(-70, 150), dirFromLatLon(45, 45)]
  const foreignReflectionSamples: Vec3[] = [
    [0.9, 0.9, 0.95],
    [0.05, 0.05, 0.08]
  ]

  it('критерий 1: fadeFactor == 0 → blendedColor ЧИСЛЕННО (===) равен foundationColor, независимо от waves-входов', () => {
    let samples = 0

    for (const normal of normals) {
      for (const viewDir of viewDirs) {
        for (const lightDir of lightDirs) {
          for (const bc of baseColors) {
            for (const waveNormal of foreignWaveNormals) {
              for (const reflectionSample of foreignReflectionSamples) {
                const foundation = foundationColor(bc, fresnelTint, normal, viewDir, lightDir, nightFloor)
                const blended = blendedColor(
                  { baseColor: bc, fresnelTint, reflectionSample, skyColor, normal, waveNormal, viewDir, lightDir, sunColor, nightFloor },
                  0
                )

                expect(blended[0]).toBe(foundation[0])
                expect(blended[1]).toBe(foundation[1])
                expect(blended[2]).toBe(foundation[2])
                samples++
              }
            }
          }
        }
      }
    }

    expect(samples).toBeGreaterThan(100) // выборка честно широкая, не 1-2 точки
  })

  it('критерий 1б: wavesColor сам по себе всегда конечен (finite) на той же выборке — mix(a,b,0) полагается на это', () => {
    for (const normal of normals) {
      for (const viewDir of viewDirs) {
        for (const lightDir of lightDirs) {
          const waves = wavesColor(baseColor, fresnelTint, skyColor, normal, viewDir, lightDir, sunColor, nightFloor)

          expect(Number.isFinite(waves[0])).toBe(true)
          expect(Number.isFinite(waves[1])).toBe(true)
          expect(Number.isFinite(waves[2])).toBe(true)
        }
      }
    }
  })

  it('критерий 2: непрерывность по fade — нет скачка ни на пороге (fade→0), ни в середине', () => {
    const inputs = {
      baseColor,
      fresnelTint,
      reflectionSample: fresnelTint,
      skyColor,
      normal: normals[1],
      waveNormal: dirFromLatLon(15, -30),
      viewDir: viewDirs[0],
      lightDir: lightDirs[0],
      sunColor,
      nightFloor
    }

    // mix — линейная функция fade по построению (см. blendedColor): шаг по
    // fade даёт пропорциональный шаг по цвету, без разрывов ни у порога,
    // ни в середине диапазона.
    const fadeSteps = [0, 0.001, 0.01, 0.1, 0.3, 0.5, 0.5 + 1e-6, 0.7, 0.999, 1]
    let previous = blendedColor(inputs, fadeSteps[0])

    for (let i = 1; i < fadeSteps.length; i++) {
      const current = blendedColor(inputs, fadeSteps[i])
      const step = fadeSteps[i] - fadeSteps[i - 1]
      const jump = Math.hypot(current[0] - previous[0], current[1] - previous[1], current[2] - previous[2])

      // Скачок ограничен ЛИНЕЙНО шагом по fade (константа запаса ×5 —
      // цветовые компоненты держатся в разумном [0, ~1.5] диапазоне) —
      // никакая ветка не может дать скачок на ПОРЯДОК больше шага аргумента.
      expect(jump).toBeLessThan(step * 5 + 1e-6)
      previous = current
    }
  })

  it('критерий 3: вклад waves (спекуляр/reflectance-надбавка) растёт СТРОГО от fade — линейно, ноль на пороге', () => {
    const inputs = {
      baseColor,
      fresnelTint,
      reflectionSample: [1, 1, 1] as Vec3, // максимально яркий — контрастная проверка
      skyColor,
      normal: normals[1],
      waveNormal: normals[1], // специально совпадает с normal — специулярный пик виден
      viewDir: viewDirs[0],
      lightDir: lightDirs[0],
      sunColor,
      nightFloor
    }

    const foundation = foundationColor(inputs.baseColor, inputs.fresnelTint, inputs.normal, inputs.viewDir, inputs.lightDir, inputs.nightFloor)
    const waves = wavesColor(inputs.baseColor, inputs.reflectionSample, inputs.skyColor, inputs.waveNormal, inputs.viewDir, inputs.lightDir, inputs.sunColor, inputs.nightFloor)

    // mix — линейная функция: blended(fade) === foundation + fade*(waves-foundation)
    // покомпонентно. Проверяем ЭТУ ТОЧНУЮ линейность на нескольких fade —
    // она же доказывает «рост строго от fade, ноль на пороге» аналитически,
    // не приближённо.
    for (const fade of [0, 0.25, 0.5, 0.75, 1]) {
      const blended = blendedColor(inputs, fade)

      for (let c = 0; c < 3; c++) {
        const expected = foundation[c] + fade * (waves[c] - foundation[c])

        expect(blended[c]).toBeCloseTo(expected, 12)
      }
    }
  })
})

// Приёмочная волна 4, №2 (владелец: звёзды сквозь воду на горизонте) —
// depthAlpha держал потолок uWaterAlphaDeep ВЕЗДЕ, включая скользящий взгляд
// у лимба, где физически вода непрозрачна. Alpha теперь поднимается к 1.0 по
// тому же классу pow5-Френеля, что и цвет — фундаментный путь по normal/
// viewDir, waves-путь по waveNormal/waveTheta с вычетом пола waveRf0.
describe('WaterShaderTemplate: alpha поднимается к 1.0 на скользящем взгляде (приёмочная волна 4, №2)', () => {
  it('фундаментный путь пином: depthAlpha → alpha = mix(depthAlpha, 1.0, fresnel)', () => {
    expect(frag).toContain('float depthAlpha = uWaterAlphaDeep * depthA;')
    expect(frag).toContain('float depthAlpha = uWaterAlphaDeep;')
    expect(frag).toContain('float alpha = mix(depthAlpha, 1.0, fresnel);')
  })

  it('waves-путь пином: grazing = (waveReflectance-waveRf0)/(1-waveRf0), waveAlpha = mix(depthAlpha, 1.0, grazing), финальный блендинг по waveFade', () => {
    expect(frag).toContain('float waveGrazing = (waveReflectance - waveRf0) / (1.0 - waveRf0);')
    expect(frag).toContain('float waveAlpha = mix(depthAlpha, 1.0, waveGrazing);')
    expect(frag).toContain('alpha = mix(alpha, waveAlpha, waveFade);')
  })

  it('CPU-зеркало: в надир (fresnel=0) alpha === depthAlpha — дальний план из космоса (центр диска) не сдвинулся', () => {
    const depthAlpha = 0.85

    expect(foundationAlpha(depthAlpha, 0)).toBe(depthAlpha)
  })

  it('CPU-зеркало: на пределе скользящего взгляда (fresnel=1) alpha === 1.0 — лимб непрозрачен', () => {
    const depthAlpha = 0.85

    expect(foundationAlpha(depthAlpha, 1)).toBe(1)
  })

  it('CPU-зеркало: fresnel непрерывно поднимает alpha между depthAlpha и 1.0 (монотонно)', () => {
    const depthAlpha = 0.6
    let previous = foundationAlpha(depthAlpha, 0)

    for (const fresnel of [0.1, 0.3, 0.5, 0.7, 0.9, 1]) {
      const current = foundationAlpha(depthAlpha, fresnel)

      expect(current).toBeGreaterThanOrEqual(previous)
      previous = current
    }
    expect(previous).toBe(1)
  })

  it('CPU-зеркало waves: в надир (waveTheta=1 → waveReflectance=waveRf0) waveAlpha === depthAlpha — пол reflectance вычтен корректно', () => {
    const depthAlpha = 0.85
    const waveRf0 = 0.3
    // theta=1 → pow(1-theta,5)=0 → waveReflectance = waveRf0 ровно
    const waveReflectance = waveRf0

    expect(waveAlphaMirror(depthAlpha, waveReflectance, waveRf0)).toBeCloseTo(depthAlpha, 12)
  })

  it('CPU-зеркало waves: на пределе (waveTheta=0 → waveReflectance=1) waveAlpha === 1.0', () => {
    const depthAlpha = 0.85
    const waveRf0 = 0.3
    // theta=0 → pow(1-0,5)=1 → waveReflectance = waveRf0 + (1-waveRf0)*1 = 1
    const waveReflectance = 1

    expect(waveAlphaMirror(depthAlpha, waveReflectance, waveRf0)).toBeCloseTo(1, 12)
  })

  it('CPU-зеркало: blendedAlpha(fade=0) === foundationAlpha, blendedAlpha(fade=1) === waveAlpha — тот же паттерн, что цвет', () => {
    const depthAlpha = 0.7
    const fresnel = 0.4
    const waveRf0 = 0.3
    const waveReflectance = 0.65

    const foundation = foundationAlpha(depthAlpha, fresnel)
    const waves = waveAlphaMirror(depthAlpha, waveReflectance, waveRf0)

    expect(blendedAlpha(foundation, waves, 0)).toBe(foundation)
    expect(blendedAlpha(foundation, waves, 1)).toBe(waves)
    expect(blendedAlpha(foundation, waves, 0.5)).toBeCloseTo((foundation + waves) / 2, 12)
  })
})

describe('Парный страж терминатора: одна и та же форма smoothstep(-0.08, 0.25, NdotL) — суша/вода', () => {
  // Приёмочный фикс (владелец: молочный океан/яркое пятно/гало) развёл
  // терминатор на ДВЕ переменные — NdotL фундамента (normal, unperturbed)
  // и waveNdotL waves-ветки (waveNormal) — та же ФОРМА (порог/ширина), но
  // разные операнды: без этого equality при fade=0 держалось бы неточно
  // (см. describe «CPU-зеркало цвета» ниже). Дневной бленд отражения
  // (USE_WATER_REFLECTION) переиспользует waveDayFactor — своего
  // smoothstep-вызова больше не заводит (было третье место до фикса).
  it('водный фрагментник — ДВА вхождения формы: NdotL (фундамент) и waveNdotL (waves)', () => {
    const matches = frag.match(/smoothstep\(-0\.08, 0\.25, \w*NdotL\)/g) ?? []

    expect(matches.length).toBe(2)
    expect(frag).toContain('smoothstep(-0.08, 0.25, NdotL)')
    expect(frag).toContain('smoothstep(-0.08, 0.25, waveNdotL)')
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
// Контракт ограничен (находка ревью Task 2 фикс-раунда 1 №6, честно, не
// молчание): считает только `#ifdef`/`#ifndef` как открывающие директивы,
// `#endif` строгим построчным равенством после trim() — `#if`/`#elif`/
// `#endif` с хвостовым комментарием на той же строке НЕ распознаются и
// сломают баланс. В этом файле такие формы не используются — латентная
// мина для будущего guard'а, не текущий баг.
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
    varying vec3 vLocalLightDirection;
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
        // depthAlpha → 0 на урезе: закрывает z-fighting стыка воды и берега
        // без масок (см. WaterMaterial докблок depthWrite=false). Финальная
        // alpha (ниже, после fresnel) поднимает ЭТОТ пол к 1.0 на скользящем
        // взгляде — здесь только базовая непрозрачность по глубине.
        float depthAlpha = uWaterAlphaDeep * depthA;
      #else
        // Без запечённой глубины (карты нет / тело не готово Task 6) —
        // константный режим: единая непрозрачность, единый глубокий цвет.
        vec3 baseColor = uWaterColor;
        float depthAlpha = uWaterAlphaDeep;
      #endif

      // Френель Шлика-класса: грань тела светлеет к тинту — грубая замена
      // честному отражению неба/окружения, которого у Task 4 («базовый вид»)
      // ещё нет. Показатель 5 — классический ход Шлика при F0≈0.
      float fresnel = pow(1.0 - max(dot(viewDir, normal), 0.0), 5.0);
      vec3 color = mix(baseColor, uWaterFresnelTint, fresnel);

      // Приёмочная волна 4, №2 (владелец: звёзды сквозь воду на горизонте) —
      // depthAlpha держал потолок uWaterAlphaDeep (0.85) ВЕЗДЕ, включая
      // скользящий взгляд у лимба, где физически вода непрозрачна (Френель→1,
      // почти всё падающее/уходящее рассеяно поверхностью, а не пропущено
      // насквозь) — лимб просвечивал звёзды фона. Тот же fresnel, что и у
      // цвета выше: в надир (theta≈1, вид из космоса в центр диска) fresnel≈0,
      // alpha=depthAlpha без изменений (дальний план не сдвинулся); к
      // горизонту fresnel→1, alpha→1.0 (непрозрачно).
      float alpha = mix(depthAlpha, 1.0, fresnel);

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
  // USE_SUN_TINT снимается вторым (арка «тинт солнца для воды»): весь её вклад
  // во фрагментник живёт под своим гейтом, вне гейта прибавилось только
  // объявление варьинга vLocalLightDirection — оно в снимке выше.
  it('вырезав все блоки #ifdef USE_WATER_WAVES...#endif, получаем ровно снимок ДО Task 1', () => {
    const stripped = stripGuardedBlock(stripGuardedBlock(frag, 'USE_WATER_WAVES'), 'USE_SUN_TINT')

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

  // Финальное whole-branch ревью, №4: waterWaveScale не входил ни в дефолт
  // fade, ни в квант-страж — scale=2 сжимает эффективный мельчайший период
  // (period/scale = 1500 м) без предупреждения, мерцание возвращается.
  it('scale=2 → дефолт fade РОВНО вдвое ближе (эффективный период вдвое мельче)', () => {
    const base = new WaterShader(stubActor())
    const scaled = new WaterShader(stubActor({ waterWaveScale: 2 }))

    expect(scaled.uniforms.uWaterWaveFadeMeters.value).toBeCloseTo(
      (base.uniforms.uWaterWaveFadeMeters.value as number) / 2,
      10
    )
  })

  it('явная ручка waterWaveFadeMeters НЕ делится на scale — автор данных берёт число метров на свою ответственность', () => {
    const withoutScale = new WaterShader(stubActor({ waterWaveFadeMeters: 5000 }))
    const withScale = new WaterShader(stubActor({ waterWaveFadeMeters: 5000, waterWaveScale: 2 }))

    expect(withScale.uniforms.uWaterWaveFadeMeters.value).toBeCloseTo(
      withoutScale.uniforms.uWaterWaveFadeMeters.value as number,
      10
    )
  })
})
