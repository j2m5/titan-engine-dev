import { describe, expect, it } from 'vitest'
import { CubeTexture, ShaderChunk } from 'three'
import { WaterShaderTemplate } from '@/core/materials/shaders/lib/WaterShaderTemplate'
import { WaterMaterial } from '@/core/renderables/Water/WaterMaterial'
import { WaterShader } from '@/core/materials/shaders/WaterShader'
import { Actor } from '@/core/models/Actor'

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

describe('WaterShaderTemplate: отражение — мировые оси (тела вращаются, кубмапа мировая)', () => {
  it('нормаль поворачивается modelMatrix (не normalMatrix — тот view-space, не мировой)', () => {
    expect(frag).toContain('vec3 worldNormal = normalize(mat3(modelMatrix) * waveLocalNormal);')
  })

  it('взгляд — cameraPosition (билдин three) минус vWorldPosition (вершинник, modelMatrix·position)', () => {
    expect(frag).toContain('vec3 toCamera = cameraPosition - vWorldPosition;')
    expect(vert).toContain('vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;')
  })

  it('modelMatrix объявлен явно во фрагментнике (three не биндит его туда автоматически, в отличие от вершинника)', () => {
    expect(frag).toContain('uniform mat4 modelMatrix;')
  })
})

describe('WaterShaderTemplate: дисторсия Water.js — surfaceNormal.xy·(0.001+1/dist)·uWaterDistortion', () => {
  it('формула пином (worldNormal — мировая нормаль волны, аналог surfaceNormal Water.js)', () => {
    expect(frag).toContain('vec3 reflectDir = reflect(-worldViewDir, worldNormal);')
    expect(frag).toContain('reflectDir.xy += worldNormal.xy * (0.001 + 1.0 / dist) * uWaterDistortion;')
  })

  it('dist — мировая дистанция камера-фрагмент (length от cameraPosition-vWorldPosition, не от view-space vViewPosition)', () => {
    expect(frag).toContain('float dist = length(toCamera);')
  })

  it('ручка uWaterDistortion объявлена, не зашитый литерал', () => {
    expect(frag).toContain('uniform float uWaterDistortion;')
  })
})

describe('WaterShaderTemplate: дневной бленд отражения — та же форма терминатора, что ночной пол (третье место)', () => {
  it('reflection = mix(skySample, uWaterFresnelTint, dayFactor)', () => {
    expect(frag).toContain('vec3 skySample = sampleSkyboxHdr(uSkyboxMap, normalize(reflectDir), uSkyFlipX);')
    expect(frag).toContain('waveReflectionSample = mix(skySample, uWaterFresnelTint, dayFactor);')
  })

  it('dayFactor считается той же формулой smoothstep(-0.08, 0.25, NdotL), что ночной пол ниже', () => {
    const matches = frag.match(/smoothstep\(-0\.08, 0\.25, NdotL\)/g) ?? []

    expect(matches.length).toBe(2) // WaterWaves.spec.ts пиннует тот же счёт с той же стороны (парный страж)
  })

  it('блок обособлен в { } — свой NdotL/dayFactor не конфликтует с одноимёнными переменными ночного пола (main() без вложенных scope иначе)', () => {
    expect(frag).toContain('float NdotL = dot(normal, normalize(vViewLightDirection));')
    expect(frag).toContain('float dayFactor = smoothstep(-0.08, 0.25, NdotL);')
  })
})

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

  it('вырезав ТОЛЬКО USE_WATER_REFLECTION (волны остаются) — reflection = тинт Task 1 (waveReflectionSample), без skySample/дневного бленда', () => {
    const stripped = stripGuardedBlock(frag, 'USE_WATER_REFLECTION')

    expect(stripped).toContain('vec3 waveReflectionSample = uWaterFresnelTint;')
    expect(stripped).not.toContain('skySample')
    expect(stripped).not.toContain('uSkyboxMap')
    expect(stripped).not.toContain('worldNormal')
    // Остальная структура волновой ветки Task 1 не тронута (albedo-mix цел)
    expect(stripped).toContain('color = mix(')
    expect(stripped).toContain('waterSunColor * waveDiffuseLight * 0.3 + waveScatter,')
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
