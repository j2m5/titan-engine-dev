import { RenderableObject } from '@/core/renderables/RenderableObject'
import { IRenderable } from '@/core/renderables/IRenderable'
import { Actor } from '@/core/models/Actor'
import {
  BufferGeometry,
  CylinderGeometry,
  FloatType,
  Group,
  LinearFilter,
  Mesh,
  NormalBlending,
  Object3D,
  PlaneGeometry,
  RedFormat,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderTarget
} from 'three'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { BlackHoleDistortionMaterial } from '@/core/materials/BlackHole/V2/BlackHoleDistortionMaterial'
import { threeJS } from '@/core/graphic/ThreeJS'
import { AccretionDiskMaterial } from '@/core/materials/BlackHole/AccretionDiskMaterial.ts'
// какая то багованная хуйня палучается

class BlackHoleV2 extends RenderableObject implements IRenderable {
  private readonly model: Actor
  public object3D: Object3D
  public group: Group

  private readonly screenPosition: Vector3 = new Vector3()

  private readonly inputRenderTarget: WebGLRenderTarget
  private readonly blackHoleRenderTarget: WebGLRenderTarget
  private readonly maskRenderTarget: WebGLRenderTarget

  private readonly blackHoleScene: Scene
  private readonly maskScene: Scene
  private readonly finalScene: Scene

  private readonly distortionGeometry: BufferGeometry
  private readonly distortionMaterial: AbstractShaderMaterial
  private readonly distortionMesh: Mesh

  private readonly maskGeometry: BufferGeometry
  private readonly maskMaterial: ShaderMaterial
  private readonly maskMesh: Mesh

  private readonly finalGeometry: BufferGeometry
  private readonly finalMaterial: ShaderMaterial
  private readonly finalMesh: Mesh

  public constructor(model: Actor) {
    super()
    this.model = model

    this.object3D = new Object3D()
    this.group = new Group()

    this.inputRenderTarget = new WebGLRenderTarget(window.innerWidth, window.innerHeight, {
      magFilter: LinearFilter,
      minFilter: LinearFilter
    })

    this.blackHoleRenderTarget = new WebGLRenderTarget(window.innerWidth, window.innerHeight, {
      format: RGBAFormat,
      magFilter: LinearFilter,
      minFilter: LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false
    })

    this.maskRenderTarget = new WebGLRenderTarget(window.innerWidth, window.innerHeight, {
      format: RedFormat,
      type: FloatType,
      magFilter: LinearFilter,
      minFilter: LinearFilter,
      depthBuffer: false,
      stencilBuffer: false
    })

    this.blackHoleScene = new Scene()
    this.maskScene = new Scene()
    this.finalScene = new Scene()

    this.distortionGeometry = new PlaneGeometry(4, 4)
    this.distortionMaterial = new BlackHoleDistortionMaterial()
    this.distortionMesh = new Mesh(this.distortionGeometry, this.distortionMaterial)

    this.maskGeometry = new PlaneGeometry(4, 4)
    this.maskMaterial = new ShaderMaterial({
      uniforms: {
        blackHolePosition: { value: new Vector3() },
        fadeRadius: { value: 0.35 },
        coreRadius: { value: 0.2 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          vUv = uv;
        }
      `,
      fragmentShader: `
        uniform vec3 blackHolePosition;
        uniform float fadeRadius;
        uniform float coreRadius;
        varying vec2 vUv;

        float inverseLerp(float v, float a, float b) {
          return (v - a) / (b - a);
        }

        float remap(float v, float inMin, float inMax, float outMin, float outMax) {
          return mix(outMin, outMax, inverseLerp(v, inMin, inMax));
        }

        void main() {
          vec2 blackHoleScreen = blackHolePosition.xy;
          float distanceToCenter = length(vUv - 0.5);

          float mask = smoothstep(fadeRadius, coreRadius, distanceToCenter);

          gl_FragColor = vec4(mask, 0.0, 0.0, 1.0);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: false
    })
    this.maskMesh = new Mesh(this.maskGeometry, this.maskMaterial)

    this.finalGeometry = new PlaneGeometry(2, 2)
    this.finalMaterial = new ShaderMaterial({
      uniforms: {
        spaceTexture: { value: this.inputRenderTarget.texture },
        blackHoleTexture: { value: this.blackHoleRenderTarget.texture },
        maskTexture: { value: this.maskRenderTarget.texture },
        blackHolePosition: { value: new Vector3() }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          gl_Position = vec4(position, 1.0);
          vUv = uv;
        }
      `,
      fragmentShader: `
        uniform sampler2D spaceTexture;
        uniform sampler2D blackHoleTexture;
        uniform sampler2D maskTexture;
        uniform vec3 blackHolePosition;

        varying vec2 vUv;

        void main() {
          vec4 spaceColor = texture2D(spaceTexture, vUv);
          vec4 blackHoleColor = texture2D(blackHoleTexture, vUv);
          vec4 mask = texture2D(maskTexture, vUv);

          float influence = mask.r * mask.a;

          vec3 finalColor = spaceColor.rgb;

          if (influence > 0.01) {
            float blackHoleIntensity = length(blackHoleColor.rgb);

            if (blackHoleIntensity > 0.01) {
              finalColor = mix(spaceColor.rgb, blackHoleColor.rgb, influence);
            } else {
              finalColor = mix(spaceColor.rgb, vec3(0.0), influence);
            }
          }

          gl_FragColor = vec4(finalColor, 1.0);
        }
      `,
      transparent: true,
      blending: NormalBlending,
      depthWrite: false,
      depthTest: false
    })
    this.finalMesh = new Mesh(this.finalGeometry, this.finalMaterial)

    this.distortionMaterial.uniforms.starMap.value = this.inputRenderTarget.texture

    this.blackHoleScene.add(this.distortionMesh)
    this.maskScene.add(this.maskMesh)
    this.finalScene.add(this.finalMesh)
  }

  public build(): Object3D {
    this.object3D.name = this.model.getAttribute('name') + 'Base'
    this.group.name = this.model.getAttribute('name')

    const accretionDiskGeometry = new CylinderGeometry(5, 1, 0, 64, 10, true)
    const accretionDiskMaterial = new AccretionDiskMaterial()
    const accretionDiskMesh = new Mesh(accretionDiskGeometry, accretionDiskMaterial)
    accretionDiskMesh.rotateX(Math.PI / 2)

    this.object3D.add(accretionDiskMesh)
    this.group.add(this.object3D)

    return this.object3D
  }

  public update(delta?: number): void {
    this.updateRenderTargets()

    this.screenPosition.setFromMatrixPosition(this.object3D.matrixWorld).project(threeJS.camera)
    this.screenPosition.x = this.screenPosition.x * 0.5 + 0.5
    this.screenPosition.y = this.screenPosition.y * 0.5 + 0.5

    const cameraPosition: Vector3 = threeJS.camera.getWorldPosition(new Vector3())
    this.distortionMaterial.uniforms.cameraWorldPosition.value.copy(cameraPosition)

    this.maskMaterial.uniforms.blackHolePosition.value.copy(this.screenPosition)
    this.finalMaterial.uniforms.blackHolePosition.value.copy(this.screenPosition)

    this.distortionMesh.lookAt(threeJS.camera.position)
    this.maskMesh.lookAt(threeJS.camera.position)

    threeJS.renderer.setRenderTarget(this.inputRenderTarget)
    threeJS.renderer.clear()
    threeJS.renderer.render(threeJS.scene, threeJS.camera)

    threeJS.renderer.setRenderTarget(this.blackHoleRenderTarget)
    threeJS.renderer.setClearColor(0x000000, 1)
    threeJS.renderer.clear()
    threeJS.renderer.render(this.blackHoleScene, threeJS.camera)

    threeJS.renderer.setRenderTarget(this.maskRenderTarget)
    threeJS.renderer.setClearColor(0x000000, 0)
    threeJS.renderer.clear()
    threeJS.renderer.render(this.maskScene, threeJS.camera)

    threeJS.renderer.setRenderTarget(null)
    threeJS.renderer.render(this.finalScene, threeJS.camera)
  }

  private updateRenderTargets(): void {
    const width: number = window.innerWidth
    const height: number = window.innerHeight

    if (this.inputRenderTarget.width !== width || this.inputRenderTarget.height !== height) {
      this.inputRenderTarget.setSize(width, height)
      this.blackHoleRenderTarget.setSize(width, height)

      this.maskRenderTarget.setSize(width, height)
    }
  }
}

export { BlackHoleV2 }
