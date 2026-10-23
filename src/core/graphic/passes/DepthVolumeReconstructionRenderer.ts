import {
  AddEquation, AlwaysStencilFunc, BackSide, Color, CubeTexture, CustomBlending, Data3DTexture, DataArrayTexture, FloatType, Mesh, NearestFilter,
  NoBlending, NoColorSpace, NotEqualStencilFunc, OrthographicCamera, PlaneGeometry, ReplaceStencilOp,
  OneFactor, OneMinusSrcAlphaFactor, ShaderMaterial, Vector4, WebGLRenderTarget, type Camera, type Vector2, type WebGLRenderer
} from 'three'
import { isStencilDepthVolume, type DepthVolume, type StencilDepthVolume } from './DepthVolume'

interface Programs {
  source: ShaderMaterial
  version: number
  matched: ShaderMaterial
  fallback: ShaderMaterial
  proxy: Mesh
}

/** Skip expensive fallback fragments in hardware, without touching scene depth/stencil. */
export class DepthVolumeReconstructionRenderer {
  private readonly programs = new Map<StencilDepthVolume, Programs>()
  private target: WebGLRenderTarget | null = null
  private composite: Mesh<PlaneGeometry, ShaderMaterial> | null = null
  private readonly camera = new OrthographicCamera()
  private readonly viewport = new Vector4()
  private readonly clearColor = new Color()
  private readonly stencilClear = new Int32Array([0])

  public constructor(private readonly maxBytes = 64 * 1024 * 1024) {}

  public prepare(volumes: readonly DepthVolume[]): void {
    const active = new Set(volumes.filter(isStencilDepthVolume))
    for (const [volume, programs] of this.programs) if (!active.has(volume)) {
      programs.matched.dispose(); programs.fallback.dispose()
      this.programs.delete(volume)
    }
    if (!active.size) { this.target?.dispose(); this.target = null }
  }

  /** False leaves the caller's original combined reconstruction path available. */
  public render(renderer: WebGLRenderer, output: WebGLRenderTarget | null, camera: Camera, volume: DepthVolume, resolution: Vector2): boolean {
    if (!isStencilDepthVolume(volume) || !renderer.extensions?.has('EXT_color_buffer_float')) return false
    const width = resolution.x, height = resolution.y
    // RGBA32F + packed depth/stencil. Share one scratch target across volumes;
    // keep the original path at resolutions that exceed the additional budget.
    if (!Number.isFinite(this.maxBytes) || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height * 20 > this.maxBytes) return false
    // The full-screen composite must leave pixels outside the proxy unchanged.
    // Zero RGBA is neutral for this premultiplied-over blend contract.
    const source = volume.material
    if (!source.visible || source.alphaToCoverage || source.depthTest || source.depthWrite || source.stencilWrite || source.wireframe || source.side !== BackSide) return false
    if (source.blending !== CustomBlending || source.blendEquation !== AddEquation || source.blendSrc !== OneFactor || source.blendDst !== OneMinusSrcAlphaFactor ||
      (source.blendEquationAlpha ?? source.blendEquation) !== AddEquation || (source.blendSrcAlpha ?? source.blendSrc) !== OneFactor ||
      (source.blendDstAlpha ?? source.blendDst) !== OneMinusSrcAlphaFactor) return false
    if (output) {
      if ((output.samples > 0 && !volume.coversReconstructionViewport?.(camera)) || output.stencilBuffer || output.scissorTest || output.textures.length !== 1 ||
        output.texture instanceof CubeTexture || output.texture instanceof DataArrayTexture || output.texture instanceof Data3DTexture) return false
    } else {
      const attributes = renderer.getContext().getContextAttributes()
      if (!attributes || attributes.antialias || attributes.stencil) return false
    }
    renderer.getCurrentViewport(this.viewport)
    if (renderer.getScissorTest() || this.viewport.x !== 0 || this.viewport.y !== 0 || this.viewport.z !== width || this.viewport.w !== height) return false

    if (!this.target) {
      this.target = new WebGLRenderTarget(width, height, { type: FloatType, depthBuffer: true, stencilBuffer: true,
        minFilter: NearestFilter, magFilter: NearestFilter, colorSpace: NoColorSpace, generateMipmaps: false })
      this.target.texture.name = 'DepthVolume stencil reconstruction'
    } else this.target.setSize(width, height)
    const programs = this.programsFor(volume), composite = this.composite ??= this.createComposite()
    volume.updateWorldMatrix(true, false)
    programs.proxy.geometry = volume.geometry
    programs.proxy.matrix.copy(volume.matrixWorld)
    programs.proxy.matrixWorldNeedsUpdate = true
    programs.proxy.layers.mask = volume.layers.mask
    programs.proxy.visible = volume.visible
    const material = composite.material
    material.uniforms.map.value = this.target.texture
    material.blending = source.blending
    material.blendEquation = source.blendEquation; material.blendEquationAlpha = source.blendEquationAlpha
    material.blendSrc = source.blendSrc; material.blendSrcAlpha = source.blendSrcAlpha
    material.blendDst = source.blendDst; material.blendDstAlpha = source.blendDstAlpha
    material.blendColor.copy(source.blendColor); material.blendAlpha = source.blendAlpha
    material.premultipliedAlpha = source.premultipliedAlpha
    material.colorWrite = source.colorWrite

    const previousTarget = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel()
    const autoClear = renderer.autoClear, alpha = renderer.getClearAlpha()
    renderer.getClearColor(this.clearColor)
    try {
      renderer.autoClear = false
      renderer.setRenderTarget(this.target)
      renderer.setClearColor(0, 0)
      renderer.state.buffers.color.setMask(true)
      renderer.clear(true, false, false)
      // Do not inherit or alter the caller's gl.clearStencil value.
      renderer.state.buffers.stencil.setMask(0xffffffff)
      const gl = renderer.getContext() as WebGL2RenderingContext
      gl.clearBufferiv(gl.STENCIL, 0, this.stencilClear)
      programs.proxy.material = programs.matched
      renderer.render(programs.proxy, camera)
      programs.proxy.material = programs.fallback
      renderer.render(programs.proxy, camera)
      renderer.setRenderTarget(output)
      renderer.render(composite, this.camera)
      return true
    } finally {
      renderer.setRenderTarget(previousTarget, face, mip)
      renderer.setClearColor(this.clearColor, alpha)
      renderer.autoClear = autoClear
    }
  }

  private programsFor(volume: StencilDepthVolume): Programs {
    const source = volume.material
    let programs = this.programs.get(volume)
    if (programs && programs.source !== source) {
      programs.matched.dispose(); programs.fallback.dispose()
      this.programs.delete(volume); programs = undefined
    }
    if (!programs) {
      const matched = new ShaderMaterial({ depthTest: false, depthWrite: false, blending: NoBlending,
        stencilWrite: true, stencilRef: 1, stencilFunc: AlwaysStencilFunc, stencilZPass: ReplaceStencilOp })
      const fallback = new ShaderMaterial({ depthTest: false, depthWrite: false, blending: NoBlending,
        stencilWrite: true, stencilRef: 1, stencilFunc: NotEqualStencilFunc, stencilWriteMask: 0 })
      const proxy = new Mesh(volume.geometry, matched)
      proxy.frustumCulled = false; proxy.matrixAutoUpdate = false
      proxy.onBeforeRender = (renderer, scene, camera, geometry, _material, group) => {
        volume.onBeforeRender(renderer, scene, camera, geometry, volume.material, group)
        volume.material.onBeforeRender(renderer, scene, camera, geometry, volume, group)
      }
      programs = { source, version: -1, matched, fallback, proxy }
      this.programs.set(volume, programs)
    }
    for (const [variant, mode] of [[programs.matched, 'DEPTH_VOLUME_RECONSTRUCT'], [programs.fallback, 'DEPTH_VOLUME_FALLBACK']] as const) {
      // Borrow uniforms and textures; these programs never own density/noise maps.
      variant.uniforms = source.uniforms
      if (programs.version !== source.version) {
        variant.vertexShader = source.vertexShader; variant.fragmentShader = source.fragmentShader
        variant.glslVersion = source.glslVersion; variant.side = source.side
        variant.defines = { ...source.defines, [mode]: '' }
        variant.needsUpdate = true
      }
    }
    programs.version = source.version
    return programs
  }

  private createComposite(): Mesh<PlaneGeometry, ShaderMaterial> {
    return new Mesh(new PlaneGeometry(2, 2), new ShaderMaterial({
      uniforms: { map: { value: null } }, depthTest: false, depthWrite: false, transparent: true,
      vertexShader: 'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',
      fragmentShader: 'uniform sampler2D map; void main(){gl_FragColor=texelFetch(map,ivec2(gl_FragCoord.xy),0);}'
    }))
  }

  public dispose(): void {
    this.prepare([])
    this.composite?.geometry.dispose(); this.composite?.material.dispose(); this.composite = null
  }
}
