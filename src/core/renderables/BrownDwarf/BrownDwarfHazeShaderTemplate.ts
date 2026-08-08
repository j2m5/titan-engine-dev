import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { Color, ShaderChunk, Uniform } from 'three'

/**
 * Дымка над лимбом: оболочка чуть больше тела, светящаяся кольцом по кромке.
 *
 * Формула профиля — зеркало hazeLimbProfile из BrownDwarfHaze.ts, менять строго
 * синхронно: числовой тест проверяет TS-сторону, GLSL обязан повторять её
 * один в один.
 */
export const BrownDwarfHazeShaderTemplate: ShaderProps = {
  uniforms: {
    uColor: new Uniform(new Color()),
    uStrength: new Uniform(1),
    uShellScale: new Uniform(1.03)
  },
  vertexShader: `
    varying vec3 vPositionW;
    varying vec3 vCenterW;

    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_vertex']}

    void main() {
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);

      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);

      vPositionW = worldPosition.xyz;
      vCenterW = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      ${ShaderChunk['logdepthbuf_vertex']}
    }
  `,
  fragmentShader: `
    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_fragment']}

    uniform vec3 uColor;
    uniform float uStrength;
    uniform float uShellScale;

    varying vec3 vPositionW;
    varying vec3 vCenterW;

    void main() {
      ${ShaderChunk['logdepthbuf_fragment']}

      vec3 normalW = normalize(vPositionW - vCenterW);
      vec3 viewW = normalize(cameraPosition - vPositionW);
      float mu = clamp(dot(normalW, viewW), 0.0, 1.0);

      // Профиль яркости по углу обзора, в радиусах тела: у кромки луч идёт
      // по касательной и набирает больше вещества — отсюда кольцо по лимбу
      float sin2 = max(0.0, 1.0 - mu * mu);
      float outer = sqrt(max(0.0, uShellScale * uShellScale - sin2));
      float inner = sqrt(max(0.0, 1.0 - sin2));
      float profile = outer - inner;

      gl_FragColor = vec4(uColor * profile * uStrength, 1.0);

      ${ShaderChunk['tonemapping_fragment']}
      ${ShaderChunk['colorspace_fragment']}
    }
  `
}
