import { describe, expect, it, afterEach, vi } from 'vitest'
import { Texture, Vector3 } from 'three'
import { WaterMaterial } from '@/core/renderables/Water/WaterMaterial'
import { WaterShaderTemplate } from '@/core/materials/shaders/lib/WaterShaderTemplate'
import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'

// Строковые ассерты шаблона — контракт брифа Task 4: Френель, декод канала A
// напрямую [0,1] (Task 1, без множителя SLOPE_RANGE и без знаковой byte-128
// перекодировки R/G/B), гейт USE_WATER_DEPTH, переиспользование общего чанка
// terrainUvFunctions (не копия PlanetShaderTemplate).
describe('WaterShaderTemplate: строковые ассерты (Френель, декод канала A, гейт мелководья)', () => {
  const frag: string = WaterShaderTemplate.fragmentShader
  const vert: string = WaterShaderTemplate.vertexShader

  it('гейт USE_WATER_DEPTH переключает мелководье', () => {
    expect(frag).toContain('#ifdef USE_WATER_DEPTH')
  })

  it('терраформный uv переиспользован из общего чанка, формула не задублирована инлайн', () => {
    expect(frag).toContain('#include <terrainUvFunctions>')
    expect(frag).not.toContain('float phi = atan(dirLocal.z, -dirLocal.x);')
  })

  it('канал A декодируется НАПРЯМУЮ [0,1] — без множителя SLOPE_RANGE и без byte-128 перекодировки R/G/B/cavity', () => {
    expect(frag).toContain('texture2D(uSlopeMap, uv).a')
    expect(frag).not.toContain('.a * 255.0 - 128.0')
    expect(frag).not.toContain('SLOPE_RANGE')
  })

  it('мелководье: mix(shallow -> deep) по каналу A', () => {
    expect(frag).toContain('mix(uWaterShallowColor, uWaterColor, depthA)')
  })

  it('альфа урезается к нулю на урезе: uWaterAlphaDeep * depthA', () => {
    expect(frag).toContain('uWaterAlphaDeep * depthA')
  })

  it('без карты — константный режим: единый цвет uWaterColor, базовая альфа uWaterAlphaDeep (до grazing-подъёма)', () => {
    expect(frag).toContain('vec3 baseColor = uWaterColor;')
    expect(frag).toContain('float depthAlpha = uWaterAlphaDeep;')
  })

  it('Френель Шлика-класса: pow(1 - max(dot(viewDir, normal), 0), 5)', () => {
    expect(frag).toContain('float fresnel = pow(1.0 - max(dot(viewDir, normal), 0.0), 5.0);')
  })

  it('итоговый цвет смешивается к тинту по Френелю', () => {
    expect(frag).toContain('mix(baseColor, uWaterFresnelTint, fresnel)')
  })

  it('ночная сторона темнее по N·L, не гасится в ноль (терминатор тот же, что у PlanetShaderTemplate)', () => {
    expect(frag).toContain('smoothstep(-0.08, 0.25, NdotL)')
  })

  it('ночной пол — ручка uWaterNightFloor, не зашитая константа (находка №5 финального ревью)', () => {
    expect(frag).toContain('uniform float uWaterNightFloor;')
    expect(frag).toContain('color *= mix(uWaterNightFloor, 1.0, dayFactor);')
  })

  it('лог-депт подключён на обоих концах (та же логарифмическая глубина, что у патчей суши) — ${ShaderChunk[...]} разворачивается на этапе шаблонной строки JS, не #include', () => {
    expect(vert).toContain('USE_LOGARITHMIC_DEPTH_BUFFER')
    expect(vert).toContain('vFragDepth = 1.0 + gl_Position.w;')
    expect(frag).toContain('USE_LOGARITHMIC_DEPTH_BUFFER')
    expect(frag).toContain('gl_FragDepth')
  })

  it('нормаль воды — аналитическая dir̂: vNormal из радиального атрибута normal, без карт возмущения', () => {
    expect(vert).toContain('vNormal = normalize(normalMatrix * normal);')
    expect(frag).not.toContain('perturbNormalFromSlope')
    expect(frag).not.toContain('perturbNormalFromHeight')
  })

  it('«звезда в нуле»: lightPosition — юниформ, инициализированный нулевым вектором (не обновляется рантаймом движка)', () => {
    expect(WaterShaderTemplate.uniforms.lightPosition.value).toEqual(new Vector3())
  })

  // Ревью Task 4 (фикс-раунд 1, №3): те же константы, что пиннует
  // FragmentUv.spec.ts для суши — общий чанк terrainUvFunctions, разъехаться
  // между потребителями формула не может, но каждый потребитель проверяется
  // отдельно (шаблоны разворачиваются независимо). Мутация M2 (обмен 2π ↔ π
  // в TerrainUv.ts) валит и этот тест — проверено вручную вместе с
  // FragmentUv.spec.ts, откат восстанавливает GREEN.
  it('константы разворотов запиннены и в водном фрагментнике (общий чанк terrainUvFunctions)', () => {
    const resolvedFrag = AbstractShader.prepareSource(frag)

    expect(resolvedFrag).toContain('phi / 6.28318530717958647692')
    expect(resolvedFrag).toContain('/ 3.14159265358979323846')
  })
})

// Проводка ручек data — образец stubActor (PlanetCavity.spec.ts): объект без
// реальной записи в БД, только то, что читают WaterShader/WaterMaterial.
const SLOPE_PATH = 'stub/water/slope.webp'
const WATER_NORMAL_PATH = 'stub/water/waternormals.webp'

interface StubOptions {
  data: Record<string, unknown>
  slopeResource?: boolean
  waterNormalResource?: boolean
}

function stubActor({ data, slopeResource = true, waterNormalResource = false }: StubOptions): Actor {
  return {
    renderingObject: { getAttribute: () => data },
    // Детей нет — тело без атмосферы, проводка тинта (SunTintBinding) молчит.
    children: { where: () => ({ first: () => undefined, isNotEmpty: () => false }) },
    resources: {
      where: (_field: string, type: string) => ({
        first: () => {
          if (type === 'slope' && slopeResource) return { getAttribute: () => SLOPE_PATH }
          if (type === 'waterNormal' && waterNormalResource) return { getAttribute: () => WATER_NORMAL_PATH }

          return undefined
        }
      })
    }
  } as unknown as Actor
}

function seedSlopeTexture(): void {
  const texture = new Texture()
  texture.name = SLOPE_PATH
  texture.image = { width: 4, height: 2 }
  resourceStorage.addTexture(texture)
}

function seedWaterNormalTexture(): void {
  const texture = new Texture()
  texture.name = WATER_NORMAL_PATH
  texture.image = { width: 4, height: 2 }
  resourceStorage.addTexture(texture)
}

describe('WaterMaterial: проводка ручек data (дефолты честно помечены, приёмка вида — за владельцем)', () => {
  it('data пуст — применяются дефолты движка', () => {
    const material = new WaterMaterial(stubActor({ data: {} }))

    expect(material.uniforms.uWaterColor.value.getHex()).toBe(0x0b3d66)
    expect(material.uniforms.uWaterShallowColor.value.getHex()).toBe(0x2e8b9e)
    expect(material.uniforms.uWaterAlphaDeep.value).toBe(0.85)
    expect(material.uniforms.uWaterFresnelTint.value.getHex()).toBe(0x4a8ac4) // приёмочная волна 4, №1 — насыщеннее/синее (был 0x87b8d8, читался серовато)
    expect(material.uniforms.uWaterNightFloor.value).toBe(0.08)
  })

  it('ручки data перекрывают дефолты — число и строка цвета обе конвенции (как dustColor кольца)', () => {
    const material = new WaterMaterial(
      stubActor({
        data: {
          waterColor: 0x112233,
          waterShallowColor: '#445566',
          waterAlphaDeep: 0.5,
          waterFresnelTint: 0x778899,
          waterNightFloor: 0.2
        }
      })
    )

    expect(material.uniforms.uWaterColor.value.getHex()).toBe(0x112233)
    expect(material.uniforms.uWaterShallowColor.value.getHex()).toBe(0x445566)
    expect(material.uniforms.uWaterAlphaDeep.value).toBe(0.5)
    expect(material.uniforms.uWaterFresnelTint.value.getHex()).toBe(0x778899)
    expect(material.uniforms.uWaterNightFloor.value).toBe(0.2)
  })

  it('контракт материала WaterSphere: transparent, depthWrite=false, depthTest=true (див. WaterSphere.spec.ts)', () => {
    const material = new WaterMaterial(stubActor({ data: {} }))

    expect(material.transparent).toBe(true)
    expect(material.depthWrite).toBe(false)
    expect(material.depthTest).toBe(true)
  })
})

describe('WaterMaterial: гейт USE_WATER_DEPTH из slope-текстуры актора (resourceStorage)', () => {
  afterEach(() => resourceStorage.deleteAllTextures())

  it('у актора нет slope-ресурса вовсе — константный режим', () => {
    const material = new WaterMaterial(stubActor({ data: {}, slopeResource: false }))
    material.updateMaterial()

    expect(material.defines.USE_WATER_DEPTH).toBeUndefined()
    expect(material.uniforms.uSlopeMap.value).toBeNull()
  })

  it('slope-путь у актора есть, но текстура ещё не догрузилась в resourceStorage — константный режим', () => {
    const material = new WaterMaterial(stubActor({ data: {} }))
    material.updateMaterial()

    expect(material.defines.USE_WATER_DEPTH).toBeUndefined()
    expect(material.uniforms.uSlopeMap.value).toBeNull()
  })

  it('slope-текстура доступна в resourceStorage — гейт ставится, сэмплер получает текстуру', () => {
    seedSlopeTexture()
    const material = new WaterMaterial(stubActor({ data: {} }))
    material.updateMaterial()

    expect(material.defines.USE_WATER_DEPTH).toBe('1')
    expect(material.uniforms.uSlopeMap.value).not.toBeNull()
  })

  it('перекомпиляция случается только на ФАКТИЧЕСКОЙ смене гейта — не на каждом вызове', () => {
    // three.js Material.needsUpdate — сеттер-инкремент без геттера (читается
    // как undefined всегда), поэтому наблюдаем через .version — он растёт
    // РОВНО когда needsUpdate=true фактически присваивался.
    seedSlopeTexture()
    const material = new WaterMaterial(stubActor({ data: {} }))
    material.updateMaterial() // первая догрузка текстуры — гейт меняется false→true
    expect(material.defines.USE_WATER_DEPTH).toBe('1')

    const versionAfterGate = material.version
    material.updateMaterial() // текстура та же, гейт остаётся true — без перекомпиляции
    expect(material.version).toBe(versionAfterGate)
  })

  it('resetMaterial снимает гейт и сэмплер', () => {
    seedSlopeTexture()
    const material = new WaterMaterial(stubActor({ data: {} }))
    material.updateMaterial()

    material.resetMaterial()

    expect(material.defines.USE_WATER_DEPTH).toBeUndefined()
    expect(material.uniforms.uSlopeMap.value).toBeNull()
  })
})

// Task 1 (арка water-shader): USE_WATER_WAVES — независимый гейт от
// USE_WATER_DEPTH выше, тот же ленивый стрим-паттерн (путь кешируется в
// конструкторе, текстура резолвится из resourceStorage каждый updateMaterial).
describe('WaterMaterial: гейт USE_WATER_WAVES из waterNormal-текстуры актора (resourceStorage)', () => {
  afterEach(() => resourceStorage.deleteAllTextures())

  it('у актора нет waterNormal-ресурса вовсе — без дефайна, сэмплер null', () => {
    const material = new WaterMaterial(stubActor({ data: {} }))
    material.updateMaterial()

    expect(material.defines.USE_WATER_WAVES).toBeUndefined()
    expect(material.uniforms.uWaterNormalMap.value).toBeNull()
  })

  it('waterNormal-путь у актора есть, но текстура ещё не догрузилась — без дефайна', () => {
    const material = new WaterMaterial(stubActor({ data: {}, waterNormalResource: true }))
    material.updateMaterial()

    expect(material.defines.USE_WATER_WAVES).toBeUndefined()
    expect(material.uniforms.uWaterNormalMap.value).toBeNull()
  })

  it('waterNormal-текстура доступна в resourceStorage — гейт ставится, сэмплер получает текстуру', () => {
    seedWaterNormalTexture()
    const material = new WaterMaterial(stubActor({ data: {}, waterNormalResource: true }))
    material.updateMaterial()

    expect(material.defines.USE_WATER_WAVES).toBe('1')
    expect(material.uniforms.uWaterNormalMap.value).not.toBeNull()
  })

  it('гейт USE_WATER_WAVES не зависит от USE_WATER_DEPTH — оба одновременно, независимо', () => {
    seedSlopeTexture()
    seedWaterNormalTexture()
    const material = new WaterMaterial(stubActor({ data: {}, waterNormalResource: true }))
    material.updateMaterial()

    expect(material.defines.USE_WATER_DEPTH).toBe('1')
    expect(material.defines.USE_WATER_WAVES).toBe('1')
  })

  it('перекомпиляция случается только на ФАКТИЧЕСКОЙ смене гейта волн — не на каждом вызове', () => {
    seedWaterNormalTexture()
    const material = new WaterMaterial(stubActor({ data: {}, waterNormalResource: true }))
    material.updateMaterial() // первая догрузка текстуры — гейт меняется false→true
    expect(material.defines.USE_WATER_WAVES).toBe('1')

    const versionAfterGate = material.version
    material.updateMaterial() // текстура та же, гейт остаётся true — без перекомпиляции
    expect(material.version).toBe(versionAfterGate)
  })

  it('resetMaterial снимает гейт волн и сэмплер', () => {
    seedWaterNormalTexture()
    const material = new WaterMaterial(stubActor({ data: {}, waterNormalResource: true }))
    material.updateMaterial()

    material.resetMaterial()

    expect(material.defines.USE_WATER_WAVES).toBeUndefined()
    expect(material.uniforms.uWaterNormalMap.value).toBeNull()
  })

  it('uTime = elapsed из updateMaterial(elapsed), не performance.now() (фикс-раунд 1, №3: источник — UpdateContext.elapsed)', () => {
    const material = new WaterMaterial(stubActor({ data: {} }))

    material.updateMaterial(1000)
    expect(material.uniforms.uTime.value).toBe(1000)

    material.updateMaterial(5000) // ни один гейт не менялся (waterNormal-ресурса нет вовсе) — ранний return ниже по методу, uTime всё равно продвигается
    expect(material.uniforms.uTime.value).toBe(5000)
  })

  it('updateMaterial() без аргумента НЕ трогает uTime (события стримера не сбрасывают фазу волн)', () => {
    const material = new WaterMaterial(stubActor({ data: {} }))

    material.updateMaterial(1234)
    material.updateMaterial() // путь materialSync: гейты перечитать, время — не наше дело

    expect(material.uniforms.uTime.value).toBe(1234)
  })
})

// Ревью Task 4 (фикс-раунд 1, №1): resources.where(...) — ORM-джойн
// belongsToMany (actorResource × resources), не бесплатный лукап. updateMaterial
// зовётся КАЖДЫЙ активный кадр (WaterSphere.onVisibleUpdate) — гонять джойн
// там означало бы полный ORM-проход на каждое видимое водное тело каждый
// кадр. Путь обязан резолвиться РОВНО один раз в конструкторе и переживать
// сколько угодно кадровых updateMaterial() без повторного обращения к
// resources; resetMaterial — редкий путь (вытеснение диффуза), там повтор
// допустим и даже полезен (свежит путь).
describe('WaterMaterial: slope-путь резолвится один раз (не ORM-джойн на каждый кадр)', () => {
  afterEach(() => resourceStorage.deleteAllTextures())

  function stubActorWithSpy(): { actor: Actor; whereSpy: ReturnType<typeof vi.fn> } {
    const whereSpy = vi.fn((_field: string, type: string) => ({
      first: () => (type === 'slope' ? { getAttribute: () => SLOPE_PATH } : undefined)
    }))
    const actor = {
      renderingObject: { getAttribute: () => ({}) },
      // Отдельная коллекция от resources — счётчик джойна ресурсов её не видит.
      children: { where: () => ({ first: () => undefined, isNotEmpty: () => false }) },
      resources: { where: whereSpy }
    } as unknown as Actor

    return { actor, whereSpy }
  }

  it('resources.where зовётся дважды в конструкторе (slope + waterNormal, Task 1), НЕ на каждый updateMaterial()', () => {
    seedSlopeTexture()
    const { actor, whereSpy } = stubActorWithSpy()

    const material = new WaterMaterial(actor)
    expect(whereSpy).toHaveBeenCalledTimes(2)

    material.updateMaterial()
    material.updateMaterial()
    material.updateMaterial()

    // ни один кадровый updateMaterial не тронул resources — джойн не повторён
    expect(whereSpy).toHaveBeenCalledTimes(2)
    expect(material.defines.USE_WATER_DEPTH).toBe('1') // сам гейт при этом работает штатно
  })

  it('resetMaterial освежает оба пути — второй (и только второй) раунд вызовов resources.where', () => {
    const { actor, whereSpy } = stubActorWithSpy()
    const material = new WaterMaterial(actor)
    expect(whereSpy).toHaveBeenCalledTimes(2)

    material.resetMaterial()
    expect(whereSpy).toHaveBeenCalledTimes(4)

    material.updateMaterial()
    material.updateMaterial()
    expect(whereSpy).toHaveBeenCalledTimes(4) // после resetMaterial кадровые вызовы всё ещё не трогают resources
  })
})

// Находка №6 финального ревью water-foundation: дефолты воды продублированы
// в двух независимых местах — WaterShaderTemplate.defaultUniforms (шаблон,
// на деле не участвует в рантайме WaterShader, см. её докблок) и
// WaterShader.DEFAULT_* (фактически применяются при пустом data). Ничто их
// не сцепляет — правка одного места молча расходится с другим. Тест-паритет
// (тот же приём, что у планетных материалов — шаблон и рантайм-дефолт
// обязаны совпадать) ловит именно расхождение, не механизм подстановки.
describe('WaterShaderTemplate ↔ WaterShader: паритет дефолтов (находка №6 финального ревью)', () => {
  it('пять ручек воды: значение из WaterShaderTemplate.uniforms совпадает с дефолтом WaterShader при пустом data', () => {
    const material = new WaterMaterial(stubActor({ data: {} }))
    const templateUniforms = WaterShaderTemplate.uniforms

    expect(material.uniforms.uWaterColor.value.getHex()).toBe(templateUniforms.uWaterColor.value.getHex())
    expect(material.uniforms.uWaterShallowColor.value.getHex()).toBe(templateUniforms.uWaterShallowColor.value.getHex())
    expect(material.uniforms.uWaterAlphaDeep.value).toBe(templateUniforms.uWaterAlphaDeep.value)
    expect(material.uniforms.uWaterFresnelTint.value.getHex()).toBe(templateUniforms.uWaterFresnelTint.value.getHex())
    expect(material.uniforms.uWaterNightFloor.value).toBe(templateUniforms.uWaterNightFloor.value)
  })

  // Расширение Task 2 (арка water-shader): дисторсия отражения — та же
  // ловушка, что и остальные пять ручек (два независимых места дефолта,
  // ничто их не сцепляет само по себе, см. докблок выше).
  it('uWaterDistortion: значение из WaterShaderTemplate.uniforms совпадает с дефолтом WaterShader при пустом data', () => {
    const material = new WaterMaterial(stubActor({ data: {} }))
    const templateUniforms = WaterShaderTemplate.uniforms

    expect(material.uniforms.uWaterDistortion.value).toBe(templateUniforms.uWaterDistortion.value)
  })
})

// Task 3 (арка water-shader): смоук на РЕАЛЬНОЙ БД — предыдущие гейт-тесты
// выше стабят resources.where целиком (WaterMaterial.spec.ts исторически не
// зависел от строк БД, см. stubActor), Task 1/2 писаны и приняты на стабах.
// Теперь путь waterNormal приходит из ФАКТИЧЕСКИХ строк resources.ts/
// actorResource.ts (Task 3) — этот блок проверяет, что резолвер
// (WaterMaterial.resolveWaterNormalPath) находит ресурс через настоящий
// Actor.find(...).resources ORM-джойн, не только через стаб. Текстура
// стабится (ассет может отсутствовать на диске у CI/чужой машины, см. её
// докблок в task-3-brief.md) — тест данных, не тест загрузчика.
describe('WaterMaterial: рантайм-связка с реальной БД (Task 3) — резолвер находит waterNormal по фактическим строкам', () => {
  afterEach(() => resourceStorage.deleteAllTextures())

  function seedResidentWaterNormalStub(path: string): Texture {
    const texture = new Texture()
    texture.name = path
    texture.image = { width: 4, height: 2 }
    resourceStorage.addTexture(texture)

    return texture
  }

  it('Земля (actorId 7): реальная строка БД резолвится, стаб резидентной текстуры включает USE_WATER_WAVES', () => {
    const earth = Actor.find(7)!
    const path = earth.resources.where('resourceType', 'waterNormal').first()!.getAttribute('path') as string
    const texture = seedResidentWaterNormalStub(path)

    const material = new WaterMaterial(earth)
    material.updateMaterial()

    expect(material.defines.USE_WATER_WAVES).toBe('1')
    expect(material.uniforms.uWaterNormalMap.value).toBe(texture)
    // радиус Земли (physicalObjects.ts) должен дойти до uWaterWaveScale через тот же путь, что Task 1
    expect(material.uniforms.uWaterWaveScale.value).toBeCloseTo(6360000, 6)
  })

  it('Явин IV (actorId 83): та же проверка — второй водный актор', () => {
    const yavin = Actor.find(83)!
    const path = yavin.resources.where('resourceType', 'waterNormal').first()!.getAttribute('path') as string
    const texture = seedResidentWaterNormalStub(path)

    const material = new WaterMaterial(yavin)
    material.updateMaterial()

    expect(material.defines.USE_WATER_WAVES).toBe('1')
    expect(material.uniforms.uWaterNormalMap.value).toBe(texture)
    expect(material.uniforms.uWaterWaveScale.value).toBeCloseTo(6100000, 6)
  })
})
