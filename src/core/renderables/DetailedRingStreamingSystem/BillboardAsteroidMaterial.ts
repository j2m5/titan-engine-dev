import { ShaderMaterial, Color, ShaderChunk, Vector3 } from 'three'
import { ringDustFunctions, ringDustUniforms } from '@/core/materials/shaders/lib/chunks/RingDust'
import { asteroidBrdfFunctions } from '@/core/materials/shaders/lib/chunks/AsteroidBrdf'
import type { Actor } from '@/core/models/Actor'
import { resolveLightTint } from '@/core/helpers/lightSource'

/**
 * Вершинник билборда — модульная константа, а не строка внутри конструктора:
 * структурные проверки шейдера (tests/helpers/billboardSource.ts) читают его без
 * создания материала. Текст при выносе не менялся.
 */
const BILLBOARD_VERTEX_SHADER = /* glsl */ `
        ${ShaderChunk.common}
        ${ShaderChunk.logdepthbuf_pars_vertex}

        uniform float uMaxDistance;
        uniform vec3 uLightPosition;
        uniform float uSilhouetteScale;

        // Per-instance fade [0..1] — плавные LOD/sector-переходы (см. InstancePool.writeFade)
        attribute float instanceFade;
        // Смещение сектора камня от плавающего начала (см. InstancePool.writeOrigins):
        // матрица инстанса хранит позицию ОТНОСИТЕЛЬНО центра сектора. У колец
        // начало не переезжает, атрибут нулевой — сложение ниже тождественно.
        attribute vec3 instanceOrigin;

        varying vec2 vUv;
        varying float vDistanceFade;
        varying vec3 vLightDirView;
        varying vec3 vPlanetDirView;
        varying float vInstanceSeed;
        varying vec3 vRingPos;
        varying float vFade;
        // Эллипс проекции: полуоси (в единицах asteroidSize) и cos/sin угла большой оси
        varying vec4 vEllipse;
        // Полуразмер плейна в тех же единицах: centered → плейн-координаты
        varying float vHalfExtent;

        void main() {
          // Извлечь позицию и масштаб из instance matrix; позиция — абсолютная
          // в системе кольца: смещение сектора + локальная (обе малы)
          vec3 instancePos = instanceOrigin + vec3(
            instanceMatrix[3][0],
            instanceMatrix[3][1],
            instanceMatrix[3][2]
          );

          // Ring-local позиция инстанса для модели пыли
          vRingPos = instancePos;

          // Позиция инстанса в view space
          vec4 mvInstancePos = modelViewMatrix * vec4(instancePos, 1.0);

          // Per-instance seed для уникальной формы каждого billboard — от
          // АБСОЛЮТНОЙ позиции, иначе переезд начала менял бы силуэты
          vInstanceSeed = fract(sin(dot(instancePos.xz, vec2(12.9898, 78.233))) * 43758.5453);

          // --- Эллипс проекции инстанса ---
          // В матрице инстанса уже лежат поворот и пер-осевой масштаб камня.
          // Эллипсоид инстанса во view: A · единичная сфера; его ортопроекция на
          // экран — эллипс с ковариацией (A·Aᵀ) по осям x, y. Из неё угол большой
          // оси и полуоси (корни собственных значений) — билборд наследует позу
          // камня, и при кросс-фейде силуэт L1 совпадает с ориентацией L0.
          // CPU-зеркало: ellipseFromCovariance в tests/asteroidSurface/billboardMirror.ts
          mat3 A = mat3(modelViewMatrix) * mat3(instanceMatrix);
          vec3 row0 = vec3(A[0][0], A[1][0], A[2][0]);
          vec3 row1 = vec3(A[0][1], A[1][1], A[2][1]);
          float qa = dot(row0, row0);
          float qb = dot(row0, row1);
          float qc = dot(row1, row1);
          float theta = 0.5 * atan(2.0 * qb, qa - qc);
          float qMean = (qa + qc) * 0.5;
          float qDev = sqrt((qa - qc) * (qa - qc) * 0.25 + qb * qb);
          float ra = sqrt(max(qMean + qDev, 0.0));
          float rb = sqrt(max(qMean - qDev, 1e-8));

          // Анизотропия самого архетипа билборду недоступна — добираем её по сиду
          // в диапазоне осей архетипов; uSilhouetteScale — средний радиус силуэта
          // относительно максимального радиуса камня (архетип нормирован на 1)
          float archK = mix(0.85, 1.3, fract(sin(vInstanceSeed * 12.9898) * 43758.5453));
          ra *= archK * uSilhouetteScale;
          rb *= uSilhouetteScale / archK;
          vEllipse = vec4(ra, rb, cos(theta), sin(theta));

          // Плейн ужат до описанного квадрата эллипса (в единицах asteroidSize —
          // геометрия плейна ±1.25·asteroidSize, см. InstancePool)
          float halfExtent = max(ra, rb) * 1.1;
          vHalfExtent = halfExtent;

          // Камерные оси В VIEW SPACE
          vec3 right = vec3(1.0, 0.0, 0.0);
          vec3 up    = vec3(0.0, 1.0, 0.0);

          // Смещение вершины плейна
          vec3 vertexOffset = (right * position.x + up * position.y) * (halfExtent / 1.25);

          // Финальная позиция
          vec4 mvPosition = vec4(mvInstancePos.xyz + vertexOffset, 1.0);
          gl_Position = projectionMatrix * mvPosition;

          // UV для sphere impostor (PlaneGeometry UV идёт от 0 до 1)
          vUv = uv;

          // Направление к свету: от world position экземпляра к источнику света
          // Трансформируем в world space через modelMatrix, затем вычисляем направление
          vec4 worldInstancePos = modelMatrix * vec4(instancePos, 1.0);
          vec3 worldLightDir = normalize(uLightPosition - worldInstancePos.xyz);

          // Переводим направление света в view space для согласования с impostor normal
          vLightDirView = normalize((viewMatrix * vec4(worldLightDir, 0.0)).xyz);
          // Направление на центр планеты (начало ring-local) во view — для planetshine
          vPlanetDirView = normalize((modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz - mvInstancePos.xyz);

          // Затухание по расстоянию
          float dist = length(mvInstancePos.xyz);
          vDistanceFade = 1.0 - smoothstep(uMaxDistance * 0.6, uMaxDistance, dist);

          vFade = instanceFade;

          ${ShaderChunk.logdepthbuf_vertex}
        }
      `

/**
 * BillboardAsteroidMaterial — шейдерный материал для L1 billboard-импосторов.
 *
 * Используется с InstancedMesh + PlaneGeometry. Каждый экземпляр автоматически
 * поворачивается к камере в vertex shader.
 *
 * Ключевые свойства:
 * 1. Силуэт — эллипс проекции эллипсоида инстанса (поворот и пер-осевой масштаб
 *    из матрицы инстанса) с анизотропией архетипа по сиду: билборд наследует
 *    позу камня, при кросс-фейде силуэт L1 совпадает с ориентацией L0
 * 2. Кромка — плавные гармоники по углу с фазами от сида (лумпистый край без
 *    мерцания), AA экранными производными
 * 3. Нормаль — масштабированная сфера по осям эллипса; освещение и planetshine
 *    на общем с L0 чанке AsteroidBrdf, цвет и джиттер яркости из профиля
 * 4. Правильная day/night сторона: тёмная сторона астероида = сторона от звезды
 */
class BillboardAsteroidMaterial extends ShaderMaterial {
  /**
   * `model` — актор кольца (тот же вход, что у L0 `InstancedAsteroidMaterial`,
   * резолвер сам поднимается к корню дерева); `undefined` — тинт выключен.
   */
  public constructor(model?: Actor) {
    const lightTint = model ? resolveLightTint(model) : { active: false, color: new Color(1, 1, 1) }

    super({
      defines: { ...(lightTint.active && { USE_LIGHT_TINT: '1' }) },
      uniforms: {
        uColor: { value: new Color(0.55, 0.5, 0.45) },
        // Цвет света звезды (lightTint) — per-instance объект, не общий модульный Uniform
        uLightColor: { value: new Color(1, 1, 1).copy(lightTint.color) },
        /** Позиция источника света в world space (по умолчанию — центр системы) */
        uLightPosition: { value: new Vector3(0, 0, 0) },
        uFade: { value: 1.0 },
        uMaxDistance: { value: 100.0 },
        /** Ambient свет — минимальная освещённость тёмной стороны */
        uAmbient: { value: 0.08 },
        /** Пер-инстансный джиттер яркости (±доля), из профиля породы */
        uColorJitter: { value: 0.1 },
        /** Средний радиус силуэта относительно максимального радиуса камня (архетип нормирован на 1) */
        uSilhouetteScale: { value: 0.85 },
        // Модель освещения камня (см. чанк AsteroidBrdf) — та же, что у L0
        uLunarMix: { value: 0.8 },
        uOppositionSurge: { value: 0.3 },
        uPlanetshineColor: { value: new Color(0xb8ad9c) },
        uPlanetshineStrength: { value: 1.5 },
        // Пылевая дымка (см. чанк RingDust); uDustDensity = 0 — туман выключен
        uDustColor: { value: new Color(0x9b968c) },
        uDustDensity: { value: 0.0 },
        uDustScaleHeight: { value: 1.0 },
        uDustRingInner: { value: 0.0 },
        uDustRingOuter: { value: 1e9 },
        uDustCamRingPos: { value: new Vector3() },
        uDustLightDirRing: { value: new Vector3(1, 0, 0) },
        uDustAnglePower: { value: 2.0 },
        uDustNearFade: { value: 1.0 },
        uDustPlanetRadius: { value: 0.0 },
        // Радиальный профиль пыли из альфы текстуры кольца; scale 0 — выключен
        uDustRadialMap: { value: null },
        uDustRadialMapScale: { value: 0.0 },
        // Полосы кольца и слой (см. чанк RingDust): выключены, пока система не отдаст текстуру
        uRingBandMap: { value: null },
        uRingBandEnabled: { value: 0.0 },
        uBandMeanColor: { value: new Vector3(1, 1, 1) },
        uBandTintStrength: { value: 1.0 },
        uLayerHalfThickness: { value: 1.0 },
        uLayerShadowStrength: { value: 0.25 }
      },
      vertexShader: BILLBOARD_VERTEX_SHADER,
      fragmentShader: /* glsl */ `
        ${ShaderChunk.common}
        ${ShaderChunk.logdepthbuf_pars_fragment}

        uniform vec3 uColor;
        uniform float uFade;
        uniform float uAmbient;
        uniform float uColorJitter;
        uniform float uLunarMix;
        uniform float uOppositionSurge;
        uniform vec3 uPlanetshineColor;
        uniform float uPlanetshineStrength;

        #ifdef USE_LIGHT_TINT
          uniform vec3 uLightColor;
        #endif

        varying vec2 vUv;
        varying float vDistanceFade;
        varying vec3 vLightDirView;
        varying vec3 vPlanetDirView;
        varying float vInstanceSeed;
        varying vec3 vRingPos;
        varying float vFade;
        varying vec4 vEllipse;
        varying float vHalfExtent;

        ${ringDustUniforms}
        ${ringDustFunctions}
        ${asteroidBrdfFunctions}

        // Радиус силуэта в долях эллипса по углу φ: две плавные гармоники с
        // фазами от сида — лумпистый край, как у rubble-архетипов, без мерцания
        // белого шума. CPU-зеркало: silhouetteRadius в billboardMirror.ts
        float billboardSilhouette(float phi, float seed) {
          float p1 = seed * 6.2831853;
          float p2 = seed * 12.566371 + 1.7;
          float h2 = 0.5 + 0.5 * sin(2.0 * phi + p1);
          float h3 = 0.5 + 0.5 * sin(3.0 * phi + p2);
          return 1.0 - 0.12 * (0.6 * h2 + 0.4 * h3);
        }

        void main() {
          ${ShaderChunk.logdepthbuf_fragment}

          // Центрированные UV: (0,0) = центр, (-1,1) = края плейна
          vec2 centered = vUv * 2.0 - 1.0;

          // --- Эллипс проекции (см. вершинник) ---
          // Плейн-координаты → повернуть на -θ → нормировать на полуоси: единичный
          // диск u, в котором и силуэт, и нормаль
          vec2 p = centered * vHalfExtent;
          float cs = vEllipse.z;
          float sn = vEllipse.w;
          vec2 q = vec2(cs * p.x + sn * p.y, -sn * p.x + cs * p.y);
          vec2 u = q / vEllipse.xy;
          float r = length(u);

          // Кромка: гармоники по углу, AA — экранными производными
          float phi = atan(u.y, u.x);
          float edge = billboardSilhouette(phi, vInstanceSeed);
          if (r > edge) discard;
          float aa = fwidth(r);
          float edgeAlpha = 1.0 - smoothstep(edge - 1.5 * aa, edge, r);

          // Нормаль масштабированной сферы: силуэт растянут до единичного диска
          // (un), z по полусфере, компоненты делятся на полуоси (нормаль сферы
          // после масштаба ∝ обратному масштабу), затем поворот обратно на +θ
          vec2 un = u / edge;
          float z = sqrt(max(1.0 - dot(un, un), 0.0));
          float rm = sqrt(vEllipse.x * vEllipse.y);
          vec3 nl = normalize(vec3(un.x / vEllipse.x, un.y / vEllipse.y, z / rm));
          vec3 normal = vec3(cs * nl.x - sn * nl.y, sn * nl.x + cs * nl.y, nl.z);

          // --- Освещение: та же модель, что у L0 (чанк AsteroidBrdf) ---
          // Билборд смотрит на камеру: view-направление ≈ +Z, поэтому NdotV = normal.z,
          // cosPhase = L.z
          float NdotL = dot(normal, vLightDirView);
          float diffuse = asteroidRegolithDiffuse(NdotL, normal.z, vLightDirView.z, uLunarMix, uOppositionSurge);
          // Тень планеты (умбра) — та же модель, что у пыли/2D-кольца/L0. Гасит
          // прямой свет; uAmbient остаётся (не в глухой ноль).
          float planetShadow = ringDustPlanetShadow(vRingPos);
          // Самозатенение слоя кольца — как у L0: прямой свет = тень планеты × тень слоя
          float direct = planetShadow * ringLayerShadow(vRingPos);
          // Planetshine планеты-хозяина — как у L0, ложится на цвет
          float shine = asteroidPlanetshine(normal, normalize(vPlanetDirView), vRingPos, uDustLightDirRing, uDustPlanetRadius);
          float lighting = uAmbient + diffuse * direct;

          // --- Итоговый цвет ---
          // vFade — плавный fade-in/out сектора; abs, т.к. знак кодирует лишь
          // направление кросс-фейда (для дизера L0), билборду важна величина.
          float alpha = edgeAlpha * uFade * vDistanceFade * abs(vFade);
          if (alpha < 0.01) discard;

          // Идентичность камня: пер-инстансный джиттер яркости, как у L0
          vec3 base = uColor * (1.0 + uColorJitter * (vInstanceSeed - 0.5) * 2.0);
          // Тинт по цвету полосы кольца — как у L0
          base *= ringBandTint(length(vRingPos.xz));
          // Planetshine — второй источник света: цвет звезды его не касается (как у L0).
          #ifdef USE_LIGHT_TINT
            vec3 color = base * uAmbient + base * diffuse * direct * uLightColor;
          #else
            vec3 color = base * lighting;
          #endif
          color += base * uPlanetshineColor * (uPlanetshineStrength * shine);
          // Аэроперспектива: дальние импосторы тонут в пылевой дымке
          color = ringDustApplyFog(color, vRingPos);
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      depthWrite: true,
      depthTest: true
    })
  }
}

export { BillboardAsteroidMaterial, BILLBOARD_VERTEX_SHADER }
