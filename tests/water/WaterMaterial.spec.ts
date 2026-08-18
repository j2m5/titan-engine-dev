import { describe, expect, it, afterEach } from 'vitest'
import { Texture, Vector3 } from 'three'
import { WaterMaterial } from '@/core/renderables/Water/WaterMaterial'
import { WaterShaderTemplate } from '@/core/materials/shaders/lib/WaterShaderTemplate'
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

  it('без карты — константный режим: единый цвет uWaterColor, константная альфа uWaterAlphaDeep', () => {
    expect(frag).toContain('vec3 baseColor = uWaterColor;')
    expect(frag).toContain('float alpha = uWaterAlphaDeep;')
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
})

// Проводка ручек data — образец stubActor (PlanetCavity.spec.ts): объект без
// реальной записи в БД, только то, что читают WaterShader/WaterMaterial.
const SLOPE_PATH = 'stub/water/slope.webp'

interface StubOptions {
  data: Record<string, unknown>
  slopeResource?: boolean
}

function stubActor({ data, slopeResource = true }: StubOptions): Actor {
  return {
    renderingObject: { getAttribute: () => data },
    resources: {
      where: (_field: string, type: string) => ({
        first: () => (type === 'slope' && slopeResource ? { getAttribute: () => SLOPE_PATH } : undefined)
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

describe('WaterMaterial: проводка ручек data (дефолты честно помечены, приёмка вида — за владельцем)', () => {
  it('data пуст — применяются дефолты движка', () => {
    const material = new WaterMaterial(stubActor({ data: {} }))

    expect(material.uniforms.uWaterColor.value.getHex()).toBe(0x0b3d66)
    expect(material.uniforms.uWaterShallowColor.value.getHex()).toBe(0x2e8b9e)
    expect(material.uniforms.uWaterAlphaDeep.value).toBe(0.85)
    expect(material.uniforms.uWaterFresnelTint.value.getHex()).toBe(0xbfe9ff)
  })

  it('ручки data перекрывают дефолты — число и строка цвета обе конвенции (как dustColor кольца)', () => {
    const material = new WaterMaterial(
      stubActor({
        data: {
          waterColor: 0x112233,
          waterShallowColor: '#445566',
          waterAlphaDeep: 0.5,
          waterFresnelTint: 0x778899
        }
      })
    )

    expect(material.uniforms.uWaterColor.value.getHex()).toBe(0x112233)
    expect(material.uniforms.uWaterShallowColor.value.getHex()).toBe(0x445566)
    expect(material.uniforms.uWaterAlphaDeep.value).toBe(0.5)
    expect(material.uniforms.uWaterFresnelTint.value.getHex()).toBe(0x778899)
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
