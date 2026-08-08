import {
  ClampToEdgeWrapping,
  CubeTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  RawShaderMaterial,
  RGFormat,
  Scene,
  Uniform,
  UnsignedByteType,
  WebGLCubeRenderTarget,
  type WebGLRenderer
} from 'three'
import { CUBE_FACE_BASIS } from '@/core/renderables/BrownDwarf/cubeFaceBasis'
import {
  advectFragmentShader,
  bakeVertexShader,
  finalizeFragmentShader,
  seedFragmentShader
} from '@/core/renderables/BrownDwarf/BrownDwarfBakeShaders'

export interface BakeParams {
  seed: number
  bandCount: number
  jetStrength: number
  turbulence: number
  /** Грань кубмапы, тексели */
  size: number
  /** Итераций адвекции */
  steps: number
  /** Доля свежего шума на шаг */
  injection: number
}

/** Шаг сноса за итерацию, радианы. Больше — грубее складки, меньше — слабее размешивание */
const ADVECTION_STEP = 0.012

/** Контраст толщи на финализации: разводит палубу и прогалины */
const DENSITY_CONTRAST = 1.8

/**
 * Запекает облачное поле коричневого карлика в кубмапу.
 *
 * Форма СТАТИЧНА: печётся один раз при создании объекта, дальше не трогается.
 * Времени в конвейере нет ни в каком виде — эволюция узора кадр за кадром
 * была механизмом дефекта прошлой арки.
 *
 * Владеет обеими ping-pong целями. Черновая освобождается сразу по
 * завершении bake(), финальная — в dispose; отданная текстура живёт ровно
 * столько, сколько запекатель.
 */
class BrownDwarfCloudBaker {
  private readonly targets: [WebGLCubeRenderTarget, WebGLCubeRenderTarget]
  /** Индексы уже освобождённых целей: черновая уходит раньше dispose */
  private readonly released: Set<number> = new Set()
  private readonly scene: Scene = new Scene()
  private readonly camera: OrthographicCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly quad: Mesh
  // Квад стартует с этим материалом, дальше runPass переставляет на
  // seed/advect/finalize (их освобождает bake()) — этот, стартовый, остаётся
  // ничьим и его обязан закрыть dispose() этого класса
  private readonly quadMaterial: MeshBasicMaterial = new MeshBasicMaterial()

  public constructor(
    private readonly renderer: WebGLRenderer,
    private readonly params: BakeParams
  ) {
    this.targets = [this.createTarget(), this.createTarget()]
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.quadMaterial)
    this.scene.add(this.quad)
  }

  /** Цели для теста освобождения ресурсов; не публичный API */
  public get targetsForTest(): readonly WebGLCubeRenderTarget[] {
    return this.targets
  }

  public bake(): CubeTexture {
    const { steps } = this.params

    // Материалы создаются ОДИН раз на всё запекание: материал внутри цикла
    // означал бы перекомпиляцию шейдера на каждой из 24 итераций
    const seed: RawShaderMaterial = this.seedMaterial()
    const advect: RawShaderMaterial = this.advectMaterial()
    const finalize: RawShaderMaterial = this.finalizeMaterial()

    try {
      this.runPass(seed, this.targets[0], null)

      let source = 0
      for (let step = 0; step < steps; step++) {
        const destination: number = 1 - source

        // Номер итерации декоррелирует впрыск: без него один и тот же шум
        // вливается на каждом шаге и складывается когерентно
        advect.uniforms.uInjectSeed.value = step * 13
        this.runPass(advect, this.targets[destination], this.targets[source])

        source = destination
      }

      // Финализация пишет в цель, которую НЕ читает: чтение и запись одной
      // текстуры в одном проходе — гонка
      const final: number = 1 - source
      this.runPass(finalize, this.targets[final], this.targets[source])

      // Черновая цель больше не нужна. Держать её до dispose означало бы
      // 67 МБ впустую на всё время жизни объекта
      this.targets[source].dispose()
      this.released.add(source)

      return this.targets[final].texture
    } finally {
      // finally, а не хвост try: падение прохода не должно течь материалами
      for (const material of [seed, advect, finalize]) material.dispose()
    }
  }

  public dispose(): void {
    this.targets.forEach((target, index) => {
      if (!this.released.has(index)) target.dispose()
    })
    this.released.clear()

    this.quad.geometry.dispose()
    this.quadMaterial.dispose()
    this.scene.clear()
  }

  private createTarget(): WebGLCubeRenderTarget {
    // depthBuffer: false обязателен. По умолчанию three заводит буфер глубины
    // НА КАЖДУЮ ГРАНЬ: при грани 2048 это 6 × 2048² × 4 Б = 100 МБ на цель и
    // 201 МБ на пару — под конвейер полноэкранных квадов, которому глубина не
    // нужна вообще. Прецедент в самой библиотеке: PMREMGenerator заводит свои
    // цели без глубины и включает её только когда реально рисует сцену.
    const target = new WebGLCubeRenderTarget(this.params.size, {
      format: RGFormat,
      type: UnsignedByteType,
      minFilter: LinearMipmapLinearFilter,
      magFilter: LinearFilter,
      wrapS: ClampToEdgeWrapping,
      wrapT: ClampToEdgeWrapping,
      generateMipmaps: true,
      depthBuffer: false,
      stencilBuffer: false
    })

    target.texture.name = 'BrownDwarfClouds'

    return target
  }

  /** Один проход по всем шести граням; рендерер возвращается на прежнюю цель */
  private runPass(material: RawShaderMaterial, destination: WebGLCubeRenderTarget, source: WebGLCubeRenderTarget | null): void {
    const previous = this.renderer.getRenderTarget()

    this.quad.material = material

    if (source) material.uniforms.uPrev.value = source.texture

    CUBE_FACE_BASIS.forEach((basis, face) => {
      material.uniforms.uFaceForward.value = basis.forward
      material.uniforms.uFaceRight.value = basis.right
      material.uniforms.uFaceUp.value = basis.up

      this.renderer.setRenderTarget(destination, face)
      this.renderer.render(this.scene, this.camera)
    })

    this.renderer.setRenderTarget(previous)
  }

  private faceUniforms(): Record<string, Uniform> {
    return {
      uFaceForward: new Uniform(CUBE_FACE_BASIS[0].forward),
      uFaceRight: new Uniform(CUBE_FACE_BASIS[0].right),
      uFaceUp: new Uniform(CUBE_FACE_BASIS[0].up)
    }
  }

  private seedMaterial(): RawShaderMaterial {
    return new RawShaderMaterial({
      // Глубины у целей нет (depthBuffer: false) — тест и запись обязаны
      // быть выключены явно, иначе намерение читается только из конструктора цели
      depthTest: false,
      depthWrite: false,
      vertexShader: bakeVertexShader,
      fragmentShader: `#define PI 3.141592653589793\n${seedFragmentShader}`,
      uniforms: {
        ...this.faceUniforms(),
        uSeed: new Uniform(this.params.seed),
        uBandCount: new Uniform(this.params.bandCount)
      }
    })
  }

  private advectMaterial(): RawShaderMaterial {
    return new RawShaderMaterial({
      // Глубины у целей нет (depthBuffer: false) — тест и запись обязаны
      // быть выключены явно, иначе намерение читается только из конструктора цели
      depthTest: false,
      depthWrite: false,
      vertexShader: bakeVertexShader,
      fragmentShader: `#define PI 3.141592653589793\n${advectFragmentShader}`,
      uniforms: {
        ...this.faceUniforms(),
        uPrev: new Uniform(null),
        uSeed: new Uniform(this.params.seed),
        uBandCount: new Uniform(this.params.bandCount),
        uJetStrength: new Uniform(this.params.jetStrength),
        uTurbulence: new Uniform(this.params.turbulence),
        uStepSize: new Uniform(ADVECTION_STEP),
        uInjection: new Uniform(this.params.injection),
        // Переписывается перед каждым проходом номером итерации
        uInjectSeed: new Uniform(0)
      }
    })
  }

  private finalizeMaterial(): RawShaderMaterial {
    return new RawShaderMaterial({
      // Глубины у целей нет (depthBuffer: false) — тест и запись обязаны
      // быть выключены явно, иначе намерение читается только из конструктора цели
      depthTest: false,
      depthWrite: false,
      vertexShader: bakeVertexShader,
      fragmentShader: finalizeFragmentShader,
      uniforms: {
        ...this.faceUniforms(),
        uPrev: new Uniform(null),
        uContrast: new Uniform(DENSITY_CONTRAST)
      }
    })
  }
}

export { BrownDwarfCloudBaker }
