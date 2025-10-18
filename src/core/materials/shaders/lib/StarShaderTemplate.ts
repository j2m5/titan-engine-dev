import { ShaderProps } from '@/core/materials/shaders/AbstractShader.ts'
import { Color, ShaderChunk, Uniform } from 'three'

export const StarShaderTemplate: ShaderProps = {
  uniforms: {
    spectralColor: new Uniform(new Color()),
    time: new Uniform(0)
  },
  vertexShader: `
    varying vec3 vPositionW;
    varying vec3 vPosition;

    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_vertex']}

    void main() {
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);

      gl_Position = projectionMatrix * mvPosition;

      vPositionW = worldPosition.xyz;
      vPosition = position;
      ${ShaderChunk['logdepthbuf_vertex']}
    }
  `,
  fragmentShader: `
    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_fragment']}

    uniform vec3 spectralColor;
    uniform float time;

    varying vec3 vPositionW;
    varying vec3 vPosition;

    #include <noiseFunctions>

    float fbm(vec4 pos, int octaves, float persistence) {
      float total = 0.0;
      float frequency = 1.0;
      float amplitude = 1.0;
      float maxValue = 0.0;

      for(int i = 0; i < octaves; i++) {
        total += snoise(pos * frequency) * amplitude;

        maxValue += amplitude;

        amplitude *= persistence;
        frequency *= 2.0;
      }

      return total / maxValue;
    }

    vec3 darken(vec3 color, float factor) {
      float parsedFactor = 1.0 - factor;

      return vec3(color.r * parsedFactor, color.g * parsedFactor, color.b * parsedFactor);
    }

    vec3 lighten(vec3 color, float factor) {
      return vec3(color.r * factor, color.g * factor, color.b * factor);
    }

    void main() {
      ${ShaderChunk['logdepthbuf_fragment']}
      vec3 viewDirection = normalize(vPosition - cameraPosition);
      vec3 sunDirection = normalize(vPosition);

      vec4 position = vec4(vPosition * 0.05, time);
      float noise = fbm(position, 6, 0.9);
      noise = 0.5 + (noise - 0.5) * 2.0;

      vec3 lightenColor = lighten(spectralColor, 0.1);
      vec3 darkenColor = darken(spectralColor, 0.1);
      vec3 color = mix(darkenColor, lightenColor, noise);
      float distance = length(cameraPosition - vPositionW);

      float noiseIntensity = distance * 0.0003;
      color.r += noiseIntensity;
      color.g += noiseIntensity;
      color.b += noiseIntensity;

      gl_FragColor = vec4(color, 1.0);

      ${ShaderChunk['tonemapping_fragment']}
      ${ShaderChunk['colorspace_fragment']}
    }
  `
}
