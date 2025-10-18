import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { Uniform, Vector2 } from 'three'

export const FinalShaderTemplate: ShaderProps = {
  uniforms: {
    spaceTexture: new Uniform(null),
    distortionTexture: new Uniform(null),
    blackHolePosition: new Uniform(new Vector2()),
    rgbShiftRadius: new Uniform(0)
  },
  vertexShader: `
    varying vec2 vUv;

    void main() {
      gl_Position = vec4(position, 1.0);

      vUv = uv;
    }
  `,
  fragmentShader: `
    #define PI 3.1415926538

    precision highp float;
    precision highp int;

    varying vec2 vUv;

    uniform sampler2D spaceTexture;
    uniform sampler2D distortionTexture;
    uniform vec2 blackHolePosition;
    uniform float rgbShiftRadius;

    vec3 getRGBShiftedColor(sampler2D _texture, vec2 _uv, float _radius) {
      vec3 angle = vec3(PI * 2.0 / 3.0, PI * 4.0 / 3.0, 0);
      vec3 color = vec3(0.0);
      color.r = texture(_texture, _uv + vec2(sin(angle.r) * _radius, cos(angle.r) * _radius)).r;
      color.g = texture(_texture, _uv + vec2(sin(angle.g) * _radius, cos(angle.g) * _radius)).g;
      color.b = texture(_texture, _uv + vec2(sin(angle.b) * _radius, cos(angle.b) * _radius)).b;

      return color;
    }

    void main() {
      vec4 distortionColor = texture(distortionTexture, vUv);
      float distortionIntensity = distortionColor.r;
      vec2 towardCenter = vUv - blackHolePosition;
      towardCenter *= -distortionIntensity * 2.0;

      vec2 distortedUv = vUv + towardCenter;
      vec3 outColor = getRGBShiftedColor(spaceTexture, distortedUv, rgbShiftRadius);

      gl_FragColor = vec4(outColor, 1.0);
    }
  `
}
