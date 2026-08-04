import { NoBlending, ShaderMaterial, Uniform, Vector2, type ShaderMaterialParameters, type Texture } from 'three'

const vertexShader: string = `
  out vec2 vUv;

  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`

/**
 * Локальный контраст: сколько пиксель торчит над своей окрестностью.
 *
 * Зачем. Блик отбирал пиксели по АБСОЛЮТНОЙ яркости, и это неверно для
 * широкой ровной яркой области: диск звезды ярче порога во всех своих
 * пикселях, а девять зеркальных копий этого плато кроют весь экран коричневой
 * пеленой. Пелена возникала по построению, а не от неудачных чисел: ни
 * вычитающий порог 0.5 против величин порядка десятков, ни затухание к краю
 * (оно меряет расстояние ВЫБОРКИ от центра, а звезда как раз в центре) её не
 * убирали.
 *
 * Локальный контраст плато гасит, а компактный пик пропускает — это и
 * отличает «яркую точку», для которой блик рисуется, от «яркой площади».
 * Знания об источниках света здесь по-прежнему нет: считается только кадр.
 *
 * Считается ОДИН раз отдельным проходом, а не внутри выборки призрака: внутри
 * это стоило бы пяти обращений на каждый из девяти призраков и трёх каналов
 * гало — около шестидесяти выборок на пиксель вместо пяти однократно.
 */
const fragmentShader: string = `
  // Радиус окрестности в текселях СЭМПЛИРУЕМОГО буфера. Константа, а не
  // юниформ: это масштаб различения, а не элемент вида, и менять его на лету
  // незачем. Смена требует пересборки шейдера.
  //
  // Значение замерено 03.08.2026 на сцене TOI-519: при радиусе 8 текселей
  // половинного разрешения (16 экранных пикселей) пелена уходит, углы кадра
  // становятся чёрными. Плато шире этого отсекается, уже — проходит
  #define LOCAL_CONTRAST_RADIUS 8.0

  uniform sampler2D inputBuffer;
  uniform vec2 texelSize;

  in vec2 vUv;

  void main() {
    vec2 radius = texelSize * LOCAL_CONTRAST_RADIUS;

    // Окрестность СИММЕТРИЧНА по обеим осям: среднее четырёх соседей равно
    // центру на любом линейном градиенте, поэтому вычитание гасит не только
    // плато, но и ровный склон. Несимметричная выборка (скажем, один сосед по
    // диагонали) на градиенте давала бы положительный остаток с одной стороны
    // и ноль с другой — серпы вместо чистого нуля
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
