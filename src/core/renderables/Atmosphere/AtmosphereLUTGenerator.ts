/**
 * AtmosphereLUTGenerator.ts
 *
 * GPU precomputation pipeline for Bruneton's atmospheric scattering LUTs.
 *
 * CRITICAL IMPLEMENTATION NOTE:
 * The parametric atmosphere GLSL (from atmosphere.js) declares these texture
 * uniforms globally: transmittance_texture, scattering_texture,
 * single_mie_scattering_texture, irradiance_texture.
 * For RawShaderMaterial, Three.js only uploads uniform values that exist in
 * the material's `uniforms` object. Therefore EVERY precomputation material
 * must include ALL of these in its uniforms, even if the specific computation
 * step doesn't use all of them. Otherwise they resolve to garbage textures.
 */

import {
  AddEquation,
  Camera,
  ClampToEdgeWrapping,
  CustomBlending,
  FloatType,
  GLSL3,
  LinearFilter,
  Mesh,
  NoBlending,
  NoColorSpace,
  OneFactor,
  PlaneGeometry,
  RawShaderMaterial,
  RGBAFormat,
  Scene,
  Texture,
  Uniform,
  Vector3,
  WebGL3DRenderTarget,
  WebGLRenderTarget,
  type WebGLRenderer
} from 'three'
import { AtmosphereConfig } from './AtmosphereConfig'
import { createParametricAtmosphereShader } from './atmosphereParametric'

// ════════════════════════════════════════════════════════════════════
// Constants
// ════════════════════════════════════════════════════════════════════

const TRANSMITTANCE_W = 256
const TRANSMITTANCE_H = 64
const SCATTERING_W = 256
const SCATTERING_H = 128
const SCATTERING_D = 32
const IRRADIANCE_W = 64
const IRRADIANCE_H = 16

// Default: 1 = single scattering only (visually sufficient from space).
// Higher values (2-4) add multi-scattering but currently produce artifacts
// due to suspected Three.js 3D render target state management issues.
// The visual contribution of orders 2-4 is subtle: slightly brighter
// shadow terminator and ambient illumination on the night side.
const DEFAULT_SCATTERING_ORDERS = 1

// ════════════════════════════════════════════════════════════════════
// Return type
// ════════════════════════════════════════════════════════════════════

export interface AtmosphereLUTs {
  transmittance: Texture
  scattering: Texture
  irradiance: Texture
}

// ════════════════════════════════════════════════════════════════════
// Shared GLSL
// ════════════════════════════════════════════════════════════════════

const parametricAtmosphere = createParametricAtmosphereShader()

const FULLSCREEN_VERT = /* glsl */ `
precision highp float;
in vec2 position;
void main() {
  gl_Position = vec4(position, 1.0, 1.0);
}
`

function fragPreamble(additionalUniforms: string = ''): string {
  return /* glsl */ `
${parametricAtmosphere}
${additionalUniforms}
uniform int u_layer;
uniform int u_scattering_order;
layout(location = 0) out vec4 fragColor;
`
}

// ── Precomputation fragment shaders ──

const TRANSMITTANCE_FRAG =
  fragPreamble() +
  /* glsl */ `
void main() {
  AtmosphereParameters atmo = buildAtmosphere();
  fragColor = vec4(ComputeTransmittanceToTopAtmosphereBoundaryTexture(
    atmo, gl_FragCoord.xy), 1.0);
}
`

const DIRECT_IRRADIANCE_FRAG =
  fragPreamble() +
  /* glsl */ `
void main() {
  AtmosphereParameters atmo = buildAtmosphere();
  fragColor = vec4(ComputeDirectIrradianceTexture(
    atmo, transmittance_texture, gl_FragCoord.xy), 1.0);
}
`

const SINGLE_SCATTERING_FRAG =
  fragPreamble() +
  /* glsl */ `
void main() {
  AtmosphereParameters atmo = buildAtmosphere();
  vec3 frag_coord = vec3(gl_FragCoord.xy, float(u_layer) + 0.5);
  IrradianceSpectrum rayleigh;
  IrradianceSpectrum mie;
  ComputeSingleScatteringTexture(
    atmo, transmittance_texture, frag_coord, rayleigh, mie);

  #if defined(OUTPUT_RAYLEIGH)
    fragColor = vec4(rayleigh, 1.0);
  #elif defined(OUTPUT_MIE)
    fragColor = vec4(mie, 1.0);
  #else
    // COMBINED_SCATTERING_TEXTURES: rayleigh.rgb + mie.r in alpha
    fragColor = vec4(rayleigh.rgb, mie.r);
  #endif
}
`

const SCATTERING_DENSITY_FRAG =
  fragPreamble(/* glsl */ `
uniform sampler3D single_rayleigh_scattering_texture;
uniform sampler3D multiple_scattering_texture;
`) +
  /* glsl */ `
void main() {
  AtmosphereParameters atmo = buildAtmosphere();
  vec3 frag_coord = vec3(gl_FragCoord.xy, float(u_layer) + 0.5);
  fragColor = vec4(ComputeScatteringDensityTexture(
    atmo,
    transmittance_texture,
    single_rayleigh_scattering_texture,
    single_mie_scattering_texture,
    multiple_scattering_texture,
    irradiance_texture,
    frag_coord,
    u_scattering_order), 1.0);
}
`

const INDIRECT_IRRADIANCE_FRAG =
  fragPreamble(/* glsl */ `
uniform sampler3D single_rayleigh_scattering_texture;
uniform sampler3D multiple_scattering_texture;
`) +
  /* glsl */ `
void main() {
  AtmosphereParameters atmo = buildAtmosphere();
  fragColor = vec4(ComputeIndirectIrradianceTexture(
    atmo,
    single_rayleigh_scattering_texture,
    single_mie_scattering_texture,
    multiple_scattering_texture,
    gl_FragCoord.xy,
    u_scattering_order), 1.0);
}
`

const MULTIPLE_SCATTERING_FRAG =
  fragPreamble(/* glsl */ `
uniform sampler3D scattering_density_texture;
`) +
  /* glsl */ `
void main() {
  AtmosphereParameters atmo = buildAtmosphere();
  vec3 frag_coord = vec3(gl_FragCoord.xy, float(u_layer) + 0.5);
  float nu;
  fragColor = vec4(ComputeMultipleScatteringTexture(
    atmo,
    transmittance_texture,
    scattering_density_texture,
    frag_coord,
    nu), 1.0);
}
`

// ════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════

/**
 * Base texture uniforms that atmosphere.js declares globally.
 * MUST be included in every precomputation material's uniforms object,
 * otherwise Three.js RawShaderMaterial won't upload values for them.
 */
function baseTextureUniforms(): Record<string, Uniform> {
  return {
    transmittance_texture: new Uniform(null),
    scattering_texture: new Uniform(null),
    single_mie_scattering_texture: new Uniform(null),
    irradiance_texture: new Uniform(null)
  }
}

function createMaterial(
  fragmentShader: string,
  extraUniforms: Record<string, Uniform> = {},
  defines: Record<string, string> = {}
): RawShaderMaterial {
  return new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: FULLSCREEN_VERT,
    fragmentShader,
    uniforms: {
      ...baseTextureUniforms(),
      u_layer: new Uniform(0),
      u_scattering_order: new Uniform(0),
      ...extraUniforms
    },
    defines,
    depthTest: false,
    depthWrite: false,
    blending: NoBlending
  })
}

function setAdditiveBlending(mat: RawShaderMaterial, additive: boolean): void {
  if (additive) {
    mat.transparent = true
    mat.blending = CustomBlending
    mat.blendEquation = AddEquation
    mat.blendEquationAlpha = AddEquation
    mat.blendSrc = OneFactor
    mat.blendDst = OneFactor
    mat.blendSrcAlpha = OneFactor
    mat.blendDstAlpha = OneFactor
  } else {
    mat.transparent = false
    mat.blending = NoBlending
  }
}

function createRT(w: number, h: number): WebGLRenderTarget {
  const rt = new WebGLRenderTarget(w, h, {
    depthBuffer: false,
    type: FloatType,
    format: RGBAFormat
  })
  rt.texture.minFilter = LinearFilter
  rt.texture.magFilter = LinearFilter
  rt.texture.wrapS = ClampToEdgeWrapping
  rt.texture.wrapT = ClampToEdgeWrapping
  rt.texture.colorSpace = NoColorSpace
  return rt
}

function create3DRT(w: number, h: number, d: number): WebGL3DRenderTarget {
  const rt = new WebGL3DRenderTarget(w, h, d, {
    depthBuffer: false,
    type: FloatType,
    format: RGBAFormat
  })
  rt.texture.minFilter = LinearFilter
  rt.texture.magFilter = LinearFilter
  rt.texture.wrapS = ClampToEdgeWrapping
  rt.texture.wrapT = ClampToEdgeWrapping
  // @ts-ignore
  rt.texture.wrapR = ClampToEdgeWrapping
  rt.texture.colorSpace = NoColorSpace
  return rt
}

// ════════════════════════════════════════════════════════════════════
// Generator
// ════════════════════════════════════════════════════════════════════

export class AtmosphereLUTGenerator {
  private renderer: WebGLRenderer
  private scene = new Scene()
  private camera = new Camera()
  private mesh: Mesh

  // Output render targets (persist across generate() calls for reuse)
  private transmittanceRT: WebGLRenderTarget
  private scatteringRT: WebGL3DRenderTarget
  private irradianceRT: WebGLRenderTarget

  // Materials (one per precomputation step × output variant)
  private transmittanceMat: RawShaderMaterial
  private directIrradianceMat: RawShaderMaterial
  private singleScatteringRayleighMat: RawShaderMaterial
  private singleScatteringMieMat: RawShaderMaterial
  private singleScatteringCombinedMat: RawShaderMaterial
  private scatteringDensityMat: RawShaderMaterial
  private indirectIrradianceMat: RawShaderMaterial
  private multipleScatteringMat: RawShaderMaterial

  private scatteringOrders: number

  constructor(renderer: WebGLRenderer, scatteringOrders = DEFAULT_SCATTERING_ORDERS) {
    this.renderer = renderer
    this.scatteringOrders = scatteringOrders
    this.mesh = new Mesh(new PlaneGeometry(2, 2))
    this.scene.add(this.mesh)

    // Output render targets
    this.transmittanceRT = createRT(TRANSMITTANCE_W, TRANSMITTANCE_H)
    this.scatteringRT = create3DRT(SCATTERING_W, SCATTERING_H, SCATTERING_D)
    this.irradianceRT = createRT(IRRADIANCE_W, IRRADIANCE_H)

    // Create materials — all include baseTextureUniforms() for atmosphere.js uniforms
    this.transmittanceMat = createMaterial(TRANSMITTANCE_FRAG)

    this.directIrradianceMat = createMaterial(DIRECT_IRRADIANCE_FRAG)

    this.singleScatteringRayleighMat = createMaterial(SINGLE_SCATTERING_FRAG, {}, { OUTPUT_RAYLEIGH: '1' })

    this.singleScatteringMieMat = createMaterial(SINGLE_SCATTERING_FRAG, {}, { OUTPUT_MIE: '1' })

    this.singleScatteringCombinedMat = createMaterial(SINGLE_SCATTERING_FRAG)

    this.scatteringDensityMat = createMaterial(SCATTERING_DENSITY_FRAG, {
      single_rayleigh_scattering_texture: new Uniform(null),
      multiple_scattering_texture: new Uniform(null)
    })

    this.indirectIrradianceMat = createMaterial(INDIRECT_IRRADIANCE_FRAG, {
      single_rayleigh_scattering_texture: new Uniform(null),
      multiple_scattering_texture: new Uniform(null)
    })

    this.multipleScatteringMat = createMaterial(MULTIPLE_SCATTERING_FRAG, {
      scattering_density_texture: new Uniform(null)
    })
  }

  // ── Public API ──────────────────────────────────────────────────

  generate(config: AtmosphereConfig): AtmosphereLUTs {
    const renderer = this.renderer
    const savedAutoClear = renderer.autoClear
    const savedRenderTarget = renderer.getRenderTarget()
    renderer.autoClear = false

    // Set atmosphere parameters on all materials
    this.setAtmosphereOnAllMaterials(config)

    // Temp render targets
    const deltaIrradianceRT = createRT(IRRADIANCE_W, IRRADIANCE_H)
    const deltaRayleighRT = create3DRT(SCATTERING_W, SCATTERING_H, SCATTERING_D)
    const deltaMieRT = create3DRT(SCATTERING_W, SCATTERING_H, SCATTERING_D)
    const deltaScatteringDensityRT = create3DRT(SCATTERING_W, SCATTERING_H, SCATTERING_D)
    // Reuse deltaRayleigh memory for deltaMultipleScattering (not needed simultaneously)
    const deltaMultipleScatteringRT = deltaRayleighRT

    try {
      // ═══════════════════════════════════════════════════════════
      // Step 1: Transmittance
      // ═══════════════════════════════════════════════════════════
      this.renderPass2D(this.transmittanceMat, this.transmittanceRT)

      renderer.setRenderTarget(null)

      // ═══════════════════════════════════════════════════════════
      // Step 2: Direct irradiance
      // 2a: compute → deltaIrradiance
      // 2b: clear irradiance accumulator (we only want indirect irradiance in it)
      // ═══════════════════════════════════════════════════════════
      this.directIrradianceMat.uniforms.transmittance_texture.value = this.transmittanceRT.texture
      setAdditiveBlending(this.directIrradianceMat, false)
      this.renderPass2D(this.directIrradianceMat, deltaIrradianceRT)

      // Clear irradiance accumulator to zero
      renderer.setRenderTarget(this.irradianceRT)
      renderer.clearColor()

      renderer.setRenderTarget(null)

      // ═══════════════════════════════════════════════════════════
      // Step 3: Single scattering (4 render passes)
      // 3a: Rayleigh → deltaRayleigh
      // 3b: Mie → deltaMie
      // 3c: Combined → scattering accumulator
      // ═══════════════════════════════════════════════════════════
      this.singleScatteringRayleighMat.uniforms.transmittance_texture.value = this.transmittanceRT.texture
      setAdditiveBlending(this.singleScatteringRayleighMat, false)
      this.renderPass3D(this.singleScatteringRayleighMat, deltaRayleighRT)

      this.singleScatteringMieMat.uniforms.transmittance_texture.value = this.transmittanceRT.texture
      setAdditiveBlending(this.singleScatteringMieMat, false)
      this.renderPass3D(this.singleScatteringMieMat, deltaMieRT)

      this.singleScatteringCombinedMat.uniforms.transmittance_texture.value = this.transmittanceRT.texture
      setAdditiveBlending(this.singleScatteringCombinedMat, false)
      this.renderPass3D(this.singleScatteringCombinedMat, this.scatteringRT)

      // Flush between phases (matches reference implementation)
      renderer.setRenderTarget(null)

      // ═══════════════════════════════════════════════════════════
      // Step 4: Higher-order scattering (orders 2 through N)
      // Only executes if scatteringOrders > 1
      // ═══════════════════════════════════════════════════════════
      for (let order = 2; order <= this.scatteringOrders; order++) {
        // ─── 4a: Scattering density ─────────────────────────────
        {
          const u = this.scatteringDensityMat.uniforms
          u.transmittance_texture.value = this.transmittanceRT.texture
          u.single_rayleigh_scattering_texture.value =
            order === 2 ? deltaRayleighRT.texture : deltaMultipleScatteringRT.texture
          u.single_mie_scattering_texture.value = deltaMieRT.texture
          u.multiple_scattering_texture.value = deltaMultipleScatteringRT.texture
          u.irradiance_texture.value = deltaIrradianceRT.texture
          u.u_scattering_order.value = order
          this.renderPass3D(this.scatteringDensityMat, deltaScatteringDensityRT)
        }

        // ─── 4b: Indirect irradiance ────────────────────────────
        {
          const u = this.indirectIrradianceMat.uniforms
          u.single_rayleigh_scattering_texture.value =
            order === 2 ? deltaRayleighRT.texture : deltaMultipleScatteringRT.texture
          u.single_mie_scattering_texture.value = deltaMieRT.texture
          u.multiple_scattering_texture.value = deltaMultipleScatteringRT.texture
          u.u_scattering_order.value = order - 1

          // Overwrite deltaIrradiance
          setAdditiveBlending(this.indirectIrradianceMat, false)
          this.renderPass2D(this.indirectIrradianceMat, deltaIrradianceRT)

          // Accumulate into irradiance (additive)
          setAdditiveBlending(this.indirectIrradianceMat, true)
          this.renderPass2D(this.indirectIrradianceMat, this.irradianceRT)
        }

        // ─── 4c: Multiple scattering ────────────────────────────
        {
          const u = this.multipleScatteringMat.uniforms
          u.transmittance_texture.value = this.transmittanceRT.texture
          u.scattering_density_texture.value = deltaScatteringDensityRT.texture

          // Overwrite deltaMultipleScattering
          setAdditiveBlending(this.multipleScatteringMat, false)
          this.renderPass3D(this.multipleScatteringMat, deltaMultipleScatteringRT)

          // Accumulate into scattering (additive)
          setAdditiveBlending(this.multipleScatteringMat, true)
          this.renderPass3D(this.multipleScatteringMat, this.scatteringRT)
        }

        // Flush between scattering orders
        renderer.setRenderTarget(null)
      }

      renderer.setRenderTarget(null)

      return {
        transmittance: this.transmittanceRT.texture,
        scattering: this.scatteringRT.texture,
        irradiance: this.irradianceRT.texture
      }
    } finally {
      // Cleanup temp render targets
      deltaIrradianceRT.dispose()
      // deltaRayleighRT and deltaMultipleScatteringRT are the same object
      deltaRayleighRT.dispose()
      deltaMieRT.dispose()
      deltaScatteringDensityRT.dispose()

      renderer.autoClear = savedAutoClear
      renderer.setRenderTarget(savedRenderTarget)
    }
  }

  dispose(): void {
    this.transmittanceRT.dispose()
    this.scatteringRT.dispose()
    this.irradianceRT.dispose()

    this.transmittanceMat.dispose()
    this.directIrradianceMat.dispose()
    this.singleScatteringRayleighMat.dispose()
    this.singleScatteringMieMat.dispose()
    this.singleScatteringCombinedMat.dispose()
    this.scatteringDensityMat.dispose()
    this.indirectIrradianceMat.dispose()
    this.multipleScatteringMat.dispose()

    this.mesh.geometry.dispose()
  }

  // ── Render helpers ────────────────────────────────────────────

  private renderPass2D(material: RawShaderMaterial, target: WebGLRenderTarget): void {
    this.mesh.material = material
    this.renderer.setRenderTarget(target)
    this.renderer.render(this.scene, this.camera)
  }

  private renderPass3D(material: RawShaderMaterial, target: WebGL3DRenderTarget): void {
    this.mesh.material = material
    for (let layer = 0; layer < target.depth; layer++) {
      material.uniforms.u_layer.value = layer
      this.renderer.setRenderTarget(target, layer)
      this.renderer.render(this.scene, this.camera)
    }
  }

  // ── Atmosphere uniforms ───────────────────────────────────────

  private setAtmosphereOnAllMaterials(config: AtmosphereConfig): void {
    const allMaterials = [
      this.transmittanceMat,
      this.directIrradianceMat,
      this.singleScatteringRayleighMat,
      this.singleScatteringMieMat,
      this.singleScatteringCombinedMat,
      this.scatteringDensityMat,
      this.indirectIrradianceMat,
      this.multipleScatteringMat
    ]
    for (const mat of allMaterials) {
      this.setAtmosphereUniforms(mat, config)
    }
  }

  private setAtmosphereUniforms(material: RawShaderMaterial, config: AtmosphereConfig): void {
    const u = material.uniforms

    const ensure = (name: string, defaultValue: any = null) => {
      if (!u[name]) u[name] = new Uniform(defaultValue)
    }

    // Ensure all atmosphere parameter uniforms exist
    ensure('u_solar_irradiance')
    ensure('u_sun_angular_radius', 0)
    ensure('u_bottom_radius', 0)
    ensure('u_top_radius', 0)
    ensure('u_rayleigh_layer0')
    ensure('u_rayleigh_layer1')
    ensure('u_rayleigh_scattering')
    ensure('u_mie_layer0')
    ensure('u_mie_layer1')
    ensure('u_mie_scattering')
    ensure('u_mie_extinction')
    ensure('u_mie_phase_function_g', 0)
    ensure('u_absorption_layer0')
    ensure('u_absorption_layer1')
    ensure('u_absorption_extinction')
    ensure('u_ground_albedo')
    ensure('u_mu_s_min', 0)

    const toArr = (l: { width: number; expTerm: number; expScale: number; linearTerm: number; constantTerm: number }) =>
      new Float32Array([l.width, l.expTerm, l.expScale, l.linearTerm, l.constantTerm])

    u.u_solar_irradiance.value = new Vector3(...config.solarIrradiance)
    u.u_sun_angular_radius.value = config.sunAngularRadius
    u.u_bottom_radius.value = config.bottomRadius
    u.u_top_radius.value = config.topRadius
    u.u_rayleigh_layer0.value = toArr(config.rayleighDensity[0])
    u.u_rayleigh_layer1.value = toArr(config.rayleighDensity[1])
    u.u_rayleigh_scattering.value = new Vector3(...config.rayleighScattering)
    u.u_mie_layer0.value = toArr(config.mieDensity[0])
    u.u_mie_layer1.value = toArr(config.mieDensity[1])
    u.u_mie_scattering.value = new Vector3(...config.mieScattering)
    u.u_mie_extinction.value = new Vector3(...config.mieExtinction)
    u.u_mie_phase_function_g.value = config.miePhaseFunctionG
    u.u_absorption_layer0.value = toArr(config.absorptionDensity[0])
    u.u_absorption_layer1.value = toArr(config.absorptionDensity[1])
    u.u_absorption_extinction.value = new Vector3(...config.absorptionExtinction)
    u.u_ground_albedo.value = new Vector3(...config.groundAlbedo)
    u.u_mu_s_min.value = config.muSMin
  }
}
