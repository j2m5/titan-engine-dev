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
  uWaterNightFloor: new Uniform(0.08),
  // Ряд волн (арка water-shader, Task 1) — все пять инертны без
  // USE_WATER_WAVES (гейт по наличию waterNormal-текстуры, см. WaterMaterial):
  // сэмплер null, uTime/scale/fade нулевые заглушки — реальные значения
  // приходят из WaterShader (per-body) и WaterMaterial (per-frame uTime).
  uWaterNormalMap: new Uniform(null),
  uTime: new Uniform(0),
  uWaterWaveScale: new Uniform(0),
  uWaterWaveSpeed: new Uniform(1),
  uWaterWaveFadeMeters: new Uniform(0)
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

    #ifdef USE_WATER_WAVES
      uniform sampler2D uWaterNormalMap;
      uniform float uTime;
      uniform float uWaterWaveScale;
      uniform float uWaterWaveSpeed;
      uniform float uWaterWaveFadeMeters;
      // three не биндит normalMatrix во фрагментник автоматически (см. тот же
      // приём в PlanetShaderTemplate) — юниформ общий на программу, объявление
      // здесь просто делает его видимым этому шейдеру.
      uniform mat3 normalMatrix;

      // Движок не моделирует цвет светила по материалам («звезда в нуле» —
      // тот же принцип, что lightPosition, см. докблок defaultUniforms):
      // sunColor Water.js здесь константа, не юниформ.
      const vec3 waterSunColor = vec3(1.0);

      // getNoise — ДОСЛОВНО структура Water.js (three/examples/jsm/objects/
      // Water.js): 4 выборки по разным периодам/скоростям скролла, сумма,
      // *0.5-1.0 в [-1,1]. Ряд периодов и коэффициенты времени — СВОИ (домен
      // water-shader, метры реальной поверхности, а не абстрактные юниты
      // плоского Water.js): 1500/4500/13500/45000 м (страж кванта — см.
      // WaterWaves.spec.ts, честно поднятый ряд относительно черновика плана
      // 1000/3000/9000/30000 — тот не проходил страж для Земли). Коэффициенты
      // времени пересчитаны так, чтобы фазовая скорость period/T осталась
      // тем же порядком величины, что у Water.js (мелкие октавы ~3-6,
      // крупная ~90-100, средняя ~9-10 доменных единиц/сек) — см. таблицу в
      // task-1-report.md.
      vec4 getNoise(vec2 uv) {
        float t = uTime * uWaterWaveSpeed;
        vec2 uv0 = uv / 1500.0 + vec2(t / 250.0, t / 430.0);
        vec2 uv1 = uv / 4500.0 + vec2(t / -800.0, t / 1300.0);
        vec2 uv2 = uv / 13500.0 + vec2(t / 150.0, t / 140.0);
        vec2 uv3 = uv / 45000.0 + vec2(t / 4500.0, t / -5000.0);
        vec4 noise = texture2D(uWaterNormalMap, uv0) +
          texture2D(uWaterNormalMap, uv1) +
          texture2D(uWaterNormalMap, uv2) +
          texture2D(uWaterNormalMap, uv3);
        return noise * 0.5 - 1.0;
      }

      // sunLight — ДОСЛОВНО Water.js (коэффициенты 100/2/0.5 у вызывающей
      // стороны). sunDirection Water.js — отдельный uniform; здесь читаем
      // vViewLightDirection (общий конвейер света движка, тот же varying,
      // что и остальной WaterShaderTemplate) — единственная адаптация,
      // формула diffuse/specular не тронута.
      void sunLight(const vec3 surfaceNormal, const vec3 eyeDirection, float shiny, float spec, float diffuse, inout vec3 diffuseColor, inout vec3 specularColor) {
        vec3 waterSunDirection = normalize(vViewLightDirection);
        vec3 reflection = normalize(reflect(-waterSunDirection, surfaceNormal));
        float direction = max(0.0, dot(eyeDirection, reflection));
        specularColor += pow(direction, shiny) * waterSunColor * spec;
        diffuseColor += max(dot(waterSunDirection, surfaceNormal), 0.0) * waterSunColor * diffuse;
      }

      // Трипланарная возмущённая нормаль в TBN сферы: T=восток (попиксельно,
      // cross(UP,dir̂) — та же конвенция, что в чанках SlopeNormal.ts/
      // HeightNormal.ts), B=север (cross(dir̂,T), тот же порядок операндов),
      // N=dir̂. Бленд трёх
      // проекций весами |N| (нормированная сумма компонент — проще
      // triplanarWeights^4 астероидной арки, свой маленький код, без
      // зависимости от TriplanarDetail.ts). fade — множитель амплитуды
      // 1→0 (mix к чистому dir̂), считает вызывающая сторона.
      vec3 waterWaveNormal(vec3 dirLocal, float fade) {
        vec3 eastRaw = cross(vec3(0.0, 1.0, 0.0), dirLocal);
        float eastLen = length(eastRaw);
        if (eastLen < 1e-4) return dirLocal; // полюс: тангенс вырожден

        vec3 T = eastRaw / eastLen;
        vec3 B = cross(dirLocal, T);

        vec3 w = abs(dirLocal);
        w /= max(w.x + w.y + w.z, 1e-6);

        vec3 p = dirLocal * uWaterWaveScale;
        vec4 noise = getNoise(p.zy) * w.x + getNoise(p.xz) * w.y + getNoise(p.xy) * w.z;

        // Дословно surfaceNormal Water.js (noise.xzy * vec3(1.5,1.0,1.5)),
        // перенесённое в TBN: x-компонента (вес 1.5) — вдоль T, z-компонента
        // (вес 1.0) — вдоль N (была "верхом" плоского мира), y-компонента
        // (вес 1.5) — вдоль B.
        vec3 perturbed = normalize(T * (noise.x * 1.5) + dirLocal * (noise.z * 1.0) + B * (noise.y * 1.5));

        return normalize(mix(dirLocal, perturbed, fade));
      }
    #endif

    void main() {
      ${ShaderChunk['logdepthbuf_fragment']}

      vec3 normal = normalize(vNormal);
      vec3 viewDir = normalize(vViewPosition);

      #ifdef USE_WATER_WAVES
        // Fade по дистанции камера-поверхность: 1 у поверхности, 0 дальше
        // uWaterWaveFadeMeters (CPU уже перевёл ручку из метров в юниты сцены,
        // см. WaterShader) — та же схема начала fade (0.4×конец), что
        // uDetailFadeRange террейна (TerrainDetail.ts), здесь без отдельного
        // юниформа старта: только конец — ручка, начало зашито.
        float waveDist = length(vViewPosition);
        float waveFade = 1.0 - smoothstep(0.4 * uWaterWaveFadeMeters, uWaterWaveFadeMeters, waveDist);
        vec3 waveDirLocal = normalize(vLocalDir);
        vec3 waveLocalNormal = waterWaveNormal(waveDirLocal, waveFade);
        // Единственный normalMatrix-переход — та же конвенция, что
        // PlanetShaderTemplate.USE_TERRAIN_UV: пертурбация целиком в
        // тело-локальном пространстве, поворот в view — самым последним шагом.
        normal = normalize(normalMatrix * waveLocalNormal);
      #endif

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

      #ifdef USE_WATER_WAVES
        // Albedo Water.js ДОСЛОВНО (getShadowMask опущен — теней в движке
        // нет, см. докблок класса): reflectance по Шлику (rf0=0.3),
        // scatter — рассеяние в толще по уже посчитанному baseColor
        // (мелководье/константа сохранены — тот же вход, что у fresnel-mix
        // выше), reflectionSample — тинт Task 4 (Task 2 подменит источник
        // на честную выборку кубмапы неба).
        vec3 waveDiffuseLight = vec3(0.0);
        vec3 waveSpecularLight = vec3(0.0);
        sunLight(normal, viewDir, 100.0, 2.0, 0.5, waveDiffuseLight, waveSpecularLight);

        float waveTheta = max(dot(viewDir, normal), 0.0);
        float waveRf0 = 0.3;
        float waveReflectance = waveRf0 + (1.0 - waveRf0) * pow((1.0 - waveTheta), 5.0);
        vec3 waveScatter = max(0.0, dot(normal, viewDir)) * baseColor;
        vec3 waveReflectionSample = uWaterFresnelTint;
        color = mix(
          waterSunColor * waveDiffuseLight * 0.3 + waveScatter,
          vec3(0.1) + waveReflectionSample * 0.9 + waveReflectionSample * waveSpecularLight,
          waveReflectance
        );
      #endif

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
