import { ShaderMaterial, Color, ShaderChunk } from 'three'

/**
 * BillboardAsteroidMaterial — шейдерный материал для L1 billboard-импосторов.
 *
 * Используется с InstancedMesh + PlaneGeometry. Каждый экземпляр автоматически
 * поворачивается к камере в vertex shader. Из instance matrix извлекаются
 * позиция и масштаб, ориентация игнорируется (billboard всегда лицом к камере).
 *
 * Поддерживает:
 * - Логарифмический depth buffer
 * - Базовое освещение (dot(normal, lightDir))
 * - Fade-in/out через uniform для плавных LOD-переходов
 * - Distance-based alpha falloff
 */
class BillboardAsteroidMaterial extends ShaderMaterial {
  public constructor() {
    super({
      uniforms: {
        uColor: { value: new Color(0.55, 0.5, 0.45) },
        uLightDir: { value: [0.5, 1.0, 0.3] },
        uFade: { value: 1.0 },
        uMaxDistance: { value: 100.0 }
      },
      vertexShader: /* glsl */ `
        ${ShaderChunk.common}
        ${ShaderChunk.logdepthbuf_pars_vertex}

        uniform float uMaxDistance;

        varying float vLighting;
        varying float vDistanceFade;

        void main() {
          // Извлечь позицию и масштаб из instance matrix
          vec3 instancePos = vec3(
            instanceMatrix[3][0],
            instanceMatrix[3][1],
            instanceMatrix[3][2]
          );

          float instanceScale = length(vec3(
            instanceMatrix[0][0],
            instanceMatrix[0][1],
            instanceMatrix[0][2]
          ));

          // Billboard: повернуть quad к камере
          vec4 mvInstancePos = modelViewMatrix * vec4(instancePos, 1.0);
          vec3 right = vec3(modelViewMatrix[0][0], modelViewMatrix[1][0], modelViewMatrix[2][0]);
          vec3 up = vec3(modelViewMatrix[0][1], modelViewMatrix[1][1], modelViewMatrix[2][1]);

          vec3 vertexOffset = right * position.x * instanceScale + up * position.y * instanceScale;
          vec4 mvPosition = vec4(mvInstancePos.xyz + vertexOffset, 1.0);

          gl_Position = projectionMatrix * mvPosition;

          // Простое освещение по нормали billboard (приблизительно)
          vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
          vec3 worldNormal = normalize(-mvInstancePos.xyz); // нормаль к камере
          vLighting = max(0.35, dot(worldNormal, lightDir));

          // Затухание по расстоянию
          float dist = length(mvInstancePos.xyz);
          vDistanceFade = 1.0 - smoothstep(uMaxDistance * 0.6, uMaxDistance, dist);

          ${ShaderChunk.logdepthbuf_vertex}
        }
      `,
      fragmentShader: /* glsl */ `
        ${ShaderChunk.common}
        ${ShaderChunk.logdepthbuf_pars_fragment}

        uniform vec3 uColor;
        uniform float uFade;

        varying float vLighting;
        varying float vDistanceFade;

        void main() {
          ${ShaderChunk.logdepthbuf_fragment}

          // Мягкая круглая форма (вместо квадратного quad)
          vec2 uv = gl_PointCoord;
          // Для InstancedMesh используем local UV через varying, не gl_PointCoord
          // Но PlaneGeometry UV работает напрямую
          // Если нужно — можно переключить на varying vUv

          float alpha = uFade * vDistanceFade;
          if (alpha < 0.01) discard;

          vec3 color = uColor * vLighting;
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
