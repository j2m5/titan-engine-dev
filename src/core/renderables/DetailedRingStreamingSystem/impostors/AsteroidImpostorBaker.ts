import {
  Box2, BufferAttribute, BufferGeometry, Camera, Color, GLSL3, Mesh, NoBlending, OrthographicCamera,
  RawShaderMaterial, Scene, Vector2, Vector3, Vector4, type WebGLRenderer, type WebGLRenderTarget
} from 'three'
import { frameBasis, type ImpostorLayout } from './impostorLayout'
import { createImpostorScratch, impostorScratchBytes } from './impostorResources'
import { impostorBakeFragment, impostorBakeVertex, impostorMipFragment, impostorMipVertex } from './impostorBakeShaders'
import type { ImpostorAtlas, ImpostorBakerPort } from './impostorTypes'
import { forgetImpostorContext, rememberImpostorContext } from './impostorContext'
import { ImpostorTextureCopy } from './impostorCopy'

interface BakeJob {
  geometry: BufferGeometry
  atlas: ImpostorAtlas
  layer: number
  boundRadius: number
  halfExtent: number
  phase: 'capture' | 'mips' | 'copy' | 'complete'
  view: number
  mip: number
  operation: number
}

export class AsteroidImpostorBaker implements ImpostorBakerPort {
  readonly scratchBytes: number
  private readonly scratch: ReturnType<typeof createImpostorScratch>
  private readonly captureMaterial = new RawShaderMaterial({
    glslVersion: GLSL3, vertexShader: impostorBakeVertex, fragmentShader: impostorBakeFragment,
    uniforms: { captureDirection: { value: new Vector3() }, halfExtent: { value: 1 } },
    blending: NoBlending, toneMapped: false
  })
  private readonly mipMaterial: RawShaderMaterial
  private readonly captureScene = new Scene()
  private readonly mipScene = new Scene()
  private readonly captureCamera = new OrthographicCamera()
  private readonly mipCamera = new Camera()
  private readonly captureMesh = new Mesh(new BufferGeometry(), this.captureMaterial)
  private readonly mipGeometry = new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
  private job: BakeJob | null = null
  private disposed = false
  private readonly checkedTargets = new Set<WebGLRenderTarget>()
  private readonly copier: ImpostorTextureCopy

  constructor(private readonly renderer: WebGLRenderer, private readonly layout: ImpostorLayout, samples: number) {
    this.scratchBytes = impostorScratchBytes(layout, samples)
    this.scratch = createImpostorScratch(renderer, layout, samples)
    try { this.copier = new ImpostorTextureCopy(renderer) }
    catch (error) {
      if (renderer.getContext().isContextLost()) this.scratch.invalidateGpu()
      this.scratch.dispose()
      throw error
    }
    this.mipMaterial = new RawShaderMaterial({
      glslVersion: GLSL3, vertexShader: impostorMipVertex, fragmentShader: impostorMipFragment,
      uniforms: {
        normalDepthMap: { value: this.scratch.staging.textures[0] },
        surfaceCoverageMap: { value: this.scratch.staging.textures[1] }, sourceMip: { value: 0 }
      }, depthTest: false, depthWrite: false, blending: NoBlending, toneMapped: false
    })
    this.captureMesh.frustumCulled = false
    this.captureScene.add(this.captureMesh)
    const quad = new Mesh(this.mipGeometry, this.mipMaterial)
    quad.frustumCulled = false
    this.mipScene.add(quad)
    rememberImpostorContext(this.mipGeometry, this.captureMaterial, this.mipMaterial)
  }

  get temporaryGeometryBytes(): number {
    const geometry = this.job?.geometry
    if (!geometry) return 0
    return Object.values(geometry.attributes).reduce((sum, attribute) => sum + attribute.array.byteLength, geometry.index?.array.byteLength ?? 0)
  }

  begin(source: BufferGeometry, atlas: ImpostorAtlas, layer: number): void {
    if (this.disposed || this.job) throw new Error('Baker недоступен')
    if (!Number.isInteger(layer) || layer < 0 || layer >= atlas.layerCount) throw new RangeError('Слой вне атласа')
    if (atlas.layout.gridSize !== this.layout.gridSize || atlas.layout.frameSize !== this.layout.frameSize) throw new Error('Несовместимый атлас')
    const positions = source.getAttribute('position')
    if (!positions || positions.count === 0) throw new Error('Пустая форма')
    let boundRadius = 0
    for (let i = 0; i < positions.count; i++) boundRadius = Math.max(boundRadius, Math.hypot(positions.getX(i), positions.getY(i), positions.getZ(i)))
    if (!Number.isFinite(boundRadius) || boundRadius <= 0) throw new Error('Вырожденная форма')
    const geometry = new BufferGeometry().setAttribute('position', positions.clone())
    if (source.index) geometry.setIndex(source.index.clone())
    const normals = source.getAttribute('normal'), surface = source.getAttribute('surfaceData')
    if (normals) geometry.setAttribute('normal', normals.clone())
    else geometry.computeVertexNormals()
    geometry.setAttribute('surfaceData', surface ? surface.clone() : new BufferAttribute(new Float32Array(positions.count * 4), 4))
    this.captureMesh.geometry = geometry
    rememberImpostorContext(geometry)
    this.job = { geometry, atlas, layer, boundRadius, halfExtent: boundRadius * 1.05, phase: 'capture', view: 0, mip: 1, operation: 0 }
  }

  step(maxViews: number, maxCpuMs: number): 'pending' | 'complete' {
    const job = this.job
    if (!job || this.disposed) throw new Error('Нет активного запекания')
    if (job.phase === 'complete') return 'complete'
    if (!(maxViews >= 1) || !(maxCpuMs > 0)) throw new RangeError('Пустая порция запекания')
    const r = this.renderer
    if (r.getContext().isContextLost()) throw new Error('Контекст WebGL потерян')
    const state = {
      target: r.getRenderTarget(), layer: r.getActiveCubeFace(), mip: r.getActiveMipmapLevel(),
      viewport: r.getViewport(new Vector4()), scissor: r.getScissor(new Vector4()),
      scissorTest: r.getScissorTest(), color: r.getClearColor(new Color()), alpha: r.getClearAlpha(), autoClear: r.autoClear
    }
    const start = performance.now()
    let captures = 0
    try {
      r.autoClear = false
      r.setScissorTest(false)
      r.setClearColor(0, 0)
      do {
        if (r.getContext().isContextLost()) throw new Error('Контекст WebGL потерян')
        if (job.phase === 'capture' && job.operation === 0) {
          if (captures >= maxViews) break
          captures++
        }
        this.advance(job)
      } while (!this.complete(job) && performance.now() - start < maxCpuMs)
    } finally {
      if (!r.getContext().isContextLost()) {
        r.setViewport(state.viewport)
        r.setScissor(state.scissor)
        r.setScissorTest(state.scissorTest)
        r.setRenderTarget(state.target, state.layer, state.mip)
        r.setClearColor(state.color, state.alpha)
      }
      r.autoClear = state.autoClear
    }
    return this.complete(job) ? 'complete' : 'pending'
  }

  private complete(job: BakeJob): boolean { return job.phase === 'complete' }

  private copy(...args: Parameters<ImpostorTextureCopy['copy']>): void {
    this.copier.copy(...args)
  }

  private checkFramebuffer(target: WebGLRenderTarget): void {
    if (this.checkedTargets.has(target)) return
    const gl = this.renderer.getContext()
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Неполный framebuffer импостора')
    this.checkedTargets.add(target)
  }

  private advance(job: BakeJob): void {
    const r = this.renderer, layout = this.layout
    if (job.phase === 'capture') {
      if (job.operation === 0) {
        const basis = frameBasis(job.view, layout), h = job.halfExtent, camera = this.captureCamera
        camera.left = camera.bottom = -h
        camera.right = camera.top = h
        camera.near = h
        camera.far = 5 * h
        camera.position.copy(basis.direction).multiplyScalar(3 * h)
        camera.up.copy(basis.up)
        camera.lookAt(0, 0, 0)
        camera.updateProjectionMatrix()
        this.captureMaterial.uniforms.captureDirection.value.copy(basis.direction)
        this.captureMaterial.uniforms.halfExtent.value = h
        this.scratch.tile.viewport.set(0, 0, layout.frameSize, layout.frameSize)
        r.setRenderTarget(this.scratch.tile)
        this.checkFramebuffer(this.scratch.tile)
        r.clear(true, true, false)
        r.render(this.captureScene, camera)
      } else {
        const attachment = job.operation - 1
        const offset = new Vector2((job.view % layout.gridSize) * layout.frameSize, Math.floor(job.view / layout.gridSize) * layout.frameSize)
        this.copy(this.scratch.tile.textures[attachment], this.scratch.staging.textures[attachment], null, offset, 0, 0)
      }
      if (++job.operation === 3) {
        job.operation = 0
        if (++job.view === layout.gridSize ** 2) {
          job.phase = layout.maxSampleMip > 0 ? 'mips' : 'copy'
          job.mip = layout.maxSampleMip > 0 ? 1 : 0
        }
      }
    } else if (job.phase === 'mips') {
      const size = layout.pageSize / 2 ** job.mip
      if (job.operation === 0) {
        this.mipMaterial.uniforms.sourceMip.value = job.mip - 1
        this.scratch.mip.viewport.set(0, 0, size, size)
        r.setRenderTarget(this.scratch.mip)
        this.checkFramebuffer(this.scratch.mip)
        r.render(this.mipScene, this.mipCamera)
      } else {
        const attachment = job.operation - 1
        this.copy(this.scratch.mip.textures[attachment], this.scratch.staging.textures[attachment], new Box2(new Vector2(), new Vector2(size, size)), new Vector2(), 0, job.mip)
      }
      if (++job.operation === 3) {
        job.operation = 0
        if (++job.mip > layout.maxSampleMip) { job.phase = 'copy'; job.mip = 0 }
      }
    } else if (job.phase === 'copy') {
      const size = layout.pageSize / 2 ** job.mip
      this.copy(this.scratch.staging.textures[job.operation], job.operation === 0 ? job.atlas.normalDepth : job.atlas.surfaceCoverage,
        new Box2(new Vector2(), new Vector2(size, size)), new Vector3(0, 0, job.layer), job.mip, job.mip)
      if (++job.operation === 2) {
        job.operation = 0
        if (++job.mip > layout.maxSampleMip) job.phase = 'complete'
      }
    }
  }

  finish(): { boundRadius: number; halfExtent: number } {
    const job = this.job
    if (!job || job.phase !== 'complete') throw new Error('Страница ещё не готова')
    const metadata = { boundRadius: job.boundRadius, halfExtent: job.halfExtent }
    this.cancel()
    return metadata
  }

  cancel(): void {
    this.job?.geometry.dispose()
    this.job = null
  }

  invalidateGpu(): void {
    this.copier.invalidateGpu()
    this.scratch.invalidateGpu()
    forgetImpostorContext(this.captureMesh.geometry, this.mipGeometry, this.captureMaterial, this.mipMaterial)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.cancel()
    this.scratch.dispose()
    this.copier.dispose()
    this.captureMaterial.dispose()
    this.mipMaterial.dispose()
    this.mipGeometry.dispose()
  }
}
