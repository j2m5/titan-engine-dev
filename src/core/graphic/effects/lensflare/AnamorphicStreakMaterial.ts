import { NoBlending, ShaderMaterial, Uniform, Vector2, type ShaderMaterialParameters, type Texture } from 'three'

const vertexShader: string = `
  out vec2 vUv;

  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`

/**
 * Горизонтальная растяжка ярких пикселей — анаморфный штрих.
 *
 * 33 выборки с треугольным весом; шаг задаётся `spread` в текселях входного
 * буфера. Проход живёт на четверти базового разрешения: тот же вылет в
 * шейдере артефактов стоил бы вчетверо дороже.
 */
const fragmentShader: string = `
  uniform sampler2D inputBuffer;
  uniform vec2 texelSize;
  uniform float spread;

  in vec2 vUv;

  void main() {
    vec3 color = vec3(0.0);
    float total = 0.0;

    for (int i = -16; i <= 16; i++) {
      float weight = 1.0 - abs(float(i)) / 17.0;
      vec2 uv = clamp(vUv + vec2(texelSize.x * spread * float(i), 0.0), 0.0, 1.0);
      color += texture(inputBuffer, uv).rgb * weight;
      total += weight;
    }

    gl_FragColor = vec4(color / total, 1.0);
  }
`

export interface AnamorphicStreakMaterialParameters extends ShaderMaterialParameters {
  inputBuffer?: Texture | null
  spread?: number
}

export const anamorphicStreakMaterialParametersDefaults = {
  spread: 8
} satisfies AnamorphicStreakMaterialParameters

export class AnamorphicStreakMaterial extends ShaderMaterial {
  constructor(params?: AnamorphicStreakMaterialParameters) {
    const { inputBuffer = null, spread, ...others } = {
      ...anamorphicStreakMaterialParametersDefaults,
      ...params
    }
    super({
      name: 'AnamorphicStreakMaterial',
      fragmentShader,
      vertexShader,
      blending: NoBlending,
      toneMapped: false,
      depthWrite: false,
      depthTest: false,
      ...others,
      uniforms: {
        inputBuffer: new Uniform(inputBuffer),
        texelSize: new Uniform(new Vector2()),
        spread: new Uniform(spread),
        ...others.uniforms
      }
    })
  }

  setSize(width: number, height: number): void {
    this.uniforms.texelSize.value.set(1 / width, 1 / height)
  }

  get spread(): number {
    return this.uniforms.spread.value
  }

  set spread(value: number) {
    this.uniforms.spread.value = value
  }
}
