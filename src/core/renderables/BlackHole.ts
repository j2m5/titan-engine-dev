import { RenderableObject } from '@/core/renderables/RenderableObject'
import { IRenderable } from '@/core/renderables/IRenderable'
import {
  BufferGeometry,
  CylinderGeometry,
  FloatType,
  Group,
  LinearFilter,
  Mesh,
  Object3D,
  PlaneGeometry,
  RedFormat,
  Scene,
  Vector3,
  WebGLRenderTarget
} from 'three'
import { Actor } from '@/core/models/Actor'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { AccretionDiskMaterial } from '@/core/materials/BlackHole/AccretionDiskMaterial'
import { BlackHoleDistortionActiveMaterial } from '@/core/materials/BlackHole/BlackHoleDistortionActiveMaterial'
import { BlackHoleDistortionMaskMaterial } from '@/core/materials/BlackHole/BlackHoleDistortionMaskMaterial'
import { FinalMaterial } from '@/core/materials/BlackHole/FinalMaterial'
import { threeJS } from '@/core/graphic/ThreeJS'

class BlackHole extends RenderableObject implements IRenderable {
  private readonly model: Actor
  public object3D: Object3D
  public group: Group

  private readonly distortionActiveGeometry: BufferGeometry
  private readonly distortionActiveMaterial: AbstractShaderMaterial
  private readonly distortionActiveMesh: Mesh

  private readonly distortionMaskGeometry: BufferGeometry
  private readonly distortionMaskMaterial: AbstractShaderMaterial
  private readonly distortionMaskMesh: Mesh

  private readonly accretionDiskGeometry: BufferGeometry
  private readonly accretionDiskMaterial: AbstractShaderMaterial
  private readonly accretionDiskMesh: Mesh

  private readonly finalPlaneGeometry: BufferGeometry
  private readonly finalPlaneMaterial: AbstractShaderMaterial
  private readonly finalPlaneMesh: Mesh

  private readonly spaceRenderTarget: WebGLRenderTarget
  private readonly distortionRenderTarget: WebGLRenderTarget

  private readonly distortionScene: Scene
  private readonly finalScene: Scene
  private readonly screenPosition: Vector3 = new Vector3()

  public constructor(model: Actor) {
    super()
    this.model = model
    this.object3D = new Object3D()
    this.group = new Group()

    this.distortionActiveGeometry = new PlaneGeometry(1, 1)
    this.distortionActiveMaterial = new BlackHoleDistortionActiveMaterial()
    this.distortionActiveMesh = new Mesh(this.distortionActiveGeometry, this.distortionActiveMaterial)

    this.distortionMaskGeometry = new PlaneGeometry(1, 1)
    this.distortionMaskMaterial = new BlackHoleDistortionMaskMaterial()
    this.distortionMaskMesh = new Mesh(this.distortionMaskGeometry, this.distortionMaskMaterial)

    this.accretionDiskGeometry = new CylinderGeometry(5, 1, 0, 64, 10, true)
    this.accretionDiskMaterial = new AccretionDiskMaterial()
    this.accretionDiskMesh = new Mesh(this.accretionDiskGeometry, this.accretionDiskMaterial)
    this.accretionDiskMesh.rotateX(Math.PI / 2)

    this.finalPlaneGeometry = new PlaneGeometry(2, 2)
    this.finalPlaneMaterial = new FinalMaterial()
    this.finalPlaneMesh = new Mesh(this.finalPlaneGeometry, this.finalPlaneMaterial)

    this.spaceRenderTarget = new WebGLRenderTarget(window.innerWidth, window.innerHeight, {
      magFilter: LinearFilter,
      minFilter: LinearFilter
    })
    this.distortionRenderTarget = new WebGLRenderTarget(window.innerWidth * 0.5, window.innerHeight * 0.5, {
      magFilter: LinearFilter,
      minFilter: LinearFilter,
      format: RedFormat,
      type: FloatType
    })

    this.finalPlaneMaterial.uniforms.spaceTexture.value = this.spaceRenderTarget.texture
    this.finalPlaneMaterial.uniforms.distortionTexture.value = this.distortionRenderTarget.texture

    this.distortionScene = new Scene()
    this.finalScene = new Scene()

    this.distortionActiveMesh.scale.multiplyScalar(10)
    this.distortionMaskMesh.scale.multiplyScalar(10)
    this.distortionMaskMesh.rotateX(Math.PI / 2)

    this.distortionScene.add(this.distortionActiveMesh, this.distortionMaskMesh)
    this.finalScene.add(this.finalPlaneMesh)
  }

  public build(): Object3D {
    this.object3D.name = this.model.getAttribute('name') + 'Base'
    this.object3D.add(this.accretionDiskMesh)

    return this.object3D
  }

  public update(delta?: number): void {
    this.screenPosition.setFromMatrixPosition(this.object3D.matrixWorld).project(threeJS.camera)
    this.screenPosition.x = this.screenPosition.x * 0.5 + 0.5
    this.screenPosition.y = this.screenPosition.y * 0.5 + 0.5

    this.accretionDiskMaterial.uniforms.time.value = performance.now() / 20000
    this.distortionActiveMesh.lookAt(threeJS.camera.position)

    this.finalPlaneMaterial.uniforms.blackHolePosition.value.set(this.screenPosition.x, this.screenPosition.y)

    threeJS.renderer.autoClearColor = false

    threeJS.renderer.setRenderTarget(this.spaceRenderTarget)
    threeJS.renderer.clear()
    threeJS.renderer.render(threeJS.scene, threeJS.camera)

    threeJS.renderer.setRenderTarget(this.distortionRenderTarget)
    threeJS.renderer.clear()
    threeJS.renderer.render(this.distortionScene, threeJS.camera)

    threeJS.renderer.setRenderTarget(null)
    threeJS.renderer.render(this.finalScene, threeJS.camera)

    threeJS.renderer.autoClearColor = true
  }
}

export { BlackHole }
