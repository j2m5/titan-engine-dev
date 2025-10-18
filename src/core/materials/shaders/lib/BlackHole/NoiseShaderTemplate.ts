import { ShaderProps } from '@/core/materials/shaders/AbstractShader'

export const NoiseShaderTemplate: ShaderProps = {
  uniforms: {},
  vertexShader: `
    varying vec2 vUv;

    void main() {
      gl_Position = vec4(position, 1.0);

      vUv = uv;
    }
  `,
  fragmentShader: `
    precision highp float;
    precision highp int;

    varying vec2 vUv;

    #include <noiseFunctions>

    void main() {
      float frequency = 8.0;

      float noiseR = perlin3dPeriodic(vec3(vUv * frequency, 123.456), vec3(frequency)) * 0.5 + 0.5;
      float noiseG = perlin3dPeriodic(vec3(vUv * frequency, 456.789), vec3(frequency)) * 0.5 + 0.5;
      float noiseB = perlin3dPeriodic(vec3(vUv * frequency, 789.123), vec3(frequency)) * 0.5 + 0.5;

      gl_FragColor = vec4(noiseR, noiseG, noiseB, 1.0);
    }
  `
}
