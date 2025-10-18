import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { ShaderChunk } from 'three'

export const BlackHoleDistortionActiveShaderTemplate: ShaderProps = {
  uniforms: {},
  vertexShader: `
    varying vec2 vUv;

    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_vertex']}

    void main() {
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);

      vUv = uv;
      ${ShaderChunk['logdepthbuf_vertex']}
    }
  `,
  fragmentShader: `
    precision highp float;
    precision highp int;

    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_fragment']}

    varying vec2 vUv;

    float inverseLerp(float v, float minValue, float maxValue) {
      return (v - minValue) / (maxValue - minValue);
    }

    float remap(float v, float inMin, float inMax, float outMin, float outMax) {
      float t = inverseLerp(v, inMin, inMax);

      return mix(outMin, outMax, t);
    }

    void main() {
      ${ShaderChunk['logdepthbuf_fragment']}
      float distanceToCenter = length(vUv - 0.5);
      float radialStrength = remap(distanceToCenter, 0.0, 0.15, 1.0, 0.0);
      radialStrength = smoothstep(0.0, 1.0, radialStrength);

      float strength = radialStrength;

      gl_FragColor = vec4(strength, 1.0, 1.0, 1.0);
      ${ShaderChunk['tonemapping_fragment']}
      ${ShaderChunk['colorspace_fragment']}
    }
  `
}
