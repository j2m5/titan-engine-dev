import { IUniform, Matrix4, Texture, Uniform, Vector2, Vector3 } from 'three'
import { BlackHoleParameters } from '@/core/renderables/BlackHole/BlackHoleParameters'
import { config } from '@/core/framework/config'
import { createSkyboxSampleUniforms } from '@/core/materials/shaders/lib/chunks/SkyboxSample'

/**
 * Шейдер чёрной дыры, этап 3: лензирование Шварцшильда + аккреционный диск
 *
 * Лензирование (этапы 2 и 4): уравнение Бине u''(φ) = −u + (3/2)·u² (rs = 1),
 * velocity Verlet по углу φ; для далёких лучей — LUT отклонения, запечённый
 * тем же интегратором и тем же dphi (обе ветки сходят в ноль на границе зоны)
 *
 * Диск (этап 3) — ТОНКИЙ: математическая плоскость, сэмплируемая в точках
 * пересечения геодезической с экваториальной плоскостью, front-to-back
 * накопление (до 4 видимых пересечений: прямое изображение, нижнее
 * лензированное, вклады фотонного кольца). Никакого объёмного марширования
 *
 * Шейдинг пересечения: профиль Шакуры–Сюняева T(r) = T_in·(r/r_in)^(−3/4),
 * аналитический планковский blackbody, доплер по ЛОКАЛЬНОМУ направлению
 * изогнутого луча (beaming I·δ^3 + сдвиг температуры), грав. покраснение
 * √(1−rs/r), дифференциальное вращение ω ∝ r^(−3/2) с двухслойным
 * кроссфейдом против намотки спирали
 *
 * Эмиссия диска пишется в HDR (> 1.0) — Bloom композера подхватывает её
 * по порогу 1.0; фон после общей sampleSkyboxHdr (подъём + расширение
 * хайлайтов) тоже способен превысить 1.0 и блумить сам
 */

/**
 * Фабрика uniforms — каждый материал получает собственные экземпляры
 * (защита от разделяемых Uniform-ссылок при спреде шаблона)
 */
export function createBlackHoleUniforms(parameters: BlackHoleParameters): Record<string, IUniform> {
  return {
    // ВАЖНО: имена crModelViewMatrix/crProjectionMatrix — не косметика.
    // WebGLRenderer безусловно перезаписывает uniforms с зарезервированными
    // именами (modelViewMatrix, projectionMatrix, modelMatrix, cameraPosition...)
    // своими значениями на каждом draw call, даже для RawShaderMaterial —
    // camera-relative матрицы с такими именами никогда не доедут до GPU
    crModelViewMatrix: new Uniform(new Matrix4()),
    crProjectionMatrix: new Uniform(new Matrix4()),
    localCameraPos: new Uniform(new Vector3()),
    logDepthBufFC: new Uniform(1),

    /** Перевод: объектные единицы Three.js → единицы rsVisual */
    invRsUnits: new Uniform(1 / parameters.rsVisualUnits),
    /** Перевод: единицы rsVisual → объектные единицы Three.js */
    rsUnits: new Uniform(parameters.rsVisualUnits),

    /** Радиус зоны симуляции в единицах rsVisual */
    simulationRs: new Uniform(parameters.simulationRs),

    /** Плоскость диска: нормаль и базис (из axialTilt), радиусы в единицах rsVisual */
    diskNormal: new Uniform(new Vector3(0, 1, 0)),
    diskTangentX: new Uniform(new Vector3(1, 0, 0)),
    diskTangentY: new Uniform(new Vector3(0, 0, -1)),
    diskInnerRs: new Uniform(parameters.diskInnerRs),
    diskOuterRs: new Uniform(parameters.diskOuterRs),

    /** Наличие и параметры диска */
    uHasDisk: new Uniform(parameters.hasDisk ? 1 : 0),
    uDiskTemperature: new Uniform(parameters.temperature),
    uDiskIntensity: new Uniform(parameters.diskIntensity),
    uDopplerStrength: new Uniform(parameters.dopplerStrength),
    uPhotonRingIntensity: new Uniform(parameters.photonRingIntensity),
    uNoiseScale: new Uniform(parameters.diskNoiseScale),
    uNoiseOffset: new Uniform(new Vector2()),
    noiseMap: new Uniform<Texture | null>(null),

    /** LUT угла отклонения для дальних лучей (этап 4, см. deflectionLut.ts) */
    deflectionLut: new Uniform<Texture | null>(null),

    /** Время симуляции в днях (свёрнутое на CPU, см. BlackHoleMaterial.update) */
    uTime: new Uniform(0),
    /** Период обращения внутреннего края диска, дни (rotationPeriod) */
    uRotationPeriod: new Uniform(Math.max(parameters.rotationPeriod, 1e-3)),

    /** Шаг интегрирования по углу, рад (конфиг качества) */
    uDphi: new Uniform(config('blackHole.integrationDphi')),
    /** Дебаг: 0 — лензирование выключено (passthrough этапа 1), 1 — включено */
    uLensing: new Uniform(1),
    /** Дебаг: подкраска пикселей по числу пересечений плоскости диска */
    uDebugCrossings: new Uniform(0),

    /**
     * Фоновая кубмапа: приходит не из scene.background (его больше не
     * назначают — фон рисует собственный полноэкранный проход), а из
     * ResourceObserver.sceneBackground, обновляется каждый кадр
     */
    skybox: new Uniform(null),

    /**
     * Порог/сила расширения хайлайтов и флип ориентации кубмапы по X — общий
     * набор, что и у собственного фонового прохода (см. `createSkyboxSampleUniforms`
     * в SkyboxSample): оба потребителя обязаны сэмплировать одну кубмапу
     * одинаково, иначе на границе сферы симуляции возникает ступенька яркости.
     */
    ...createSkyboxSampleUniforms()
  }
}

export const BlackHoleShaderTemplate = {
  vertexShader: /* glsl */ `
    precision highp float;

    uniform mat4 crModelViewMatrix;
    uniform mat4 crProjectionMatrix;
    uniform vec3 localCameraPos;
    uniform float invRsUnits;

    in vec3 position;

    out vec3 vPositionRs;
    out vec3 vCameraRs;
    out float vFragDepth;

    void main() {
      vec4 mvPosition = crModelViewMatrix * vec4(position, 1.0);
      gl_Position = crProjectionMatrix * mvPosition;

      vPositionRs = position * invRsUnits;
      vCameraRs = localCameraPos * invRsUnits;

      vFragDepth = 1.0 + gl_Position.w;
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;

    uniform mat4 crModelViewMatrix;
    uniform float logDepthBufFC;
    uniform float rsUnits;
    uniform float simulationRs;

    uniform vec3 diskNormal;
    uniform vec3 diskTangentX;
    uniform vec3 diskTangentY;
    uniform float diskInnerRs;
    uniform float diskOuterRs;

    uniform float uHasDisk;
    uniform float uDiskTemperature;
    uniform float uDiskIntensity;
    uniform float uDopplerStrength;
    uniform float uPhotonRingIntensity;
    uniform float uNoiseScale;
    uniform vec2 uNoiseOffset;
    uniform sampler2D noiseMap;
    uniform highp sampler2D deflectionLut;

    uniform float uTime;
    uniform float uRotationPeriod;

    uniform float uDphi;
    uniform float uLensing;
    uniform float uDebugCrossings;

    uniform samplerCube skybox;

    #include <skyboxSampleUniforms>
    #include <skyboxSampleFunctions>

    in vec3 vPositionRs;
    in vec3 vCameraRs;
    in float vFragDepth;

    layout(location = 0) out vec4 fragColor;

    const float TWO_PI = 6.28318530718;
    // Потолок шагов — СТРАХОВКА от бесконечного цикла, а не рабочий предел:
    // типичный луч выходит за 60–140 шагов, рабочий ограничитель — PHI_MAX.
    // Связь несущая: дойти до PHI_MAX стоит PHI_MAX/uDphi шагов, и если
    // потолок ниже — он молча обрежет навивку и убьёт фотонное кольцо
    // (проверено: dphi 0.02 требует 471 шаг, при потолке 240 кольцо исчезает).
    // При шиппинговых PHI_MAX = 3π и dphi = 0.05 нужно ~189 шагов — 256 даёт
    // запас ~35%, не больше: подъём навивки до 6π пробовали и откатили
    // (дело было не в намотке, а в грубости углового шага у фотонной сферы),
    // так что запас под 6π не нужен, а компиляция под более высокий потолок
    // измеримо дороже (изолированный замер на RTX 5070 Ti, ANGLE D3D11:
    // 240→512 стоил +0.35 мс/проход, ~30%; пару 256 против 240 отдельно
    // не изолировали, число — оценка по этому замеру, не точная величина).
    // Если когда-нибудь уточнят dphi без подъёма потолка — сюда вернуться.
    // Закреплено tests/blackHole/IntegratorBudget.spec.ts.
    const int MAX_STEPS = 256;
    // 3π — приближение, а не точная граница захвата: лучи у критического
    // прицельного параметра навиваются много раз и всё равно уходят —
    // это и есть кольца высших порядков. Подъём до 4π и 6π при dphi = 0.05
    // пробовали — картинка не изменилась (дело было не в намотке, а в
    // грубости углового шага у фотонной сферы, см. MAX_STEPS выше)
    const float PHI_MAX = 9.42477796;
    // Граница LUT-ветки (этап 4 выполнен): дальше отклонение берётся из
    // deflectionLut — таблицы, запечённой ТЕМ ЖЕ интегратором и тем же dphi
    // (см. deflectionLut.ts). Обе ветки считает одна схема, поэтому стык
    // жёсткий, без кроссфейда и окон: прежний полином слабого поля
    // занижал отклонение на ~0.5° у стыка
    const float WEAK_FIELD_B = 8.0;

    vec3 sampleSkybox(vec3 direction) {
      // Выборка вынесена в общий чанк: её же зовёт собственный фоновый проход.
      // Прежде здесь стояла копия, и любое расхождение с рендером фона давало
      // ступеньку яркости на границе сферы симуляции — теперь расхождение
      // невозможно по построению. uSkyFlipX — тот же юниформ (тот же знак),
      // что и у прямого фона: оба потребителя подают в кубмапу мировые
      // направления (меш ЧД никогда не вращается), поэтому ориентация ОБЯЗАНА
      // совпадать, а не может отличаться.
      return sampleSkyboxHdr(skybox, direction, uSkyFlipX);
    }

    // Аналитический планковский blackbody: CIE-аппроксимация локуса → XYZ → linear sRGB,
    // нормировка по максимальному каналу (яркость задаётся отдельно интенсивностью)
    vec3 blackbody(float t) {
      t = clamp(t, 1500.0, 20000.0);
      float u = (0.860117757 + 1.54118254e-4 * t + 1.28641212e-7 * t * t)
              / (1.0 + 8.42420235e-4 * t + 7.08145163e-7 * t * t);
      float v = (0.317398726 + 4.22806245e-5 * t + 4.20481691e-8 * t * t)
              / (1.0 - 2.89741816e-5 * t + 1.61456053e-7 * t * t);
      float x = 3.0 * u / (2.0 * u - 8.0 * v + 4.0);
      float y = 2.0 * v / (2.0 * u - 8.0 * v + 4.0);
      vec3 xyz = vec3(x / y, 1.0, (1.0 - x - y) / y);
      vec3 rgb = mat3(
        3.2404542, -0.9692660, 0.0556434,
        -1.5371385, 1.8760108, -0.2040259,
        -0.4985314, 0.0415560, 1.0572252
      ) * xyz;
      rgb = max(rgb, vec3(0.0));
      return rgb / max(max(rgb.r, rgb.g), max(rgb.b, 1e-4));
    }

    // Турбулентность диска в координатах (азимут в оборотах, log r) с
    // дифференциальным вращением домена. Азимутальные множители ЦЕЛЫЕ —
    // условие бесшовности по θ при REPEAT-тайлинге текстуры
    float diskNoise(float turns, float rc, float tau) {
      float omega = TWO_PI / uRotationPeriod * pow(rc / diskInnerRs, -1.5);
      float x = turns - tau * omega / TWO_PI;
      vec2 uv = vec2(x * 3.0, log(rc) * 5.0 * uNoiseScale) + uNoiseOffset;
      // анизотропия: низкая частота по θ, высокая по r — азимутальные прожилки
      return texture(noiseMap, uv).r * 0.62
           + texture(noiseMap, uv * vec2(2.0, 2.3) + vec2(0.37, 0.71)).g * 0.38;
    }

    // Шейдинг одного пересечения геодезической с плоскостью диска.
    // localDir — локальное направление ИЗОГНУТОГО луча в точке пересечения
    vec4 shadeDisk(vec3 cp, vec3 localDir, float phiAcc) {
      float rc = length(cp);
      float theta = atan(dot(cp, diskTangentY), dot(cp, diskTangentX));
      float turns = theta / TWO_PI + 0.5;

      // двухслойный кроссфейд против намотки спирали дифференциальным вращением:
      // каждый слой «сбрасывается» в ненамотанное состояние, пока невидим
      float crossfadePeriod = uRotationPeriod * 6.0;
      float w = abs(fract(uTime / crossfadePeriod) * 2.0 - 1.0);
      float n1 = diskNoise(turns, rc, mod(uTime, crossfadePeriod) - 0.5 * crossfadePeriod);
      float n2 = diskNoise(turns, rc, mod(uTime + 0.5 * crossfadePeriod, crossfadePeriod) - 0.5 * crossfadePeriod);
      float n = mix(n1, n2, w);

      // мягкие края кольца
      float edge = smoothstep(diskInnerRs, diskInnerRs * 1.25, rc)
                 * (1.0 - smoothstep(diskOuterRs * 0.78, diskOuterRs, rc));

      // Шакура–Сюняев: температура падает наружу
      float temperature = uDiskTemperature * pow(rc / diskInnerRs, -0.75);

      // кеплеровская скорость газа и доплер по локальному направлению луча;
      // фотон летит К НАБЛЮДАТЕЛЮ против хода трассировки: −localDir
      float beta = sqrt(0.5 / rc);
      float gamma = inversesqrt(max(1.0 - beta * beta, 1e-3));
      vec3 velocityDir = normalize(cross(diskNormal, cp));
      float cosAngle = dot(velocityDir, -localDir);
      float doppler = 1.0 / (gamma * (1.0 - beta * cosAngle));

      // гравитационное покраснение
      float gravShift = sqrt(max(1.0 - 1.0 / rc, 0.0));

      // сдвиг температуры (цвета) и релятивистский beaming (яркости),
      // оба под художественной гайкой dopplerStrength
      float observedT = temperature * pow(doppler, uDopplerStrength) * gravShift;
      float beaming = pow(doppler, 3.0 * uDopplerStrength);

      // фотонное кольцо возникает само из навитых лучей; гайка — его звонкость
      float ringBoost = 1.0 + uPhotonRingIntensity * 1.6 * smoothstep(4.0, 6.0, phiAcc);

      vec3 color = blackbody(observedT)
                 * uDiskIntensity
                 * pow(diskInnerRs / rc, 2.2)
                 * beaming * gravShift * gravShift
                 * ringBoost
                 * (0.4 + 0.8 * n);

      float alpha = clamp(edge * (0.35 + 0.85 * n), 0.0, 1.0) * 0.85 + 0.1 * edge;

      return vec4(color, clamp(alpha, 0.0, 0.95));
    }

    // Честное интегрирование уравнения Бине в плоскости геодезической
    // с накоплением пересечений диска front-to-back
    vec3 traceGeodesic(vec3 cameraRs, vec3 rayDir, float tEnter, out int crossings) {
      crossings = 0;

      vec3 p0 = cameraRs + tEnter * rayDir;
      float r0 = length(p0);

      // базис плоскости геодезической (Грам-Шмидт)
      vec3 e1 = p0 / r0;
      float radial = dot(rayDir, e1);
      vec3 e2v = rayDir - radial * e1;
      float tangential = length(e2v);

      // вырожденный луч точно в центр / из центра
      if (tangential < 1e-4) {
        return radial > 0.0 ? sampleSkybox(rayDir) : vec3(0.0);
      }

      vec3 e2 = e2v / tangential;

      // начальные условия Бине: u = 1/r, u' = du/dφ
      float u = 1.0 / r0;
      float du = -radial / (r0 * tangential);
      float phi = 0.0;
      vec3 prev = p0;

      vec3 accumulated = vec3(0.0);
      float opacity = 0.0;

      for (int i = 0; i < MAX_STEPS; i++) {
        if (phi > PHI_MAX) break;                                // навивка — захват

        // velocity Verlet: одно вычисление правой части на шаг, без дрейфа
        float a0 = -u + 1.5 * u * u;
        float u1 = u + du * uDphi + 0.5 * a0 * uDphi * uDphi;
        float a1 = -u1 + 1.5 * u1 * u1;
        du += 0.5 * (a0 + a1) * uDphi;
        u = u1;
        phi += uDphi;

        if (u > 1.0) break;                                      // захват горизонтом
        u = max(u, 1e-5);

        float r = 1.0 / u;
        vec3 pos = (cos(phi) * e1 + sin(phi) * e2) * r;

        // пересечение плоскости диска: линейная интерполяция точки между шагами
        float h0 = dot(prev, diskNormal);
        float h1 = dot(pos, diskNormal);
        if (uHasDisk > 0.5 && h0 * h1 < 0.0 && crossings < 4 && opacity < 0.99) {
          float tc = h0 / (h0 - h1);
          vec3 crossPoint = mix(prev, pos, tc);
          float rc = length(crossPoint);
          if (rc > diskInnerRs && rc < diskOuterRs) {
            crossings++;
            vec4 sample_ = shadeDisk(crossPoint, normalize(pos - prev), phi);
            accumulated += (1.0 - opacity) * sample_.a * sample_.rgb;
            opacity += (1.0 - opacity) * sample_.a;
          }
        }

        // побег из зоны симуляции: финальное направление → кубмапа.
        // ренормализация шва автоматическая: интегрирование шло только внутри сферы
        if (r > simulationRs && dot(pos, pos) > dot(prev, prev)) {
          return accumulated + (1.0 - opacity) * sampleSkybox(normalize(pos - prev));
        }

        prev = pos;
      }

      // захват горизонтом: сквозь полупрозрачный диск просвечивает чернота
      return accumulated;
    }

    void main() {
      vec3 cameraRs = vCameraRs;
      vec3 rayDir = normalize(vPositionRs - cameraRs);

      // геометрия прицельного параметра (дыра в нуле объектного пространства)
      float tMid = -dot(cameraRs, rayDir);
      float b2 = dot(cameraRs, cameraRs) - tMid * tMid;
      float b = sqrt(max(b2, 0.0));

      bool cameraInside = dot(cameraRs, cameraRs) < simulationRs * simulationRs;

      // дистанция входа луча в зону симуляции (0 — камера внутри)
      float tEnter = cameraInside
        ? 0.0
        : max(tMid - sqrt(max(simulationRs * simulationRs - b2, 0.0)), 0.0);

      // граница аналитической ветки: при наличии диска отодвигается за его
      // внешний край (радиус пересечения плоскости ≥ прицельного параметра,
      // т.е. b > diskOuter + запас гарантирует отсутствие попаданий в диск)
      float weakFieldB = uHasDisk > 0.5
        ? max(WEAK_FIELD_B, diskOuterRs + 1.5)
        : WEAK_FIELD_B;

      vec3 color = vec3(0.0);
      int crossings = 0;

      if (uLensing < 0.5) {
        // дебаг-режим этапа 1: неизогнутый passthrough (эталон бесшовности)
        color = sampleSkybox(rayDir);
      } else if (!cameraInside && b > weakFieldB) {
        // LUT-ветка: угол отклонения, накопленный внутри зоны, из таблицы,
        // запечённой тем же интегратором (deflectionLut.ts). На краю зоны
        // хорда нулевая и α = 0 — бесшовность с нелензированным фоном вне
        // меша автоматическая, окно края больше не нужно.
        // Домен таблицы [WEAK_FIELD_B, simulationRs]; при диске ветка
        // включается позже (weakFieldB отодвинут за диск) — просто читаем
        // таблицу с большего t
        float t = (b - WEAK_FIELD_B) / (simulationRs - WEAK_FIELD_B);
        // Сетка LUT лежит на краях домена: узел i стоит в t = i/255, а тексель
        // i центрирован в (i + 0.5)/256 — коррекция ниже совмещает их, чтобы
        // t = 0 читал ровно узел b = WEAK_FIELD_B (стык с живым интегратором),
        // а t = 1 — ровно нулевой узел на краю зоны (стык с нелензированным
        // фоном вне меша). 255.0/256.0 — это (SIZE-1)/SIZE при SIZE = 256
        float alphaIn = texture(deflectionLut, vec2((0.5 + t * 255.0) / 256.0, 0.5)).r;
        vec3 inward = -normalize(cameraRs + tMid * rayDir);
        color = sampleSkybox(cos(alphaIn) * rayDir + sin(alphaIn) * inward);
      } else {
        color = traceGeodesic(cameraRs, rayDir, tEnter, crossings);
      }

      // дебаг-визуализация пересечений кольца диска: 1 — красный, 2 — зелёный, 3+ — синий
      if (uDebugCrossings > 0.5 && crossings > 0) {
        vec3 tint = crossings == 1 ? vec3(1.0, 0.2, 0.2)
                  : crossings == 2 ? vec3(0.2, 1.0, 0.2)
                  : vec3(0.3, 0.4, 1.0);
        color = mix(color, tint, 0.6);
      }

      fragColor = vec4(color, 1.0);

      // ── Логарифмическая глубина ──
      // снаружи — передняя поверхность сферы (точка входа луча),
      // внутри — фактическая геометрия (задняя стенка), чтобы объекты
      // внутри зоны оставались видимыми при пролёте камеры сквозь неё
      float wEye;
      if (cameraInside) {
        wEye = vFragDepth;
      } else {
        vec3 entryObjectSpace = (cameraRs + tEnter * rayDir) * rsUnits;
        vec4 mvEntry = crModelViewMatrix * vec4(entryObjectSpace, 1.0);
        wEye = 1.0 - mvEntry.z;
      }
      gl_FragDepth = log2(max(wEye, 1e-6)) * logDepthBufFC * 0.5;
    }
  `
}
