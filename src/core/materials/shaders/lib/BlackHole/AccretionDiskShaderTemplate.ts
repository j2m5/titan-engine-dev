import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { Color, ShaderChunk, Uniform } from 'three'

export const AccretionDiskShaderTemplate: ShaderProps = {
  uniforms: {
    time: new Uniform(0),
    noiseTexture: new Uniform(null),
    innerColor: new Uniform(new Color()),
    outerColor: new Uniform(new Color())
  },
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

    uniform float time;
    uniform sampler2D noiseTexture;
    uniform vec3 innerColor;
    uniform vec3 outerColor;

    varying vec2 vUv;

    float inverseLerp(float v, float minValue, float maxValue) {
      return (v - minValue) / (maxValue - minValue);
    }

    float remap(float v, float inMin, float inMax, float outMin, float outMax) {
      float t = inverseLerp(v, inMin, inMax);
      return mix(outMin, outMax, t);
    }

    float blendAdd(float base, float blend) {
      return min(base + blend, 1.0);
    }

    vec3 blendAdd(vec3 base, vec3 blend) {
      return min(base + blend, vec3(1.0));
    }

    vec3 blendAdd(vec3 base, vec3 blend, float opacity) {
      return (blendAdd(base, blend) * opacity + base * (1.0 - opacity));
    }

    void main() {
      ${ShaderChunk['logdepthbuf_fragment']}
      vec4 color = vec4(0.0);
      color.a = 1.0;

      float iterations = 3.0;

      for(float i = 0.0; i < iterations; i++) {
        float progress = i / (iterations - 1.0);

        float intensity = 1.0 - ((vUv.y - progress) * iterations) * 0.5;
        intensity = smoothstep(0.0, 1.0, intensity);

        vec2 uv = vUv;
        uv.y *= 2.0;
        uv.x += time / ((i * 10.0) + 1.0);

        vec3 ringColor = mix(innerColor, outerColor, progress);

        float noiseIntensity = texture(noiseTexture, uv).r;

        ringColor = mix(vec3(0.0), ringColor.rgb, noiseIntensity * intensity);

        color.rgb = blendAdd(color.rgb, ringColor);
      }

      float edgesAttenuation = min(inverseLerp(vUv.y, 0.0, 0.02), inverseLerp(vUv.y, 1.0, 0.5));

      color.rgb = mix(vec3(0.0), color.rgb, edgesAttenuation);

      gl_FragColor = color;
      ${ShaderChunk['tonemapping_fragment']}
      ${ShaderChunk['colorspace_fragment']}
    }
  `
}
