import {
  Camera,
  DepthTexture,
  InstancedMesh,
  MathUtils,
  Matrix4,
  NearestFilter,
  Object3D,
  OrthographicCamera,
  RedFormat,
  Scene,
  ShaderMaterial,
  UnsignedIntType,
  Vector3,
  Vector4,
  WebGLRenderer,
  WebGLRenderTarget
} from 'three'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { createBoulderShadowUniforms } from '@/core/materials/shaders/lib/chunks/BoulderShadow'
import {
  BoulderShadowFrame,
  BOULDER_SHADOW_DEPTH_METERS,
  BOULDER_SHADOW_SIZE,
  BOULDER_SHADOW_WIDTH_METERS
} from './boulderShadowFrame'

const UNIT = toThreeJSUnits(0.001)

/** One body-local depth pass shared by the ground and all visible boulder variants. */
export class TerrainBoulderShadows {
  private readonly frame: BoulderShadowFrame
  private readonly uniforms: ReturnType<typeof createBoulderShadowUniforms>
  private readonly scene = new Scene()
  private readonly camera: OrthographicCamera
  // Deliberately linear depth: the main renderer's logarithmic-depth chunks must not enter this pass.
  private readonly depthMaterial = new ShaderMaterial({
    name: 'Boulder linear shadow depth',
    colorWrite: false,
    vertexShader: `attribute vec2 boulderState; varying float vFade;
      void main() {
        vFade = boulderState.x;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `varying float vFade;
      void main() {
        float threshold = fract(52.9829189 * fract(dot(floor(gl_FragCoord.xy), vec2(0.06711056, 0.00583715))));
        if (vFade <= threshold) discard;
        gl_FragColor = vec4(1.0);
      }`
  })
  private readonly proxies: InstancedMesh[]
  private readonly unbind: (() => void)[] = []
  private readonly receivers = new Set<ShaderMaterial>()
  private readonly matrix = new Matrix4()
  private readonly radial = new Vector3()
  private readonly viewport = new Vector4()
  private readonly scissor = new Vector4()
  private readonly targetViewport = new Vector4()
  private readonly targetScissor = new Vector4()
  private target: WebGLRenderTarget | null = null
  private pending = false
  private strength = 0
  private disposed = false

  public constructor(
    private readonly host: Object3D,
    private readonly renderer: WebGLRenderer,
    private readonly meshes: readonly InstancedMesh[],
    private readonly sizeScale = 1
  ) {
    this.frame = new BoulderShadowFrame(sizeScale)
    this.uniforms = createBoulderShadowUniforms(sizeScale)
    const half = (BOULDER_SHADOW_WIDTH_METERS * UNIT * sizeScale) / 2
    this.camera = new OrthographicCamera(-half, half, half, -half, 0, BOULDER_SHADOW_DEPTH_METERS * UNIT * sizeScale)
    this.proxies = meshes.map((mesh) => {
      const proxy = new InstancedMesh(mesh.geometry, this.depthMaterial, 0)
      proxy.instanceMatrix = mesh.instanceMatrix
      proxy.frustumCulled = false
      this.scene.add(proxy)
      return proxy
    })
  }

  public bind(material: ShaderMaterial): void {
    if (this.disposed || this.receivers.has(material)) return
    this.receivers.add(material)
    Object.assign(material.uniforms, this.uniforms)
    const previous = material.onBeforeRender
    const callback: ShaderMaterial['onBeforeRender'] = (...args) => {
      previous.apply(material, args)
      this.beforeReceiver(args[2])
      material.uniformsNeedUpdate = true
    }
    material.onBeforeRender = callback
    this.unbind.push(() => {
      if (material.onBeforeRender === callback) material.onBeforeRender = previous
    })
  }

  public update(cameraLocal: Vector3, sunLocal: Vector3, anchor: Vector3): void {
    if (this.disposed) return
    if (!this.meshes.some((mesh) => mesh.count > 0) || !this.frame.update(cameraLocal, sunLocal)) {
      this.hide()
      return
    }
    this.strength = MathUtils.smoothstep(this.radial.copy(cameraLocal).normalize().dot(this.frame.sun), 0.01, 0.04)
    if (this.strength === 0) {
      this.hide()
      return
    }
    this.proxies.forEach((proxy, i) => {
      proxy.count = this.meshes[i].count
      proxy.position.copy(anchor).sub(this.frame.origin)
    })
    this.camera.position.copy(this.frame.sun).multiplyScalar((BOULDER_SHADOW_DEPTH_METERS * UNIT * this.sizeScale) / 2)
    this.camera.up.copy(this.frame.up)
    this.camera.lookAt(0, 0, 0)
    this.pending = true
  }

  private beforeReceiver(camera: Camera): void {
    if (this.disposed) return
    // Runs inside the enclosing render/timer, and only once even when many terrain patches receive it.
    if (this.pending) this.renderDepth()
    if (!this.target) return
    this.frame.viewToShadow(this.host.matrixWorld, camera.matrixWorld, this.matrix)
    this.uniforms.uBoulderShadowMatrix.value.copy(this.matrix)
    this.uniforms.uBoulderShadowMap.value = this.target.depthTexture
    this.uniforms.uBoulderShadowStrength.value = this.strength
  }

  private renderDepth(): void {
    const r = this.renderer
    const previous = r.getRenderTarget(),
      face = r.getActiveCubeFace(),
      mip = r.getActiveMipmapLevel()
    const gl = r.getContext()
    r.getCurrentViewport(this.viewport)
    this.scissor.fromArray(gl.getParameter(gl.SCISSOR_BOX) as Int32Array)
    const scissorTest = gl.isEnabled(gl.SCISSOR_TEST)
    const autoClear = r.autoClear,
      color = r.autoClearColor,
      depth = r.autoClearDepth,
      stencil = r.autoClearStencil,
      xr = r.xr.enabled,
      shadowUpdate = r.shadowMap.autoUpdate,
      autoReset = r.info.autoReset
    try {
      if (!this.target) {
        this.target = new WebGLRenderTarget(BOULDER_SHADOW_SIZE, BOULDER_SHADOW_SIZE, {
          format: RedFormat,
          minFilter: NearestFilter,
          magFilter: NearestFilter,
          generateMipmaps: false
        })
        this.target.depthTexture = new DepthTexture(BOULDER_SHADOW_SIZE, BOULDER_SHADOW_SIZE, UnsignedIntType)
      }
      r.xr.enabled = false
      r.shadowMap.autoUpdate = false
      r.info.autoReset = false
      // WebGLBackground enables depth writes before auto-clear, even after a depthWrite:false pass.
      r.autoClear = true
      r.autoClearColor = false
      r.autoClearDepth = true
      r.autoClearStencil = false
      r.setRenderTarget(this.target)
      r.render(this.scene, this.camera)
      this.pending = false
    } catch (error) {
      this.hide()
      throw error
    } finally {
      if (previous) {
        // A caller can override the active area after binding its target. Rebind with
        // that area to restore Three's current viewport as well as GL, without changing
        // its separate logical canvas viewport. Preserve the target's own defaults.
        this.targetViewport.copy(previous.viewport)
        this.targetScissor.copy(previous.scissor)
        const targetScissorTest = previous.scissorTest
        previous.viewport.copy(this.viewport)
        previous.scissor.copy(this.scissor)
        previous.scissorTest = scissorTest
        try {
          r.setRenderTarget(previous, face, mip)
        } finally {
          previous.viewport.copy(this.targetViewport)
          previous.scissor.copy(this.targetScissor)
          previous.scissorTest = targetScissorTest
        }
      } else {
        r.setRenderTarget(null, face, mip)
        // Also retain an ArrayCamera eye's physical area on the default framebuffer.
        r.state.viewport(this.viewport)
        r.state.scissor(this.scissor)
        r.state.setScissorTest(scissorTest)
      }
      r.autoClear = autoClear
      r.autoClearColor = color
      r.autoClearDepth = depth
      r.autoClearStencil = stencil
      r.xr.enabled = xr
      r.shadowMap.autoUpdate = shadowUpdate
      r.info.autoReset = autoReset
    }
  }

  public hide(): void {
    this.pending = false
    this.strength = 0
    this.uniforms.uBoulderShadowStrength.value = 0
    this.uniforms.uBoulderShadowMap.value = null
    this.target?.dispose()
    this.target = null
  }

  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.hide()
    for (const unbind of this.unbind) unbind()
    this.unbind.length = 0
    this.receivers.clear()
    // Geometry belongs to the live layer; only dispose proxy-specific state here.
    for (const proxy of this.proxies) proxy.dispose()
    this.scene.clear()
    this.depthMaterial.dispose()
  }
}
