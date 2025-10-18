import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { Uniform } from 'three'

export const FinalV2ShaderTemplate: ShaderProps = {
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
      // финальный цвет просто равен blackHoleRenderTarget
      // если в нём нет эффекта — fallback на обычную сцену
      vec4 bh = texture2D(tAdd, vUv);
      vec4 base = texture2D(tDiffuse, vUv);

      // если bh прозрачно — выводим base, иначе bh
      gl_FragColor = mix(base, bh, bh.a);
    }
  `
}
