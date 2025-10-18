import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { Uniform } from 'three'

export const AdditiveBlendingShaderTemplate: ShaderProps = {
  uniforms: {
    tDiffuse: new Uniform(null),
    tAdd: new Uniform(null)
  },
  vertexShader: `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform sampler2D tAdd;

    varying vec2 vUv;

    void main() {
      vec4 texelBase = texture2D(tDiffuse, vUv);
      vec4 texelAdd = texture2D(tAdd, vUv);

      gl_FragColor = texelBase + texelAdd;
      //gl_FragColor = mix(texelBase, texelAdd, texelAdd.a);
    }
  `
}
