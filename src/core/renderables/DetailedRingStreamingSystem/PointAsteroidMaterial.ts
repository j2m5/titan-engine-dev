import { ShaderMaterial, Color, ShaderChunk } from 'three'

/**
 * PointAsteroidMaterial — шейдерный материал для L2 (дальних секторов).
 *
 * Используется с THREE.Points. Рендерит каждый астероид как GL_POINT
 * с size attenuation (уменьшение размера с расстоянием) и мягкими круглыми краями.
 *
 * Атрибуты geometry:
 * - position (vec3) — позиция точки
 * - aSize (float) — индивидуальный размер точки
 *
 * Поддерживает:
 * - Логарифмический depth buffer
 * - Fade uniform для плавных переходов
 * - Distance fade
 */
class PointAsteroidMaterial extends ShaderMaterial {
  public constructor() {
    super({
      uniforms: {
        uColor: { value: new Color(0.6, 0.55, 0.5) },
        uFade: { value: 1.0 },
        uMaxDistance: { value: 200.0 },
        uBasePointSize: { value: 300.0 },
        uPixelRatio: { value: 1.0 }
      },
      vertexShader: /* glsl */ `
        ${ShaderChunk.common}
        ${ShaderChunk.logdepthbuf_pars_vertex}

        attribute float aSize;

        uniform float uMaxDistance;
        uniform float uBasePointSize;
        uniform float uPixelRatio;

        varying float vDistanceFade;
        varying float vLighting;

        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          float dist = length(mvPosition.xyz);

          gl_Position = projectionMatrix * mvPosition;

          // Size attenuation
          gl_PointSize = (aSize * uBasePointSize * uPixelRatio) / dist;
          gl_PointSize = clamp(gl_PointSize, 1.0, 64.0);

          // Distance fade
          vDistanceFade = 1.0 - smoothstep(uMaxDistance * 0.5, uMaxDistance, dist);

          // Примитивное освещение — далёкие точки немного темнее
          vLighting = mix(0.5, 1.0, 1.0 - smoothstep(0.0, uMaxDistance, dist));

          ${ShaderChunk.logdepthbuf_vertex}
        }
      `,
      fragmentShader: /* glsl */ `
        ${ShaderChunk.common}
        ${ShaderChunk.logdepthbuf_pars_fragment}

        uniform vec3 uColor;
        uniform float uFade;

        varying float vDistanceFade;
        varying float vLighting;

        void main() {
          ${ShaderChunk.logdepthbuf_fragment}

          // Круглая форма с мягкими краями
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;

          float alpha = smoothstep(0.5, 0.25, dist) * uFade * vDistanceFade;
          if (alpha < 0.01) discard;

          vec3 color = uColor * vLighting;
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true
    })
  }
}

export { PointAsteroidMaterial }
