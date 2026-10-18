import {
  Camera,
  ClampToEdgeWrapping,
  GLSL3,
  LinearFilter,
  Mesh,
  NoColorSpace,
  PlaneGeometry,
  RedFormat,
  Scene,
  ShaderMaterial,
  Texture,
  UnsignedByteType,
  Uniform,
  WebGL3DRenderTarget,
  WebGLRenderer
} from 'three'
import { NebulaParams } from '@/core/renderables/Nebula/NebulaParams'
import { createNebulaUniforms } from '@/core/renderables/Nebula/material/shader/raymarch.template'
import { applyDensityUniforms } from '@/core/renderables/Nebula/material/densityUniforms'
import { nebulaNoiseChunk } from '@/core/renderables/Nebula/material/shader/chunks/NebulaNoise'
import { nebulaDensityChunk } from '@/core/renderables/Nebula/material/shader/chunks/NebulaDensity'
import { noiseFunctions } from '@/core/materials/shaders/lib/chunks/Noise'

const bakeVertex = `
  void main() { gl_Position = vec4(position, 1.0); }
`

// Computes the STATIC density (compute branch — no NEB_BAKED define) for each
// voxel of the current Z slice. Same density chunks the marcher uses, so the
// baked field samples the live field. Output is [0,1] density, quantised to R8.
const bakeFragment = `
  precision highp float;
  out vec4 fragColor;
  ${noiseFunctions}
  ${nebulaNoiseChunk}
  ${nebulaDensityChunk}

  uniform float u_layer;
  uniform float u_resolution;

  void main() {
    vec3 uvw = vec3(gl_FragCoord.xy / u_resolution, (u_layer + 0.5) / u_resolution);
    vec3 p = uvw * 2.0 - 1.0; // [-1,1] local space, matching the marcher's sample
    fragColor = vec4(nebulaDensity(p), 0.0, 0.0, 1.0);
  }
`

/**
 * Bakes the static nebula density field into a 3D texture once, so the marcher
 * samples 1 trilinear fetch per step instead of evaluating fbm + Worley. Renders
 * slice-by-slice into a WebGL3DRenderTarget (R8, ~2 MB at 128³), following the
 * project's AtmosphereLUTGenerator pattern. Self-contained: own RT + offscreen
 * scene, no postprocessing/scene-graph changes.
 */
class NebulaDensityBaker {
  private readonly target: WebGL3DRenderTarget
  private readonly material: ShaderMaterial
  private readonly scene = new Scene()
  private readonly camera = new Camera()
  private readonly mesh: Mesh
  public readonly resolution: number
  private nextLayer = 0
  private active = false

  public constructor(
    private readonly renderer: WebGLRenderer,
    resolution: number
  ) {
    this.resolution = resolution
    this.target = new WebGL3DRenderTarget(resolution, resolution, resolution, {
      type: UnsignedByteType,
      format: RedFormat,
      depthBuffer: false
    })
    this.target.texture.minFilter = LinearFilter
    this.target.texture.magFilter = LinearFilter
    this.target.texture.wrapS = ClampToEdgeWrapping
    this.target.texture.wrapT = ClampToEdgeWrapping
    this.target.texture.wrapR = ClampToEdgeWrapping
    this.target.texture.colorSpace = NoColorSpace

    this.material = new ShaderMaterial({
      glslVersion: GLSL3,
      uniforms: {
        ...createNebulaUniforms(),
        u_layer: new Uniform(0),
        u_resolution: new Uniform(resolution)
      },
      vertexShader: bakeVertex,
      fragmentShader: bakeFragment
    })

    this.mesh = new Mesh(new PlaneGeometry(2, 2), this.material)
    this.scene.add(this.mesh)
  }

  public get texture(): Texture {
    return this.target.texture
  }

  /** Start a new generation without submitting GPU work. */
  public start(params: NebulaParams): void {
    applyDensityUniforms(this.material.uniforms, params)
    this.nextLayer = 0
    this.active = true
  }

  /** Submit at most maxLayers slices. True means this generation is complete. */
  public step(maxLayers = 1): boolean {
    if (!this.active) return true
    const renderer = this.renderer
    const prevTarget = renderer.getRenderTarget()
    const prevLayer = renderer.getActiveCubeFace()
    const prevMip = renderer.getActiveMipmapLevel()
    try {
      const end = Math.min(this.resolution, this.nextLayer + Math.max(0, Math.floor(maxLayers)))
      while (this.nextLayer < end) {
        this.material.uniforms.u_layer.value = this.nextLayer
        renderer.setRenderTarget(this.target, this.nextLayer)
        renderer.render(this.scene, this.camera)
        this.nextLayer++
      }
      if (this.nextLayer === this.resolution) this.active = false
    } catch (error) {
      this.active = false
      throw error
    } finally {
      renderer.setRenderTarget(prevTarget, prevLayer, prevMip)
    }
    return !this.active
  }

  /** Render every Z slice; returns the filled 3D density texture. */
  public bake(params: NebulaParams): Texture {
    this.start(params)
    this.step(this.resolution)
    return this.target.texture
  }

  public dispose(): void {
    this.active = false
    this.target.dispose()
    this.material.dispose()
    this.mesh.geometry.dispose()
  }
}

export { NebulaDensityBaker }
