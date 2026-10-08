import { NoBlending, ShaderMaterial, Uniform, Vector2, type ShaderMaterialParameters, type Texture } from 'three'
import { LOCAL_CONTRAST_RADIUS } from './flareGrid'
import { glslFloat } from './glslLiteral'

const vertexShader: string = `
  out vec2 vUv;

  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`

/**
 * Локальный контраст: сколько пиксель торчит над своей окрестностью. Отделяет
 * яркий компактный ПИК от яркой ПЛОЩАДИ: плато гасится, пик проходит.
 *
 * Выход питает сетку источников (FlareGridMaterial): без него яркое плато —
 * диск звезды, диск ЧД — превращало бы в источник каждую свою ячейку. От
 * крупного диска остаётся кольцо по кромке, отбор дробит его на копии —
 * их сводит окно источников (FlareWindowMaterial).
 *
 * Отдельный проход, а не выборка внутри сбора: внутри это стоило бы заметно
 * больше обращений к текстуре на пиксель.
 */
const fragmentShader: string = `
  // Радиус окрестности в текселях сэмплируемого буфера: граница между «пиком» и
  // «плато». Плато шире отсекается, уже — проходит. Константа, а не юниформ:
  // масштаб различения, а не элемент вида; смена требует пересборки шейдера
  #define LOCAL_CONTRAST_RADIUS ${glslFloat(LOCAL_CONTRAST_RADIUS)}

  uniform sampler2D inputBuffer;
  uniform vec2 texelSize;

  in vec2 vUv;

  void main() {
    vec2 radius = texelSize * LOCAL_CONTRAST_RADIUS;

    // Окрестность симметрична по обеим осям: среднее четырёх соседей равно
    // центру на любом линейном градиенте, поэтому гаснет и плато, и ровный
    // склон. Несимметричная выборка оставила бы на склоне серпы вместо нуля
    vec3 wide = 0.25 * (
      texture(inputBuffer, vUv + vec2(radius.x, 0.0)).rgb +
      texture(inputBuffer, vUv - vec2(radius.x, 0.0)).rgb +
      texture(inputBuffer, vUv + vec2(0.0, radius.y)).rgb +
      texture(inputBuffer, vUv - vec2(0.0, radius.y)).rgb
    );

    gl_FragColor = vec4(max(texture(inputBuffer, vUv).rgb - wide, vec3(0.0)), 1.0);
  }
`

export interface LocalContrastMaterialParameters extends ShaderMaterialParameters {
  inputBuffer?: Texture | null
}

export class LocalContrastMaterial extends ShaderMaterial {
  constructor(params?: LocalContrastMaterialParameters) {
    const { inputBuffer = null, ...others } = { ...params }
    super({
      name: 'LocalContrastMaterial',
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
        ...others.uniforms
      }
    })
  }

  /** Размеры СЭМПЛИРУЕМОГО буфера: радиус меряется в его текселях */
  setSize(width: number, height: number): void {
    this.uniforms.texelSize.value.set(1 / width, 1 / height)
  }

  get inputBuffer(): Texture | null {
    return this.uniforms.inputBuffer.value
  }

  set inputBuffer(value: Texture | null) {
    this.uniforms.inputBuffer.value = value
  }
}
