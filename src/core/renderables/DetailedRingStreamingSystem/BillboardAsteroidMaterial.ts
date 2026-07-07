import { ShaderMaterial, Color, ShaderChunk, Vector3 } from 'three'
import { ringDustFunctions, ringDustUniforms } from '@/core/materials/shaders/lib/chunks/RingDust'

/**
 * BillboardAsteroidMaterial — шейдерный материал для L1 billboard-импосторов.
 *
 * Используется с InstancedMesh + PlaneGeometry. Каждый экземпляр автоматически
 * поворачивается к камере в vertex shader.
 *
 * Ключевые отличия от первой версии:
 * 1. Sphere impostor: UV-координаты маппятся на сферическую нормаль,
 *    что даёт правильное полусферическое освещение и круглую форму
 * 2. Процедурные неровные края — billboard выглядит как камень, не круг
 * 3. Освещение вычисляется от uLightPosition (позиция звезды), не хардкод
 * 4. Правильная day/night сторона: тёмная сторона астероида = сторона от звезды
 */
class BillboardAsteroidMaterial extends ShaderMaterial {
  public constructor() {
    super({
      uniforms: {
        uColor: { value: new Color(0.55, 0.5, 0.45) },
        /** Позиция источника света в world space (по умолчанию — центр системы) */
        uLightPosition: { value: new Vector3(0, 0, 0) },
        uFade: { value: 1.0 },
        uMaxDistance: { value: 100.0 },
        /** Ambient свет — минимальная освещённость тёмной стороны */
        uAmbient: { value: 0.08 },
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
        uDustRadialMapScale: { value: 0.0 }
      },
      vertexShader: /* glsl */ `
        ${ShaderChunk.common}
        ${ShaderChunk.logdepthbuf_pars_vertex}

        uniform float uMaxDistance;
        uniform vec3 uLightPosition;

        // Per-instance fade [0..1] — плавные LOD/sector-переходы (см. InstancePool.writeFade)
        attribute float instanceFade;

        varying vec2 vUv;
        varying float vDistanceFade;
        varying vec3 vLightDirView;
        varying float vInstanceSeed;
        varying vec3 vRingPos;
        varying float vFade;

        void main() {
          // Извлечь позицию и масштаб из instance matrix
          vec3 instancePos = vec3(
            instanceMatrix[3][0],
            instanceMatrix[3][1],
            instanceMatrix[3][2]
          );

          // Ring-local позиция инстанса для модели пыли
          vRingPos = instancePos;

          // Позиция инстанса в view space
          vec4 mvInstancePos = modelViewMatrix * vec4(instancePos, 1.0);

          // Размер инстанса
          float instanceScale = length(vec3(
            instanceMatrix[0][0],
            instanceMatrix[0][1],
            instanceMatrix[0][2]
          ));

          // Камерные оси В VIEW SPACE
          vec3 right = vec3(1.0, 0.0, 0.0);
          vec3 up    = vec3(0.0, 1.0, 0.0);

          // Смещение вершины плейна
          vec3 vertexOffset =
            right * position.x * instanceScale +
            up    * position.y * instanceScale;

          // Финальная позиция
          vec4 mvPosition = vec4(mvInstancePos.xyz + vertexOffset, 1.0);
          gl_Position = projectionMatrix * mvPosition;

          // UV для sphere impostor (PlaneGeometry UV идёт от 0 до 1)
          vUv = uv;

          // Per-instance seed для уникальной формы каждого billboard
          vInstanceSeed = fract(sin(dot(instancePos.xz, vec2(12.9898, 78.233))) * 43758.5453);

          // Направление к свету: от world position экземпляра к источнику света
          // Трансформируем в world space через modelMatrix, затем вычисляем направление
          vec4 worldInstancePos = modelMatrix * vec4(instancePos, 1.0);
          vec3 worldLightDir = normalize(uLightPosition - worldInstancePos.xyz);

          // Переводим направление света в view space для согласования с impostor normal
          vLightDirView = normalize((viewMatrix * vec4(worldLightDir, 0.0)).xyz);

          // Затухание по расстоянию
          float dist = length(mvInstancePos.xyz);
          vDistanceFade = 1.0 - smoothstep(uMaxDistance * 0.6, uMaxDistance, dist);

          vFade = instanceFade;

          ${ShaderChunk.logdepthbuf_vertex}
        }
      `,
      fragmentShader: /* glsl */ `
        ${ShaderChunk.common}
        ${ShaderChunk.logdepthbuf_pars_fragment}

        uniform vec3 uColor;
        uniform float uFade;
        uniform float uAmbient;

        varying vec2 vUv;
        varying float vDistanceFade;
        varying vec3 vLightDirView;
        varying float vInstanceSeed;
        varying vec3 vRingPos;
        varying float vFade;

        ${ringDustUniforms}
        ${ringDustFunctions}

        // Простой хеш для процедурного шума
        float hash(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }

        void main() {
          ${ShaderChunk.logdepthbuf_fragment}

          // Центрированные UV: (0,0) = центр, (-1,1) = края
          vec2 centered = vUv * 2.0 - 1.0;
          float distFromCenter = length(centered);

          // --- Sphere impostor normal ---
          // Трактуем billboard как полусферу: z = sqrt(1 - x² - y²)
          float r2 = dot(centered, centered);
          if (r2 > 1.0) discard; // За пределами сферы

          // Нормаль полусферы в view space (billboard смотрит на камеру = +Z)
          vec3 normal = vec3(centered, sqrt(1.0 - r2));

          // --- Процедурные неровные края ---
          // Шум по углу + per-instance seed для уникального силуэта каждого billboard
          float angle = atan(centered.y, centered.x);
          float seed = vInstanceSeed * 100.0;
          float edgeNoise = hash(vec2(angle * 3.0 + seed, 0.5 + seed)) * 0.18 +
                            hash(vec2(angle * 7.0 + seed, 1.3 + seed)) * 0.10;
          float edgeThreshold = 0.82 - edgeNoise;

          if (distFromCenter > edgeThreshold) discard;

          // Мягкий край (antialiasing)
          float edgeAlpha = 1.0 - smoothstep(edgeThreshold - 0.08, edgeThreshold, distFromCenter);

          // --- Освещение (Lambertian diffuse) ---
          float NdotL = dot(normal, vLightDirView);
          // Wrap lighting: мягкий переход свет→тень
          float diffuse = NdotL * 0.5 + 0.5;
          diffuse = diffuse * diffuse; // Квадратичный falloff для более контрастных теней
          // Тень планеты (умбра) — та же модель, что у пыли/2D-кольца/L0. Гасит
          // прямой свет; uAmbient остаётся (не в глухой ноль).
          float planetShadow = ringDustPlanetShadow(vRingPos);
          float lighting = uAmbient + (0.3 - uAmbient) * diffuse * planetShadow;

          // --- Итоговый цвет ---
          // vFade — плавный fade-in/out сектора; abs, т.к. знак кодирует лишь
          // направление кросс-фейда (для дизера L0), билборду важна величина.
          float alpha = edgeAlpha * uFade * vDistanceFade * abs(vFade);
          if (alpha < 0.01) discard;

          vec3 color = uColor * lighting;
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

export { BillboardAsteroidMaterial }
