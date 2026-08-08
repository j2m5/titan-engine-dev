import {
  ClampToEdgeWrapping,
  CubeTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
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
  bdFlowChunk,
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
 * Владеет обеими ping-pong целями и освобождает их в dispose; отданная
 * текстура живёт ровно столько, сколько запекатель.
 */
class BrownDwarfCloudBaker {
  private readonly targets: [WebGLCubeRenderTarget, WebGLCubeRenderTarget]
  private readonly scene: Scene = new Scene()
  private readonly camera: OrthographicCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly quad: Mesh

  public constructor(
    private readonly renderer: WebGLRenderer,
    private readonly params: BakeParams
  ) {
    this.targets = [this.createTarget(), this.createTarget()]
    this.quad = new Mesh(new PlaneGeometry(2, 2))
    this.scene.add(this.quad)
  }

  /** Цели для теста освобождения ресурсов */
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

    this.runPass(seed, this.targets[0], null)

    let source = 0
    for (let step = 0; step < steps; step++) {
      const destination: number = 1 - source
      this.runPass(advect, this.targets[destination], this.targets[source])
      source = destination
    }

    // Финализация пишет в цель, которую НЕ читает: чтение и запись одной
    // текстуры в одном проходе — гонка
    const final: number = 1 - source
    this.runPass(finalize, this.targets[final], this.targets[source])

    for (const material of [seed, advect, finalize]) material.dispose()

    return this.targets[final].texture
  }

  public dispose(): void {
    for (const target of this.targets) target.dispose()

    this.quad.geometry.dispose()
    this.scene.clear()
  }

  private createTarget(): WebGLCubeRenderTarget {
    const target = new WebGLCubeRenderTarget(this.params.size, {
      format: RGFormat,
      type: UnsignedByteType,
      minFilter: LinearMipmapLinearFilter,
      magFilter: LinearFilter,
      wrapS: ClampToEdgeWrapping,
      wrapT: ClampToEdgeWrapping,
      generateMipmaps: true
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
    // Функции шума живут в посеве; адвекция подмешивает свежий шум теми же
    // формулами, поэтому исходник склеивается из обоих
    const noise: string = seedFragmentShader.slice(
      seedFragmentShader.indexOf('float bdHash'),
      seedFragmentShader.indexOf('void main')
    )

    return new RawShaderMaterial({
      vertexShader: bakeVertexShader,
      fragmentShader: `#define PI 3.141592653589793\n${advectFragmentShader.replace(
        'void main()',
        `${noise}\n${bdFlowChunk}\nvoid main()`
      )}`,
      uniforms: {
        ...this.faceUniforms(),
        uPrev: new Uniform(null),
        uSeed: new Uniform(this.params.seed),
        uBandCount: new Uniform(this.params.bandCount),
        uJetStrength: new Uniform(this.params.jetStrength),
        uTurbulence: new Uniform(this.params.turbulence),
        uStep: new Uniform(ADVECTION_STEP),
        uInjection: new Uniform(this.params.injection)
      }
    })
  }

  private finalizeMaterial(): RawShaderMaterial {
    return new RawShaderMaterial({
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
