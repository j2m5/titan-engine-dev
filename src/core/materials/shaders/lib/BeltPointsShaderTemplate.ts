import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { Color, Uniform } from 'three'

/**
 * Шаблон дальнего слоя пояса астероидов — облако точек (см. BeltPointLayer,
 * спека §4). Приём размера спрайта — тот же, что у StarfieldShaderTemplate
 * (gl_PointSize = size * (k / -mvPosition.z)), но без мерцания и текстуры
 * звезды: круглый спрайт по gl_PointCoord.
 *
 * uFade — кроссфейд с L1-биллбордами стримера (см. AsteroidBelt.updateObject,
 * beltCrossFade.pointLayerFade); uNearFade — гашение ОТДЕЛЬНОЙ точки у камеры
 * (three-units дистанции до камеры, не путать с uFade): без него точка,
 * оказавшаяся у камеры, раздулась бы спрайтом на весь экран.
 */
export const BeltPointsShaderTemplate: ShaderProps = {
  uniforms: {
    uPointScale: new Uniform(220),
    uFade: new Uniform(1),
    uNearFade: new Uniform(1),
    uColor: new Uniform(new Color(1, 1, 1)),
    uLightColor: new Uniform(new Color(1, 1, 1))
  },
  vertexShader: `
    attribute float size;

    uniform float uPointScale;
    uniform float uNearFade;

    varying float vNearGate;

    void main() {
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      float camDist = -mvPosition.z;

      gl_PointSize = size * (uPointScale / camDist);
      gl_Position = projectionMatrix * mvPosition;

      // Гашение отдельной точки у камеры: без него точка у камеры раздулась бы спрайтом на весь экран
      vNearGate = smoothstep(0.0, uNearFade, camDist);
    }
  `,
  fragmentShader: `
    uniform vec3 uColor;
    uniform float uFade;

    #ifdef USE_LIGHT_TINT
      uniform vec3 uLightColor;
    #endif

    varying float vNearGate;

    void main() {
      // Круглый спрайт по gl_PointCoord с мягким краем (AA без экранных производных — точка мала)
      vec2 c = gl_PointCoord * 2.0 - 1.0;
      float r = length(c);
      if (r > 1.0) discard;

      float edgeAlpha = 1.0 - smoothstep(0.7, 1.0, r);
      float alpha = uFade * vNearGate * edgeAlpha;
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
