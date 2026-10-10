import {
  BufferAttribute,
  BufferGeometry,
  type Camera,
  type CubeTexture,
  GLSL3,
  HalfFloatType,
  LinearFilter,
  Mesh,
  RawShaderMaterial,
  type Texture,
  Uniform,
  type WebGLRenderer,
  WebGLRenderTarget
} from 'three'
import { createSkyUniforms } from '@/core/materials/shaders/lib/chunks/SkySample'
import { SKY_VERTEX_SHADER, buildSkyFragmentShader } from '@/core/renderables/skyShader'

export type SkyLayerRenderer = Pick<WebGLRenderer, 'getRenderTarget' | 'setRenderTarget' | 'render'>

/**
 * Слой видимого неба кадра: небо фона там, где сцена не закрыла его глубиной,
 * альфа — видимость. Проходы линзы вычитают его из копии кадра и добавляют небо
 * по искривлённому лучу: max(копия − слой, 0) + слой.a · небоПоЛучу. Шейдер —
 * общий с фоном (skyShader), значения совпадают бит-в-бит, и билинейное
 * вычитание снимает старые звёзды без следа.
 *
 * Рисует BlackHolePass в кадре с видимой дырой; в кадре без неё — reset, и
 * читатели получают null вместо устаревшего слоя
 */
export class SkyLayer {
  public readonly target: WebGLRenderTarget
  public readonly material: RawShaderMaterial
  public readonly mesh: Mesh
  private active = false

  public constructor() {
    this.target = new WebGLRenderTarget(1, 1, {
      type: HalfFloatType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false
    })
    this.material = new RawShaderMaterial({
      glslVersion: GLSL3,
      uniforms: {
        skybox: new Uniform<CubeTexture | null>(null),
        uSceneDepth: new Uniform<Texture | null>(null),
        ...createSkyUniforms()
      },
      vertexShader: SKY_VERTEX_SHADER,
      fragmentShader: buildSkyFragmentShader(true),
      depthTest: false,
      depthWrite: false
    })
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
    this.mesh = new Mesh(geometry, this.material)
    this.mesh.frustumCulled = false
    // Камера прохода может смотреть на любые слои — треугольник обязан быть виден
    this.mesh.layers.enableAll()
  }

  /** Текстура слоя, если он нарисован в этом кадре */
  public get texture(): Texture | null {
    return this.active ? this.target.texture : null
  }

  public setSize(width: number, height: number): void {
    this.target.setSize(width, height)
  }

  /** sceneDepth — копия глубины сцены того же размера; background — кубмапа (режим cubemap) */
  public render(renderer: SkyLayerRenderer, camera: Camera, sceneDepth: Texture, background: CubeTexture | null): void {
    this.material.uniforms.uSceneDepth.value = sceneDepth
    this.material.uniforms.skybox.value = background
    const previous = renderer.getRenderTarget()
    renderer.setRenderTarget(this.target)
    renderer.render(this.mesh, camera)
    renderer.setRenderTarget(previous)
    this.active = true
  }

  public reset(): void {
    this.active = false
  }

  public dispose(): void {
    this.target.dispose()
    this.material.dispose()
    this.mesh.geometry.dispose()
  }
}
