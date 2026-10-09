import { AlwaysDepth, NoBlending, ShaderMaterial, Uniform, type Texture } from 'three'

const vertexShader: string = `
  out vec2 vUv;

  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`

/**
 * Возврат глубины сцены в текущий буфер: после EffectPass линз композер рисует
 * во второй буфер, чья глубина — не сцены. Цвет не трогается; значения
 * глубины переносятся как есть (лог-глубина three в текстуре уже готовая).
 */
const fragmentShader: string = `
  uniform sampler2D depthBuffer;

  in vec2 vUv;

  void main() {
    gl_FragDepth = texture(depthBuffer, vUv).r;
    gl_FragColor = vec4(0.0);
  }
`

export class DepthRestoreMaterial extends ShaderMaterial {
  public constructor() {
    super({
      name: 'DepthRestoreMaterial',
      vertexShader,
      fragmentShader,
      uniforms: { depthBuffer: new Uniform(null) },
      blending: NoBlending,
      colorWrite: false,
      depthTest: true,
      depthFunc: AlwaysDepth,
      depthWrite: true,
      toneMapped: false
    })
  }

  public get depthBuffer(): Texture | null {
    return this.uniforms.depthBuffer.value
  }

  public set depthBuffer(value: Texture | null) {
    this.uniforms.depthBuffer.value = value
  }
}
