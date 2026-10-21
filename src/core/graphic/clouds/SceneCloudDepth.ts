import {
  BasicDepthPacking,
  Color,
  DepthTexture,
  FloatType,
  Material,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  RedFormat,
  Scene,
  ShaderMaterial,
  Texture,
  UnsignedIntType,
  Vector2,
  Vector4,
  WebGLRenderer,
  WebGLRenderTarget
} from 'three'
import { DepthCopyPass } from 'postprocessing'
import { SpaceScale } from '@/core/constants'
import type { CloudFrame } from '@/core/clouds/scene/CloudFrame'
import { WaterMaterial } from '@/core/renderables/Water/WaterMaterial'
import { sceneCloudDepthFragment, sceneCloudDepthVertex } from './sceneCloudDepthShader'
import { CloudProgramWarmup } from '@/core/clouds/takram/CloudProgramWarmup'

export interface SceneCloudDepthFrame {
  texture: Texture
  sceneLogFarFactor: number
  sceneUnitsToMeters: number
  viewport: Vector2
  serial: number
}
export class SceneCloudDepth {
  private readonly opaque = new WebGLRenderTarget(1, 1)
  private readonly water = new WebGLRenderTarget(1, 1)
  private readonly opaqueCopy = new DepthCopyPass({ depthPacking: BasicDepthPacking })
  private readonly waterCopy = new DepthCopyPass({ depthPacking: BasicDepthPacking })
  private readonly resolved = new WebGLRenderTarget(1, 1, {
    type: FloatType,
    format: RedFormat,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    depthBuffer: false
  })
  private readonly viewport = new Vector2(1, 1)
  private readonly combineScene = new Scene()
  private readonly combineCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly combineMaterial = new ShaderMaterial({
    vertexShader: sceneCloudDepthVertex,
    fragmentShader: sceneCloudDepthFragment,
    depthTest: false,
    depthWrite: false,
    uniforms: { opaqueDepth: { value: null }, waterDepth: { value: null } }
  })
  private readonly quad = new Mesh(new PlaneGeometry(2, 2), this.combineMaterial)
  private readonly warmup = new CloudProgramWarmup()
  private warmupStarted = false
  public resetPreparation(): void {
    this.warmup.clear()
    this.warmupStarted = false
  }

  public prepare(frame: CloudFrame): boolean {
    if (!this.warmupStarted) {
      const renderer = this.renderer,
        target = renderer.getRenderTarget(),
        face = renderer.getActiveCubeFace(),
        mip = renderer.getActiveMipmapLevel()
      const viewport = renderer.getViewport(new Vector4()),
        scissor = renderer.getScissor(new Vector4()),
        test = renderer.getScissorTest()
      try {
        this.setSize(frame.viewport.x, frame.viewport.y)
        renderer.setRenderTarget(this.resolved)
        this.warmup.compile(renderer, this.combineScene, this.combineCamera)
        for (const pass of [this.opaqueCopy, this.waterCopy])
          this.warmup.compile(renderer, new Mesh(this.quad.geometry, pass.fullscreenMaterial!), this.combineCamera)
        this.scene.traverseVisible((object) => {
          const mesh = object as Mesh
          if (!mesh.isMesh) return
          for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
            if (material instanceof WaterMaterial) {
              const depth = material.getSceneCloudDepthMaterial(this.opaqueCopy.texture, frame.viewport)
              this.warmup.compile(renderer, new Mesh(mesh.geometry, depth), frame.sceneCamera, this.scene)
            }
        })
        this.warmupStarted = true
      } finally {
        renderer.setRenderTarget(target, face, mip)
        renderer.setViewport(viewport)
        renderer.setScissor(scissor)
        renderer.setScissorTest(test)
      }
    }
    return this.warmup.ready()
  }

  public constructor(
    private readonly renderer: WebGLRenderer,
    private readonly scene: Scene
  ) {
    const samples = renderer.getContext().getContextAttributes()?.antialias
      ? Math.min(4, renderer.capabilities.maxSamples)
      : 0
    for (const target of [this.opaque, this.water]) {
      target.depthTexture = new DepthTexture(1, 1, UnsignedIntType)
      target.samples = samples
    }
    this.opaqueCopy.setDepthTexture(this.opaque.depthTexture!, BasicDepthPacking)
    this.waterCopy.setDepthTexture(this.water.depthTexture!, BasicDepthPacking)
    this.opaqueCopy.initialize(renderer, false, FloatType)
    this.waterCopy.initialize(renderer, false, FloatType)
    this.combineScene.add(this.quad)
  }
  public setSize(width: number, height: number): void {
    this.viewport.set(width, height)
    for (const target of [this.opaque, this.water, this.resolved]) target.setSize(width, height)
    this.opaqueCopy.setSize(width, height)
    this.waterCopy.setSize(width, height)
  }
  public render(frame: CloudFrame): SceneCloudDepthFrame {
    if (!this.viewport.equals(frame.viewport)) this.setSize(frame.viewport.x, frame.viewport.y)
    const renderer = this.renderer
    const target = renderer.getRenderTarget()
    const cubeFace = renderer.getActiveCubeFace(),
      mip = renderer.getActiveMipmapLevel()
    const viewport = renderer.getViewport(new Vector4()),
      scissor = renderer.getScissor(new Vector4())
    const scissorTest = renderer.getScissorTest(),
      autoClear = renderer.autoClear
    const clearColor = renderer.getClearColor(new Color()),
      clearAlpha = renderer.getClearAlpha()
    const background = this.scene.background,
      override = this.scene.overrideMaterial
    const flags = new Map<Material, { visible: boolean; colorWrite: boolean; depthWrite: boolean }>()
    const meshes: Array<{ object: Mesh; material: Material | Material[] }> = []
    this.scene.traverseVisible((object) => {
      const mesh = object as Mesh
      if (!mesh.isMesh || !mesh.material) return
      meshes.push({ object: mesh, material: mesh.material })
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (!flags.has(material))
          flags.set(material, {
            visible: material.visible,
            colorWrite: material.colorWrite,
            depthWrite: material.depthWrite
          })
      }
    })
    try {
      this.scene.background = null
      this.scene.overrideMaterial = null
      renderer.autoClear = false
      renderer.setScissorTest(false)
      renderer.setClearColor(0, 0)
      for (const [material, saved] of flags) {
        material.visible =
          saved.visible && !(material instanceof WaterMaterial) && (!material.transparent || material.alphaTest > 0)
        material.colorWrite = false
        material.depthWrite = true
      }
      renderer.setRenderTarget(this.opaque)
      renderer.clear(true, true, true)
      renderer.render(this.scene, frame.sceneCamera)
      // Switching attachments resolves MSAA before DepthCopyPass samples the depth texture.
      renderer.setRenderTarget(null)
      this.opaqueCopy.render(renderer, null, null)
      for (const [material, saved] of flags) material.visible = saved.visible
      const waterMaterials = new Map<WaterMaterial, Material>()
      for (const material of flags.keys()) {
        if (material instanceof WaterMaterial)
          waterMaterials.set(material, material.getSceneCloudDepthMaterial(this.opaqueCopy.texture, this.viewport))
        else material.visible = false
      }
      for (const { object, material } of meshes) {
        const replace = (m: Material): Material => waterMaterials.get(m as WaterMaterial) ?? m
        object.material = Array.isArray(material) ? material.map(replace) : replace(material)
      }
      renderer.setRenderTarget(this.water)
      renderer.clear(true, true, true)
      renderer.render(this.scene, frame.sceneCamera)
      renderer.setRenderTarget(null)
      this.waterCopy.render(renderer, null, null)
      this.combineMaterial.uniforms.opaqueDepth.value = this.opaqueCopy.texture
      this.combineMaterial.uniforms.waterDepth.value = this.waterCopy.texture
      renderer.setRenderTarget(this.resolved)
      renderer.render(this.combineScene, this.combineCamera)
      return {
        texture: this.resolved.texture,
        sceneLogFarFactor: Math.log2(frame.sceneCamera.far + 1),
        sceneUnitsToMeters: 1000 / SpaceScale,
        viewport: this.viewport.clone(),
        serial: frame.serial
      }
    } finally {
      for (const { object, material } of meshes) object.material = material
      for (const [material, saved] of flags) Object.assign(material, saved)
      this.scene.background = background
      this.scene.overrideMaterial = override
      renderer.autoClear = autoClear
      renderer.setClearColor(clearColor, clearAlpha)
      renderer.setRenderTarget(target, cubeFace, mip)
      renderer.setViewport(viewport)
      renderer.setScissor(scissor)
      renderer.setScissorTest(scissorTest)
    }
  }
  public dispose(): void {
    this.warmup.clear()
    for (const target of [this.opaque, this.water, this.resolved]) target.dispose()
    this.opaqueCopy.dispose()
    this.waterCopy.dispose()
    this.quad.geometry.dispose()
    this.combineMaterial.dispose()
  }
}
