import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { Color, ShaderChunk, Uniform } from 'three'

export const BrownDwarfShaderTemplate: ShaderProps = {
  uniforms: {
    uClouds: new Uniform(null),
    uColorCloud: new Uniform(new Color()),
    uColorHot: new Uniform(new Color()),
    uOpticalDepth: new Uniform(3),
    uGapGlow: new Uniform(3),
    uParallax: new Uniform(0.02),
    uBreathAmplitude: new Uniform(0.08),
    time: new Uniform(0)
  },
  vertexShader: `
    varying vec3 vPositionW;
    varying vec3 vPosition;
    varying vec3 vCenterW;

    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_vertex']}

    void main() {
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);

      gl_Position = projectionMatrix * mvPosition;

      vPositionW = worldPosition.xyz;
      vPosition = position;
      vCenterW = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      ${ShaderChunk['logdepthbuf_vertex']}
    }
  `,
  fragmentShader: `
    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_fragment']}

    uniform samplerCube uClouds;
    uniform vec3 uColorCloud;
    uniform vec3 uColorHot;
    uniform float uOpticalDepth;
    uniform float uGapGlow;
    uniform float uParallax;
    uniform float uBreathAmplitude;
    uniform float time;

    varying vec3 vPositionW;
    varying vec3 vPosition;
    varying vec3 vCenterW;

    #include <brownDwarfSurface>

    void main() {
      ${ShaderChunk['logdepthbuf_fragment']}

      // Домен прибит к телу: рисунок вращается вместе с карликом и не
      // пересеивается при вращении — координата объектная, не мировая
      vec3 dir = normalize(vPosition);

      vec3 normalW = normalize(vPositionW - vCenterW);
      vec3 viewW = normalize(cameraPosition - vPositionW);
      float mu = clamp(dot(normalW, viewW), 0.0, 1.0);

      // Параллакс: верхушки облаков смещаются относительно провалов при
      // движении камеры. Первая выборка читает высоту, вторая берёт поле
      // со сдвигом вдоль касательной проекции взгляда.
      float height = textureCube(uClouds, dir).g;
      vec3 tangentView = normalize(viewW - normalW * dot(viewW, normalW));
      vec3 shifted = normalize(dir - tangentView * (height * uParallax));

      vec2 field = textureCube(uClouds, shifted).rg;

      // Вся композиция — одной точкой входа чанка. Импостор зовёт ту же
      // функцию теми же аргументами: разойтись двум LOD нечем
      vec3 color = bdShade(field, mu, dir, uColorCloud, uColorHot,
                           uOpticalDepth, uGapGlow, time, uBreathAmplitude);

      gl_FragColor = vec4(color, 1.0);

      ${ShaderChunk['tonemapping_fragment']}
      ${ShaderChunk['colorspace_fragment']}
    }
  `
}
