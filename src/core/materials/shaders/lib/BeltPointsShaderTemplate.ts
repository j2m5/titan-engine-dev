import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { Color, Uniform } from 'three'

/**
 * Шаблон дальнего слоя пояса астероидов — облако точек (см. BeltPointLayer,
 * спека §4). Приём размера спрайта — тот же, что у StarfieldShaderTemplate
 * (gl_PointSize = size * (k / -mvPosition.z)), но без мерцания и текстуры
 * звезды: круглый спрайт по gl_PointCoord.
 *
 * Кроссфейд с L1-биллбордами стримера — комплемент ИХ ЖЕ per-instance fade
 * (см. BillboardAsteroidMaterial: vDistanceFade = 1.0 -
 * smoothstep(uMaxDistance * 0.6, uMaxDistance, dist)) по той же метрике
 * (view-space дистанция) и с тем же uMaxDistance (= nearThresholdTu
 * стримера, см. AsteroidBelt). Считается ПОЛНОСТЬЮ во вершиннике, per-point
 * — камера может быть внутри Near для одних точек тора и далеко от него для
 * других одновременно, глобальный множитель этого не различит.
 */
export const BeltPointsShaderTemplate: ShaderProps = {
  uniforms: {
    uPointScale: new Uniform(220),
    uMaxDistance: new Uniform(1),
    uColor: new Uniform(new Color(1, 1, 1)),
    uLightColor: new Uniform(new Color(1, 1, 1))
  },
  vertexShader: `
    attribute float size;

    uniform float uPointScale;
    uniform float uMaxDistance;

    varying float vFarGate;
    varying float vFlux;

    void main() {
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

      // GPU не рисует спрайт меньше пикселя, а яркость от этого не падала: тело в
      // десятую пикселя светило полноценной точкой — издалека пояс читался как
      // россыпь. Доля площади честного диска в пикселе гасит его квадратично
      float trueSize = size * (uPointScale / -mvPosition.z);
      gl_PointSize = max(trueSize, 1.0);
      float fluxSide = clamp(trueSize, 0.0, 1.0);
      vFlux = fluxSide * fluxSide;
      gl_Position = projectionMatrix * mvPosition;

      // Комплемент per-instance fade L1-биллборда на этой же дистанции (см. докблок выше)
      float camDist = length(mvPosition.xyz);
      vFarGate = smoothstep(uMaxDistance * 0.6, uMaxDistance, camDist);
    }
  `,
  fragmentShader: `
    uniform vec3 uColor;

    #ifdef USE_LIGHT_TINT
      uniform vec3 uLightColor;
    #endif

    varying float vFarGate;
    varying float vFlux;

    void main() {
      // Круглый спрайт по gl_PointCoord с мягким краем (AA без экранных производных — точка мала)
      vec2 c = gl_PointCoord * 2.0 - 1.0;
      float r = length(c);
      if (r > 1.0) discard;

      float edgeAlpha = 1.0 - smoothstep(0.7, 1.0, r);
      float alpha = vFarGate * edgeAlpha * vFlux;
      if (alpha < 0.01) discard;

      #ifdef USE_LIGHT_TINT
        vec3 color = uColor * uLightColor;
      #else
        vec3 color = uColor;
      #endif

      gl_FragColor = vec4(color, alpha);
    }
  `
}
