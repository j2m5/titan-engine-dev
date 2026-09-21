import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { Color, ShaderChunk, Uniform, UniformsUtils, Vector2, Vector3 } from 'three'
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
  // «Звезда в нуле» — общедвижковая конвенция (см. AtmosphereEffect.fillSlot:
  // sunDir = normalize(−centerWorld)): движок не доставляет позицию светила в
  // материалы, ноль здесь корректен и согласован с терминатором планеты.
  lightPosition: new Uniform(new Vector3()),
  uLightColor: new Uniform(new Color(1, 1, 1)),
  // Канал A slope-карты суши тела (запечённая глубина воды) — та же
  // текстура/путь, что бы читал PlanetMaterial под USE_SLOPE, здесь читается
  // только канал A. null допустим — гейт USE_WATER_DEPTH решает, читать ли.
  uSlopeMap: new Uniform(null),
  uWaterColor: new Uniform(new Color(0x0b3d66)),
  uWaterShallowColor: new Uniform(new Color(0x2e8b9e)),
  uWaterAlphaDeep: new Uniform(0.85),
  // 0x4a8ac4 — приёмочная волна 4, №1: прежний 0x87b8d8 (приёмочная волна 2)
  // читался серовато — насыщенный синий класса «яркий дневной океан» (см.
  // WaterShader.ts докблок DEFAULT_WATER_FRESNEL_TINT, оба места держат одно
  // значение — паритетный тест). Дефолт ПОД ПРИЁМКУ, финальный цвет — за
  // владельцем.
  uWaterFresnelTint: new Uniform(new Color(0x4a8ac4)),
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
  // Пена прибоя — инертна без USE_WATER_WAVES && USE_WATER_DEPTH: strength 0,
  // ширины — положительные заглушки (знаменатели), тексель карты и радиус —
  // от материала при приходе slope-карты (WaterMaterial.updateMaterial).
  uFoamStrength: new Uniform(0),
  uFoamShoreMeters: new Uniform(1),
  uFoamSurfStrength: new Uniform(0),
  uFoamSurfMeters: new Uniform(2),
  uFoamWavelengthMeters: new Uniform(1),
  uFoamPeriod: new Uniform(1),
  uFoamNoiseScale: new Uniform(1),
  uFoamColor: new Uniform(new Color(0xe6e9ec)),
  uFoamRadiusMeters: new Uniform(1),
  uSlopeTexel: new Uniform(new Vector2()),
  // vec2: u-тексель (экваториальный, сжимается на cos широты) и v-тексель
  // (постоянный) — равнопрямоугольная сетка терраформного UV несёт разные
  // метры на тексель по осям (см. блок пены во фрагментнике).
  uSlopeTexelMeters: new Uniform(new Vector2()),
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
    varying vec3 vLocalLightDirection;
    varying vec3 vViewPosition;
    varying vec3 vLocalDir;

    // Водная оболочка — всегда патчи кубосферы (тот же TerrainPatchPool, что и
    // у рельефа): атрибут normal снят, центр патча приходит инстансным
    // атрибутом (один элемент на патч), гейта не нужно.
    attribute vec3 patchCenter;

    void main() {
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mvPosition;

      // Направление ОТ солнца к фрагменту в body-локальных осях — вход μ_s
      // тинта заката (см. фрагментник): те же строки, что у палубы
      // (PlanetShaderTemplate), парный строковый страж в тестах.
      vec3 worldLightDirection = normalize(worldPosition.xyz - lightPosition);
      vec3 localLightDirection = transpose(mat3(modelMatrix)) * worldLightDirection;
      vec4 viewLightDirection = viewMatrix * vec4(lightPosition, 1.0);

      // Нормаль воды = dir̂ (аналитическая, не из карты): патчи водной
      // оболочки строит то же ядро buildTerrainPatchArrays, что и рельеф —
      // направление вершины радиально всегда и восстанавливается из
      // RTC-позиции и центра патча (см. terrainPatchGeometry.ts), волны
      // и рябь наклоняют нормаль во фрагментнике (waveNormal), не здесь.
      // vNormal — уже готовый view-space dir̂ для Френеля во фрагментнике.
      //
      // Body-локальное радиальное направление — отдельно, для терраформного
      // UV (канал A той же slope-карты, что и суша): та же конвенция vLocalDir,
      // что у PlanetShaderTemplate — без матриц, тот же vertexDir.
      vec3 vertexDir = normalize(position + patchCenter);

      vNormal = normalize(normalMatrix * vertexDir);
      vLocalDir = vertexDir;
      vViewLightDirection = normalize(viewLightDirection.xyz - mvPosition.xyz);
      vLocalLightDirection = localLightDirection;
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

    #ifdef USE_SUN_TINT
      #include <sunTransmittanceUniforms>
    #endif

    varying vec3 vNormal;
    varying vec3 vViewLightDirection;
    varying vec3 vLocalLightDirection;
    varying vec3 vViewPosition;
    varying vec3 vLocalDir;

    #ifdef USE_WATER_DEPTH
      #include <terrainUvFunctions>
    #endif

    #ifdef USE_SUN_TINT
      #include <sunTransmittanceFunctions>
    #endif

    #ifdef USE_WATER_WAVES
      uniform sampler2D uWaterNormalMap;
      uniform float uTime;
      uniform float uWaterWaveScale;
      uniform float uWaterWaveSpeed;
      uniform float uWaterWaveFadeMeters;
      // Пена прибоя (внутри USE_WATER_WAVES: время, шум и fade — общие с волнами)
      uniform float uFoamStrength;
      uniform float uFoamShoreMeters;
      uniform float uFoamSurfStrength;
      uniform float uFoamSurfMeters;
      uniform float uFoamWavelengthMeters;
      uniform float uFoamPeriod;
      uniform float uFoamNoiseScale;
      uniform vec3 uFoamColor;
      uniform float uFoamRadiusMeters;
      uniform vec2 uSlopeTexel;
      uniform vec2 uSlopeTexelMeters;
      // Смещение уреза в текселях: суша клампит канал A в 0, билинейный скат
      // начинается на полтекселя раньше берега — на урезе оценка dist = texel/3
      #define FOAM_SHORE_BIAS 0.3333333
      // Контраст шума рвани: канал .x нормалей волн узкий вокруг 0.5
      #define FOAM_NOISE_CONTRAST 1.5
      // Рвань — модуляция плотности каймы в [1 − FOAM_TEAR, 1], не вырезание до нуля:
      // на текселе 5–9 км дыры в каймe читались как клочья, а не как пена
      #define FOAM_TEAR 0.5
      // three не биндит normalMatrix во фрагментник автоматически (см. тот же
      // приём в PlanetShaderTemplate) — юниформ общий на программу, объявление
      // здесь просто делает его видимым этому шейдеру.
      uniform mat3 normalMatrix;

      // Приёмочная волна 3, №1 (владелец: звёздная сыпь на ночном океане —
      // кубмапа выключена решением владельца, см. докблок-рулинг в
      // WaterMaterial.ts) — modelMatrix/uWaterDistortion раньше жили только
      // под USE_WATER_REFLECTION; дневной "небесный" градиент (skyColor,
      // приёмочная волна 2) переехал в БЕЗУСЛОВНУЮ часть USE_WATER_WAVES —
      // он читает только геометрию отражённого луча, кубмапу не сэмплирует
      // вовсе, поэтому больше не завязан на гейт отражения.
      uniform mat4 modelMatrix;
      uniform float uWaterDistortion;

      // Юниты сцены → метры (см. её докблок вверху файла) — дисторсия
      // Water.js писана для метров, не для юнитов сцены (~1995 км/юнит).
      const float WATER_METERS_PER_UNIT = ${WATER_METERS_PER_UNIT};

      // Приёмочная волна 2, №1 (владелец: молочная вода на подлёте) —
      // дневное "небо" было плоским uWaterFresnelTint на всю полусферу
      // (0.1 + reflection·0.9 при waveReflectance→1 на скользящем взгляде
      // давало почти-белый цвет ВЕЗДЕ, не только у горизонта, где реальное
      // небо реально светлеет). Затемнение зенита — константа, не ручка
      // (YAGNI, владелец явно просил не плодить): 0.35 — тот же порядок,
      // что типичное отношение яркости зенита к горизонту ясного неба.
      const float ZENITH_DARKEN = 0.35;

      // Цвет светила приходит только при подписке лайттинта (lightTintOf) —
      // иначе, как и раньше, белый: sunColor Water.js здесь константа по умолчанию.
      #ifdef USE_LIGHT_TINT
        uniform vec3 uLightColor;
        #define waterSunColor uLightColor
      #else
        const vec3 waterSunColor = vec3(1.0);
      #endif

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
      // в body-локальном XYZ (той же системе, что dirLocal).
      //
      // getNoise — ДЕКОД усреднённой карты нормалей, не «сырой шумовой
      // сигнал» (фикс финального whole-branch ревью, №2 — прежняя
      // формулировка здесь была ложной): sum(4 выборки)·0.5−1.0 ≡
      // mean(2·выборка_i−1) — алгебраически то же самое, что декодировать
      // КАЖДУЮ из 4 выборок стандартной формулой tex·2−1 и усреднить
      // результат. Ассет (waternormals.jpg) — настоящая тангенциальная
      // карта нормалей, её B-канал (несущая «почти вверх» z-компонента)
      // статистически смещён к сильно положительному: замер mean(R,G,B)/255
      // = (0.498, 0.498, 0.983) → decoded mean ≈ (−0.004, −0.004, +0.965).
      //
      // Отсюда и знаковая часть whiteout chunk'а (abs(tx.z) * n.x —
      // несущая компонента домножается на ЗНАК геометрической нормали по
      // ЭТОЙ оси): без него несущая компонента любой проекции была бы
      // ВСЕГДА положительна (тот самый смещённый к +z ассет), и на
      // октантах, где dirLocal отрицателен по соответствующей оси,
      // реориентированный вектор указывал бы «в мир», а не «наружу» —
      // БЛОКЕР финального ревью, №1 (7 из 8 октантов давали угол 167–176°
      // между perturbed и dirLocal; theta=dot(viewDir,normal)=0 гасил
      // scatter/diffuse Water.js целиком; на границе fade — normalize(mix(
      // dirLocal, perturbed, ~0.5)) двух почти противоположных единичных
      // векторов давал длину ≈0 — NaN-кольцо на дистанции fade, замерено
      // 926-2316 км). Фикс — axisSign = sign(dirLocal), несущая
      // компонента каждой проекции домножается на СВОЮ ось: fromX.x умножен
      // на axisSign.x, fromY.y — на axisSign.y, fromZ.z — на axisSign.z
      // (после фикса угол 3.2-14.5° на всех проверенных направлениях, см.
      // страж WaterWaves.spec.ts). Полный whiteout +n.zy/xz/xy
      // (сложение тангенциальных компонент с геометрической нормалью) НЕ
      // переносим — тангенциальные R/G-каналы ассета центрированы у нуля
      // (примерно 0.004), добавка была бы произвольной; переносим ровно
      // знаковую часть — минимально необходимую для ЭТОГО (blue-смещённого) ассета.
      //
      // Полюсный гард (eastLen<1e-4, круг ~636 м у полюса Земли) — НЕ
      // трогаем (рулинг контроллера, фикс-раунд 1, №8): та же граница, что
      // SlopeNormal. T/B полюсного фрейма сам больше не нужен
      // (реориентация теперь в XYZ, не TBN), но порог остаётся — дешёвый
      // ранний выход у полюса, поведение принято как есть.
      vec3 waterWaveNormal(vec3 dirLocal, float fade) {
        vec3 eastRaw = cross(vec3(0.0, 1.0, 0.0), dirLocal);
        float eastLen = length(eastRaw);
        if (eastLen < 1e-4) return dirLocal; // полюс: тангенс вырожден

        vec3 w = abs(dirLocal);
        w /= max(w.x + w.y + w.z, 1e-6);

        vec3 p = dirLocal * uWaterWaveScale;
        vec3 axisSign = sign(dirLocal);
        vec3 fromX = getNoise(p.zy).zyx * vec3(1.0, 1.5, 1.5) * vec3(axisSign.x, 1.0, 1.0);
        vec3 fromY = getNoise(p.xz).xzy * vec3(1.5, 1.0, 1.5) * vec3(1.0, axisSign.y, 1.0);
        vec3 fromZ = getNoise(p.xy).xyz * vec3(1.5, 1.5, 1.0) * vec3(1.0, 1.0, axisSign.z);

        vec3 perturbed = normalize(fromX * w.x + fromY * w.y + fromZ * w.z);

        return normalize(mix(dirLocal, perturbed, fade));
      }

      // Скаляр рваности пены: трипланар по осям тела в домене p (dir·R/period,
      // как у волн; домен считает вызывающий — ему нужен его экранный след),
      // канал .x текстуры нормалей волн — новых сэмплеров нет.
      float foamNoise(vec3 dirLocal, vec3 p) {
        vec3 w = abs(dirLocal);
        w /= max(w.x + w.y + w.z, 1e-6);
        float nx = texture2D(uWaterNormalMap, p.zy).x;
        float ny = texture2D(uWaterNormalMap, p.xz).x;
        float nz = texture2D(uWaterNormalMap, p.xy).x;
        return nx * w.x + ny * w.y + nz * w.z;
      }

      // Отражение фоновой кубмапы (арка water-shader, Task 2) —
      // ЗАКОНСЕРВИРОВАНО решением владельца (2026-08-19, приёмочная волна
      // 3, №1): ночная кубмапа давала звёздную сыпь — HDR-звёзды,
      // размазанные grazing-дисторсией отражённого луча, читались яркими
      // кляксами по тёмному океану. Материал больше НЕ ставит
      // USE_WATER_REFLECTION (см. докблок-рулинг в WaterMaterial.ts) —
      // вернуть можно одной строкой там же; код и доставка skyboxTexture из
      // RenderableFactory НЕ разобраны — обратимость. Геометрия отражённого
      // луча (worldNormal/reflectDir/дисторсия) и дневной "небесный"
      // градиент (skyColor, приёмочная волна 2) переехали в БЕЗУСЛОВНУЮ
      // часть USE_WATER_WAVES выше — они кубмапу не читают, здесь остаётся
      // только сам сэмпл.
      #ifdef USE_WATER_REFLECTION
        uniform samplerCube uSkyboxMap;

        #include <skyboxSampleUniforms>
        #include <skyboxSampleFunctions>
      #endif
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

      #ifdef USE_SUN_TINT
        // Тинт только дневной составляющей — ночной пол uWaterNightFloor
        // остаётся, как у палубы; минус — vLocalLightDirection от солнца.
        vec3 sunTintFactor = mix(vec3(1.0), sunTint(dot(normalize(vLocalDir), -normalize(vLocalLightDirection))), uSunTintStrength);
      #endif

      // Ночная сторона темнее, не чёрная: вода не светится сама, но полный
      // ноль на терминаторе неправдоподобен (рассеянный свет неба/атмосферы).
      // Терминатор — та же зона, что у PlanetShaderTemplate (эстетическая
      // консистентность суши/воды); ночной пол — ручка uWaterNightFloor
      // (дефолт 0.08, честно помеченный), приёмка вида — за владельцем.
      vec3 lightDirection = normalize(vViewLightDirection);
      float NdotL = dot(normal, lightDirection);
      float dayFactor = smoothstep(-0.08, 0.25, NdotL);
      #ifdef USE_SUN_TINT
        color *= mix(vec3(uWaterNightFloor), sunTintFactor, dayFactor);
      #else
        color *= mix(uWaterNightFloor, 1.0, dayFactor);
      #endif

      #ifdef USE_WATER_WAVES
        // На этом месте (снаружи этого #ifdef) color — ПОЛНОСТЬЮ готовый
        // фундаментный цвет (Task 4, byte-в-byte тот же, что и без
        // USE_WATER_WAVES — см. паритетный тест): фундамент/ночной пол
        // выше ни разу не тронуты этой правкой, только точка, где им дают
        // говорить последнее слово, сдвинута сюда.
        //
        // Fade по дистанции камера-поверхность: 1 у поверхности, 0 дальше
        // uWaterWaveFadeMeters (CPU уже перевёл ручку из метров в юниты сцены,
        // см. WaterShader) — та же схема начала fade (0.4×конец), что
        // uDetailFadeRange террейна (TerrainDetail.ts), здесь без отдельного
        // юниформа старта: только конец — ручка, начало зашито.
        float waveDist = length(vViewPosition);
        float waveFade = 1.0 - smoothstep(0.4 * uWaterWaveFadeMeters, uWaterWaveFadeMeters, waveDist);
        vec3 waveDirLocal = normalize(vLocalDir);
        vec3 waveLocalNormal = waterWaveNormal(waveDirLocal, waveFade);
        // СВОЙ вектор waveNormal, не общий normal (приёмочный фикс —
        // владелец: молочный океан по всему диску + яркое пятно в центре +
        // голубое гало за лимбом на скрине из космоса, см. докблок ниже).
        // Раньше эта строка ПЕРЕЗАПИСЫВАЛА общий normal, и вся waves-
        // формула цвета считалась НА НЁМ безусловно; normal теперь
        // остаётся аналитическим dir̂ (тем же, что у фундамента выше),
        // единственный normalMatrix-переход применяется к своей переменной.
        vec3 waveNormal = normalize(normalMatrix * waveLocalNormal);

        // Терминатор waveNormal — общий для дневного бленда отражения (если
        // USE_WATER_REFLECTION) И для собственного ночного пола waves-цвета
        // ниже: одна величина, не пересчитывается дважды. lightDirection
        // уже посчитан выше (фундаментный блок) — тот же вектор, повторно
        // не заводим.
        float waveNdotL = dot(waveNormal, lightDirection);
        float waveDayFactor = smoothstep(-0.08, 0.25, waveNdotL);

        // Albedo Water.js ДОСЛОВНО (getShadowMask опущен — теней в движке
        // нет, см. докблок класса): reflectance по Шлику (rf0=0.3),
        // scatter — рассеяние в толще по уже посчитанному baseColor
        // (мелководье/константа сохранены — тот же вход, что у fresnel-mix
        // выше), reflectionSample — градиентное небо зенит/горизонт (кубмапа
        // отключена рулингом, см. USE_WATER_REFLECTION).
        vec3 waveDiffuseLight = vec3(0.0);
        vec3 waveSpecularLight = vec3(0.0);
        sunLight(waveNormal, viewDir, 100.0, 2.0, 0.5, waveDiffuseLight, waveSpecularLight);

        float waveTheta = max(dot(viewDir, waveNormal), 0.0);
        float waveRf0 = 0.3;
        float waveReflectance = waveRf0 + (1.0 - waveRf0) * pow((1.0 - waveTheta), 5.0);
        vec3 waveScatter = max(0.0, dot(waveNormal, viewDir)) * baseColor;

        // Приёмочная волна 4, №2 — тот же паттерн alpha→1 на скользящем
        // взгляде, что и у фундамента выше, но по waveReflectance (волновая
        // нормаль, не аналитическая dir̂): reflectance держит физический пол
        // waveRf0=0.3 даже в надир (theta=1), где alpha не должна расти —
        // вычитаем пол и перенормируем на его дополнение, оставляя чистый
        // grazing-прогресс: (waveReflectance-waveRf0)/(1-waveRf0) ≡
        // pow(1-waveTheta,5) алгебраически (та же форма Френеля), явная
        // форма через reflectance — чтобы не заводить второй независимый
        // pow5 по другому входу.
        float waveGrazing = (waveReflectance - waveRf0) / (1.0 - waveRf0);
        float waveAlpha = mix(depthAlpha, 1.0, waveGrazing);
        alpha = mix(alpha, waveAlpha, waveFade);

        // Геометрия отражённого луча — МИРОВЫЕ оси, БЕЗ мировых координат на
        // GPU (находка ревью фикс-раунда 1 №2: первая версия заводила
        // варьинг мировой позиции фрагмента — умножение модельной матрицы на
        // позицию вершины в f32 несёт полную гелиоцентрическую координату, а
        // вычитание из мировой позиции камеры давало катастрофическое
        // сокращение вплоть до нулевого вектора). Нормаль — поворот
        // mat3(modelMatrix) (тела вращаются); взгляд — уже RTC-безопасный
        // view-space viewDir, повёрнутый в мир через transpose(mat3(
        // viewMatrix)) (viewMatrix биндит three сам; обратная матрица
        // чистого поворота = транспонированная, дешевле inverse()).
        // БЕЗУСЛОВНО с приёмочной волны 3 (кубмапа исключена решением
        // владельца, №1, звёздная сыпь) — эта геометрия кубмапу не читает,
        // нужна только дневному градиенту ниже, который теперь тоже
        // безусловен.
        vec3 worldNormal = normalize(mat3(modelMatrix) * waveLocalNormal);
        vec3 worldViewDir = transpose(mat3(viewMatrix)) * viewDir;

        // dist — уже посчитанный waveDist (length(vViewPosition), тоже
        // camera-relative), переведённый в метры: формула дисторсии
        // Water.js писана для сцены В МЕТРАХ (находка ревью фикс-раунда 1
        // №1) — без перевода добавка была на 4-5 порядков больше единичного
        // reflectDir, отражение переставало зависеть от взгляда.
        float distMeters = waveDist * WATER_METERS_PER_UNIT;

        // Дисторсия — тангенциальное отклонение волны от базового
        // радиального направления, а НЕ произвольный срез мировой нормали по
        // двум осям (находка ревью фикс-раунда 1 №3: такой срез несёт саму
        // радиальную/несущую компоненту нормали — сила искажения гуляла бы
        // 0..1 по долготе относительно мировой оси Z). dev — проекция
        // waveLocalNormal на тангентную плоскость к waveDirLocal (обе
        // единичные — отклонение только от шума волны, малое и изотропное по
        // построению, честный аналог тангенциальной компоненты нормали карты
        // Water.js без несущей оси "up").
        vec3 dev = waveLocalNormal - waveDirLocal * dot(waveLocalNormal, waveDirLocal);
        vec3 worldDev = mat3(modelMatrix) * dev;

        vec3 reflectDir = reflect(-worldViewDir, worldNormal);
        reflectDir += worldDev * (0.001 + 1.0 / max(distMeters, 1e-6)) * uWaterDistortion;

        // Дневное "небо" — градиент по высоте отражённого луча, не плоский
        // uWaterFresnelTint на всю полусферу (приёмочная волна 2, №1:
        // владелец увидел молочную воду на подлёте — при скользящем взгляде
        // waveReflectance→1, и albedo≈0.1+reflection·0.9 читало ЕДИНСТВЕННЫЙ
        // плоский цвет по всему диску, а не посветление к горизонту, как у
        // настоящего неба). Зенит фрагмента — waveDirLocal (аналитический
        // dir̂, НЕ возмущённая волнами waveLocalNormal — «где верх» не должно
        // дрожать от ряби), повёрнутый в мир тем же mat3(modelMatrix), что и
        // worldNormal. upFactor=1 — луч смотрит в зенит (тёмное небо,
        // ZENITH_DARKEN·tint), upFactor=0 — луч смотрит к горизонту (светлый
        // tint как есть — больше воздуха на луче в реальном небе, горизонт
        // светлее зенита).
        //
        // Приёмочная волна 3, №1: reflection воды — ТОЛЬКО этот градиент,
        // ДЕНЬ И НОЧЬ, без сэмпла кубмапы вовсе (ночная кубмапа давала
        // звёздную сыпь — HDR-звёзды, размазанные grazing-дисторсией
        // reflectDir, читались яркими кляксами по тёмному океану). Ночная
        // темнота — не от day/night-бленда reflection (того больше нет), а
        // от общего ночного пола waves-цвета ниже (wavesColor *=
        // mix(uWaterNightFloor,...)) — та же логика, что у фундамента.
        vec3 worldZenith = normalize(mat3(modelMatrix) * waveDirLocal);
        float upFactor = clamp(dot(normalize(reflectDir), worldZenith), 0.0, 1.0);
        vec3 skyColor = mix(uWaterFresnelTint, uWaterFresnelTint * ZENITH_DARKEN, upFactor);
        vec3 waveReflectionSample = skyColor;

        #ifdef USE_WATER_REFLECTION
        {
          // ЗАКОНСЕРВИРОВАНО решением владельца (см. докблок-декларацию
          // выше) — материал больше не ставит этот гейт, блок мёртв по
          // умолчанию. Если понадобится вернуть кубмапу: этот mix заменит
          // безусловное присваивание waveReflectionSample=skyColor выше на
          // честный день/ночь бленд, как было в приёмочной волне 2.
          vec3 skySample = sampleSkyboxHdr(uSkyboxMap, normalize(reflectDir), uSkyFlipX);

          waveReflectionSample = mix(skySample, skyColor, waveDayFactor);
        }
        #endif

        // Приёмочная волна 4, №1 (владелец: дневная вода слишком СЕРАЯ) —
        // Water.js слагаемое vec3(0.1) в albedo-миксе было вкладом
        // ЗЕРКАЛЬНОЙ СЦЕНЫ (ambient окружения демо three.js: комната/небо в
        // отражении зеркала-пола). У нас зеркала нет — плоская серая
        // константа обесцвечивала весь дневной альбедо к нейтральному серому
        // вместо тона неба. Адаптация: тот же вклад, но тонированный
        // градиентным skyColor (уже посчитан выше, тот же зенит/горизонт,
        // что и у reflection) — 0.1·skyColor, не vec3(0.1).
        vec3 wavesColor = mix(
          waterSunColor * waveDiffuseLight * 0.3 + waveScatter,
          // Блик — белый waterSunColor, не отражённое небо: у Water.js
          // reflectionSample несёт солнце, у нас это константный голубой
          // градиент, и глинт выходил голубым.
          0.1 * skyColor + waveReflectionSample * 0.9 + waterSunColor * waveSpecularLight,
          waveReflectance
        );
        // Свой ночной пол waves-цвета (waveDayFactor, НЕ общий dayFactor
        // фундамента) — та же форма терминатора (парный строковый страж),
        // другой NdotL (waveNormal, не аналитический normal): без этого
        // при waveFade=0 равенство фундаменту держалось бы только на
        // спекуляре/reflectance, а не на цвете целиком.
        #ifdef USE_SUN_TINT
          wavesColor *= mix(vec3(uWaterNightFloor), sunTintFactor, waveDayFactor);
        #else
          wavesColor *= mix(uWaterNightFloor, 1.0, waveDayFactor);
        #endif

        // ПРИЁМОЧНЫЙ ФИКС (владелец: молочный океан по всему диску + яркое
        // пятно в центре диска + голубое гало за лимбом на скрине из
        // космоса). Корень: fade раньше гасил ТОЛЬКО возмущение нормали
        // (waterWaveNormal сама честно деградирует в dir̂ при waveFade→0,
        // см. её докблок) — но СОСТАВ ФОРМУЛЫ ЦВЕТА оставался waves-веткой
        // безусловно (простая перезапись color= на любой дистанции).
        // Water.js reflectance держит пол 0.3 (0.3 + 0.7·pow5(1-theta)) —
        // минимум 30% тинта/отражения даже в надир (theta=1), где
        // фундаментный pow5-Френель даёт ≈0 — отсюда молочность ВСЕГО диска
        // с орбиты. sunLight-спекуляр pow100 по гладкой (fade→dir̂) сфере
        // давал концентрированное яркое пятно ровно там, где отражение
        // солнца совпадает со взглядом (в фундаменте спекуляра нет вовсе).
        // Спека §2: «за fade-порогом вода деградирует РОВНО в базовый вид
        // фундамента — дальний план не меняется вовсе» — было нарушено.
        //
        // Фикс — смешивание ДВУХ ПОЛНОСТЬЮ ГОТОВЫХ цветов (оба уже несут
        // СВОЙ ночной пол): color здесь — фундаментный (посчитан ВЫШЕ,
        // byte-в-byte тем же путём, что и без USE_WATER_WAVES, см.
        // паритетный тест), wavesColor — полная формула Water.js. При
        // waveFade=0.0 mix(color, wavesColor, 0.0) РОВНО равен
        // фундаментному color (IEEE mix: a·(1−0)+b·0=a), НЕЗАВИСИМО от
        // wavesColor — спекуляр/reflectance-надбавка растут строго от fade
        // (за порогом — нулевой вклад в смеси по построению самого mix, не
        // по случайному совпадению). Непрерывность по fade — color,
        // wavesColor и сам waveFade непрерывны каждый по отдельности
        // (smoothstep/mix/dot/pow — гладкие функции, дублирующихся веток
        // нет), значит непрерывен и итог, разрыва ни на пороге, ни в
        // середине. Двойного счёта тинта нет: mix — ВЫПУКЛАЯ комбинация
        // (не сумма) двух самодостаточных цветов; waveReflectionSample
        // дважды входит В ПРЕДЕЛАХ ОДНОЙ формулы Water.js (база отражения +
        // тон спекуляра) — так задумано оригиналом, это не удвоение с
        // фундаментным Френель-тинтом снаружи (тот в wavesColor не входит
        // вовсе, живёт только в color-ветке до этого mix).
        color = mix(color, wavesColor, waveFade);

        #ifdef USE_WATER_DEPTH
          // Гейт юниформный (однородный поток: fwidth и выборки ниже определены);
          // тела с выключенной пеной и до прихода карты не платят ни одной выборки
          if (uFoamStrength > 0.0 && uSlopeTexelMeters.y > 0.0) {
            // Расстояние до уреза — из глубины и её градиента по метру:
            // dist = depth/|∇depth|, диапазон обмеления сокращается. Плоское
            // дно: градиент под полом → dist → ∞, пены нет.
            float a0 = depthA;
            float aE = texture2D(uSlopeMap, uv + vec2(uSlopeTexel.x, 0.0)).a;
            float aS = texture2D(uSlopeMap, uv - vec2(0.0, uSlopeTexel.y)).a; // юг = −v; нужна только длина
            // метры текселя: u сжимается на cos(широты) (у полюсов кламп), v — постоянный
            float cosLat = max(sqrt(max(1.0 - dirLocal.y * dirLocal.y, 0.0)), 0.05);
            vec2 texelM = vec2(uSlopeTexelMeters.x * cosLat, uSlopeTexelMeters.y);
            vec2 gradM = vec2(aE - a0, aS - a0) / texelM;                 // прирост A на метр
            float gradLen = max(length(gradM), 1e-4 / uSlopeTexelMeters.y); // пол: 1e-4 на тексель, как раньше
            float dist = a0 / gradLen;
            // тексель вдоль градиента: смещение уреза (texel/3) считается по нему
            float texelAlong = gradLen / max(length(gradM / texelM), 1e-12);
            dist = max(dist - FOAM_SHORE_BIAS * texelAlong, 0.0);
            float distFootprint = fwidth(dist);
            float foamWeight = (1.0 - smoothstep(0.5, 1.0, distFootprint / uFoamShoreMeters)) * waveFade;
            float t = uTime / uFoamPeriod;
            float shore = 1.0 - smoothstep(0.0, uFoamShoreMeters * (1.0 + 0.15 * sin(6.2832 * t)), dist);
            float phase = dist / uFoamWavelengthMeters + t;   // гребни (фаза = const) бегут к берегу: dist = λ(n − t)
            float crest = pow(1.0 - abs(fract(phase) * 2.0 - 1.0), 6.0);
            float surfEnv = smoothstep(uFoamShoreMeters * 0.5, uFoamShoreMeters, dist)
                          * (1.0 - smoothstep(uFoamSurfMeters * 0.6, uFoamSurfMeters, dist));
            float surf = crest * surfEnv * uFoamSurfStrength;
            // Домен шума: период вдвое шире каймы, медленный дрейф по t. Вдали
            // (период тоньше ~2 px) шум стягивается к среднему — крупы и мерцания нет
            vec3 pNoise = dirLocal * (uFoamRadiusMeters / max(2.0 * uFoamShoreMeters * uFoamNoiseScale, 1e-3)) + vec3(0.05 * t);
            float noiseWeight = 1.0 - smoothstep(0.5, 1.0, length(fwidth(pNoise)));
            float noise = mix(0.5, foamNoise(dirLocal, pNoise), noiseWeight);
            noise = clamp((noise - 0.5) * FOAM_NOISE_CONTRAST + 0.5, 0.0, 1.0); // канал .x нормалей узкий вокруг 0.5
            float foam = clamp(shore + surf, 0.0, 1.0);
            // рвань: плотность каймы гуляет в [1 − FOAM_TEAR, 1]; сплошная кайма рвётся меньше гребней
            foam *= mix(1.0 - FOAM_TEAR, 1.0, smoothstep(0.3, 0.7, noise + 0.3 * foam));
            foam *= uFoamStrength * foamWeight;
            // пена освещена так же, как wavesColor (её ночной пол/тинт) — не сырой цвет поверх темноты
            #ifdef USE_SUN_TINT
              vec3 foamLit = uFoamColor * mix(vec3(uWaterNightFloor), sunTintFactor, waveDayFactor);
            #else
              vec3 foamLit = uFoamColor * mix(uWaterNightFloor, 1.0, waveDayFactor);
            #endif
            // после готового цвета волн: спекуляр и отражение под пеной гаснут самим mix
            color = mix(color, foamLit, foam);
            alpha = max(alpha, foam);
          }
        #endif
      #endif

      gl_FragColor = vec4(color, alpha);

      ${ShaderChunk['tonemapping_fragment']}
      ${ShaderChunk['colorspace_fragment']}
    }
  `
}
