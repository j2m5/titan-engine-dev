import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { Color, ShaderChunk, Uniform, UniformsUtils, Vector3 } from 'three'
import { createSkyboxSampleUniforms } from '@/core/materials/shaders/lib/chunks/SkyboxSample'
import { SpaceScale } from '@/core/constants'

// Юниты сцены → метры (арка water-shader, Task 2, находка ревью фикс-раунда
// 1 №1): дисторсия Water.js писана для сцены В МЕТРАХ (0.001 + 1/distance,
// distance — метры), у нас 1 юнит сцены ≈ 1995 км (см. SpaceScale) — без
// перевода добавка на 4-5 порядков превышала единичный вектор reflectDir,
// normalize() переставал зависеть от взгляда вовсе. 1000 — км в метре,
// SpaceScale — юниты сцены на км (см. scaling.ts toThreeJSUnits).
const WATER_METERS_PER_UNIT = 1000 / SpaceScale

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
  uWaterWaveFadeMeters: new Uniform(0),
  // Отражение фоновой кубмапы (арка water-shader, Task 2) — инертно без
  // USE_WATER_REFLECTION (гейт по факту доставки кубмапы, см. WaterMaterial):
  // сэмплер null до конструктора материала, дисторсия — честная ручка (см.
  // IPlanetRenderingObject.waterDistortion). Набор ручек общей выборки фона
  // (highlight/floor/gain/flip) — тот же `createSkyboxSampleUniforms`, что и
  // SkyboxBackground/BlackHole, ЖЕЛЕЗНЫЙ констрейнт: сэмплировать фон можно
  // только через этот общий чанк (см. её докблок про uSkyFlipX).
  uSkyboxMap: new Uniform(null),
  uWaterDistortion: new Uniform(20),
  ...createSkyboxSampleUniforms()
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
      // *0.5-1.0 в [-1,1]. Октавы 2/3 АНИЗОТРОПНЫ (vec2 на ось), как и у
      // Water.js (vec2(8907,9803)/vec2(1091,1027)) — фикс-раунд 1, №4:
      // скаляр ломает пропорцию читаемой плитки, часть структуры оригинала.
      // Ряд периодов и коэффициенты времени — СВОИ (домен water-shader,
      // метры реальной поверхности, а не абстрактные юниты плоского
      // Water.js): 3000/9000/[25736.53,28325.50]/[92761.91,87320.33] м —
      // страж кванта считает по мельчайшему СКАЛЯРУ (3000, октава 0), см.
      // WaterWaves.spec.ts. Ряд честно поднят дважды: план предлагал
      // 1000/3000/9000/30000 (не проходил страж для Земли на бумаге), первая
      // реализация — 1500/4500/13500/45000 (не проходила страж для
      // ФАКТИЧЕСКОГО ассета 1024×1024 — страж в Task-1 был на 512 текселей
      // литералом, находка ревью Task 1 фикс-раунд 1 №1); нынешний ряд
      // (×2 от той реализации) даёт +28.8% запаса для Земли на реальных 1024
      // текселях, страж теста читает N текселей из фактического файла
      // ассета, не литералом. Анизотропные пары получены геометрическим
      // средним = прежнему скалярному значению октавы (25736.53×28325.50=
      // 27000², 92761.91×87320.33=90000²) — сохраняет эффективный масштаб
      // плитки при переходе скаляр→пара. Коэффициенты времени пересчитаны
      // так, чтобы фазовая скорость period/T осталась тем же порядком
      // величины, что у Water.js (мелкие октавы ~3-6, крупная ~85-100,
      // средняя ~9-10 доменных единиц/сек) — см. таблицу в task-1-report.md
      // (знаки октав 1/3 у нас ЗЕРКАЛЬНЫ Water.js, не совпадают — там же).
      vec4 getNoise(vec2 uv) {
        float t = uTime * uWaterWaveSpeed;
        vec2 uv0 = uv / 3000.0 + vec2(t / 500.0, t / 860.0);
        vec2 uv1 = uv / 9000.0 + vec2(t / -1600.0, t / 2600.0);
        vec2 uv2 = uv / vec2(25736.53, 28325.50) + vec2(t / 300.0, t / 280.0);
        vec2 uv3 = uv / vec2(92761.91, 87320.33) + vec2(t / 9000.0, t / -10000.0);
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

      // Трипланарная возмущённая нормаль — фикс-раунд 1, №2: прежняя версия
      // блендила .x/.y/.z ТРЁХ проекций (разных осей!) в одну (T,B,N)-тройку
      // ПОСЛЕ суммирования — наивно, компоненты складывались вдоль общего T
      // не будучи в одной системе координат. Верно — реориентация КАЖДОЙ
      // проекции в общий body-локальный XYZ ДО суммирования: тот же порядок
      // свизлов, что triplanarBlendNormal (chunks/TriplanarDetail.ts,
      // whiteout Ben Golus) — X-проекция (p.zy) → .zyx, Y-проекция (p.xz) →
      // .xzy (это ДОСЛОВНО одноплоскостная формула Water.js — она и есть
      // Y-facing случай, world.xz + up=world.y), Z-проекция (p.xy) → .xyz.
      // Каждая тройка домножена на Water.js веса (1.5 — тангенциальные оси
      // проекции, 1.0 — ось up этой проекции), итог — прямой аналог
      // triplanarBlendNormal.return (tx.zyx*w.x+ty.xzy*w.y+tz.xyz*w.z), уже
      // в body-локальном XYZ (той же системе, что dirLocal), без отдельной
      // T/B/N-конверсии для бленда. Полный whiteout chunk'а (+n.zy/xz/xy до
      // свизла) НЕ переносим: он компенсирует «почти плоскую» (0,0,1)
      // семантику ДЕКОДИРОВАННОЙ карты нормалей (tex*2-1, z≈1 у некрутых
      // мест); наш getNoise — суммарный шумовой сигнал Water.js (сумма 4
      // выборок *0.5-1.0), не декод тангенциальной карты, — добавка n была
      // бы произвольной, не имеющей той же математической опоры.
      //
      // Полюсный гард (eastLen<1e-4, круг ~636 м у полюса Земли) — НЕ
      // трогаем (рулинг контроллера, фикс-раунд 1, №8): та же граница, что
      // SlopeNormal/HeightNormal. T/B полюсного фрейма сам больше не нужен
      // (реориентация теперь в XYZ, не TBN), но порог остаётся — дешёвый
      // ранний выход у полюса, поведение принято как есть.
      vec3 waterWaveNormal(vec3 dirLocal, float fade) {
        vec3 eastRaw = cross(vec3(0.0, 1.0, 0.0), dirLocal);
        float eastLen = length(eastRaw);
        if (eastLen < 1e-4) return dirLocal; // полюс: тангенс вырожден

        vec3 w = abs(dirLocal);
        w /= max(w.x + w.y + w.z, 1e-6);

        vec3 p = dirLocal * uWaterWaveScale;
        vec3 fromX = getNoise(p.zy).zyx * vec3(1.0, 1.5, 1.5);
        vec3 fromY = getNoise(p.xz).xzy * vec3(1.5, 1.0, 1.5);
        vec3 fromZ = getNoise(p.xy).xyz * vec3(1.5, 1.5, 1.0);

        vec3 perturbed = normalize(fromX * w.x + fromY * w.y + fromZ * w.z);

        return normalize(mix(dirLocal, perturbed, fade));
      }

      // Отражение фоновой кубмапы (арка water-shader, Task 2) — ВЛОЖЕНО в
      // USE_WATER_WAVES (не сиблинг-блок): отражению нечего отражать без
      // возмущённой нормали волн (waveLocalNormal, см. main ниже), и
      // паритетный тест (WaterReflection.spec.ts) снимает ровно
      // USE_WATER_REFLECTION целиком, ожидая байт-в-байт Task 1 у остального.
      #ifdef USE_WATER_REFLECTION
        uniform samplerCube uSkyboxMap;
        uniform float uWaterDistortion;
        // three не биндит modelMatrix во фрагментник автоматически (тот же
        // приём, что normalMatrix выше) — нужен для мировой ориентации
        // возмущённой нормали (тела вращаются, кубмапа мировая). ВАЖНО: не
        // заводить мировой varying позиции фрагмента, как в первой версии
        // (снят находкой ревью фикс-раунда 1 №2) — умножение модельной
        // матрицы на позицию вершины в f32 несёт полную гелиоцентрическую
        // координату (Земля на 1 а.е.: ulp ≈ 14 км), а последующее вычитание
        // из мировой позиции камеры — катастрофическое сокращение вплоть до
        // нулевого вектора. Взгляд/дистанция ниже считаются из УЖЕ
        // RTC-безопасных view-space величин (сам взгляд и посчитанная
        // раньше waveDist — camera-relative, не полноразрядные мировые
        // координаты), мировые направления получаются ЧИСТЫМ поворотом
        // (mat3(modelMatrix) для нормали, transpose(mat3(viewMatrix)) для
        // взгляда) — не переносом начала координат.
        uniform mat4 modelMatrix;

        // Юниты сцены → метры (см. её докблок вверху файла) — дисторсия
        // Water.js писана для метров, не для юнитов сцены (~1995 км/юнит).
        const float WATER_METERS_PER_UNIT = ${WATER_METERS_PER_UNIT};

        #include <skyboxSampleUniforms>
        #include <skyboxSampleFunctions>
      #endif
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
        #ifdef USE_WATER_REFLECTION
        {
          // Отражение фоновой кубмапы (Task 2) — МИРОВЫЕ оси, БЕЗ мировых
          // координат на GPU (находка ревью фикс-раунда 1 №2: первая версия
          // заводила варьинг мировой позиции фрагмента — умножение модельной
          // матрицы на позицию вершины в f32 несёт полную гелиоцентрическую
          // координату, а вычитание из мировой позиции камеры давало
          // катастрофическое сокращение вплоть до нулевого вектора). Нормаль
          // — поворот mat3(modelMatrix) (тела вращаются); взгляд — уже
          // RTC-безопасный view-space viewDir, повёрнутый в мир через
          // transpose(mat3(viewMatrix)) (viewMatrix биндит three сам;
          // обратная матрица чистого поворота = транспонированная, дешевле
          // inverse()).
          vec3 worldNormal = normalize(mat3(modelMatrix) * waveLocalNormal);
          vec3 worldViewDir = transpose(mat3(viewMatrix)) * viewDir;

          // dist — уже посчитанный waveDist (length(vViewPosition), тоже
          // camera-relative), переведённый в метры: формула дисторсии
          // Water.js писана для сцены В МЕТРАХ (находка ревью фикс-раунда 1
          // №1) — без перевода добавка была на 4-5 порядков больше
          // единичного reflectDir, отражение переставало зависеть от взгляда.
          float distMeters = waveDist * WATER_METERS_PER_UNIT;

          // Дисторсия — тангенциальное отклонение волны от базового
          // радиального направления, а НЕ произвольный срез мировой нормали
          // по двум осям (находка ревью фикс-раунда 1 №3: такой срез несёт
          // саму радиальную/несущую компоненту нормали — сила искажения
          // гуляла бы 0..1 по долготе относительно мировой оси Z). dev —
          // проекция waveLocalNormal на тангентную плоскость к waveDirLocal
          // (обе единичные — отклонение только от шума волны, малое и
          // изотропное по построению, честный аналог тангенциальной
          // компоненты нормали карты Water.js без несущей оси "up").
          vec3 dev = waveLocalNormal - waveDirLocal * dot(waveLocalNormal, waveDirLocal);
          vec3 worldDev = mat3(modelMatrix) * dev;

          vec3 reflectDir = reflect(-worldViewDir, worldNormal);
          reflectDir += worldDev * (0.001 + 1.0 / max(distMeters, 1e-6)) * uWaterDistortion;

          vec3 skySample = sampleSkyboxHdr(uSkyboxMap, normalize(reflectDir), uSkyFlipX);

          // Дневной бленд — та же форма терминатора (порог/ширина), что и
          // ночной пол ниже — см. WaterReflection.spec.ts. Блок обособлен в
          // { }: main() этого шейдера не заводит вложенных областей
          // видимости, а без неё определение NdotL/lightDirection
          // столкнулось бы с одноимёнными переменными ночного пола ниже
          // (та же функция main) — форма записи намеренно идентична ей.
          vec3 lightDirection = normalize(vViewLightDirection);
          float NdotL = dot(normal, lightDirection);
          float dayFactor = smoothstep(-0.08, 0.25, NdotL);

          waveReflectionSample = mix(skySample, uWaterFresnelTint, dayFactor);
        }
        #endif
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
