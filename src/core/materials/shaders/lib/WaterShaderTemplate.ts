import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { Color, ShaderChunk, Uniform, UniformsUtils, Vector3 } from 'three'

const defaultUniforms = {
  // «Звезда в нуле» — общедвижковая конвенция (см. BrunetonAtmosphere
  // докблок lightPosition): движок не доставляет позицию светила в
  // материалы, ноль здесь корректен и согласован с терминатором планеты.
  lightPosition: new Uniform(new Vector3()),
  // Канал A slope-карты суши тела (запечённая глубина воды) — та же
  // текстура/путь, что бы читал PlanetMaterial под USE_SLOPE, здесь читается
  // только канал A. null допустим — гейт USE_WATER_DEPTH решает, читать ли.
  uSlopeMap: new Uniform(null),
  uWaterColor: new Uniform(new Color(0x0b3d66)),
  uWaterShallowColor: new Uniform(new Color(0x2e8b9e)),
  uWaterAlphaDeep: new Uniform(0.85),
  uWaterFresnelTint: new Uniform(new Color(0xbfe9ff)),
  // Пол яркости ночной стороны (см. фрагментник ниже) — сверх исходной спеки
  // Task 4, находка №5 финального ревью: было зашито константой без ручки,
  // теперь пятая ручка воды по той же конвенции, что и остальные четыре.
  uWaterNightFloor: new Uniform(0.08)
}

export const WaterShaderTemplate: ShaderProps = {
  // UniformsUtils.merge (не {...defaultUniforms}) — та же конвенция, что
  // PlanetShaderTemplate: клонирует значения (Vector3/Color — новыми
  // экземплярами), не только сам объект-контейнер. Мелкий spread оставлял бы
  // ОДНИ И ТЕ ЖЕ Color/Vector3 инстансы у каждого потребителя шаблона —
  // будущий второй экземпляр WaterShader получил бы алиасинг на юниформы
  // первого (находка ревью Task 4, фикс-раунд 1, №7).
  uniforms: UniformsUtils.merge([defaultUniforms]),
  vertexShader: `
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
  `,
  fragmentShader: `
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
}
