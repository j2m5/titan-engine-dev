import { Color, IUniform, Matrix3, Matrix4, Uniform, Vector2, Vector3, Vector4 } from 'three'
import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { nebulaNoiseChunk } from './chunks/NebulaNoise'
import { nebulaDensityChunk } from './chunks/NebulaDensity'
import { nebulaColorChunk } from './chunks/NebulaColor'
import { nebulaUpsamplingChunk } from './chunks/NebulaUpsampling'
import { NEBULA_BLUE_NOISE_SIZE } from '../blueNoiseData'
import { sceneDepthFunctions, sceneDepthUniforms } from '@/core/materials/shaders/lib/chunks/SceneDepth'

// Fresh uniform set per shader instance. Module-level Uniform singletons would be
// shared by every NebulaRaymarchMaterial (toJSON spreads references), so two
// nebulas on screen would clobber each other's params. Mirrors StarShader, which
// also builds its uniforms per-instance.
export function createNebulaUniforms(): Record<string, IUniform> {
  return {
    uMaxSteps: new Uniform(96),
    uLightSteps: new Uniform(6),
    uDensityUnitRange: new Uniform(0),
    uBlueNoise: new Uniform(null),
    uTemporalCapture: new Uniform(0),
    uTemporalJitter: new Uniform(0),
    uLowResolutionMap: new Uniform(null),
    uLowResolutionSize: new Uniform(new Vector2(1, 1)),
    uLowResolutionEnabled: new Uniform(0),
    uTime: new Uniform(0),
    uNoiseOffset: new Uniform(new Vector3()),
    uStructureDirection: new Uniform(new Vector3(0, 1, 0)),
    uStructureStretch: new Uniform(1),
    uShape: new Uniform(0),
    uInvAxis: new Uniform(new Vector3(1, 1, 1)),
    uShapeThickness: new Uniform(0.35),
    uShapeRotation: new Uniform(new Matrix3()),
    uEdgeFalloff: new Uniform(0.35),
    uOctaves: new Uniform(5),
    uFrequency: new Uniform(1.6),
    uLacunarity: new Uniform(2.0),
    uGain: new Uniform(0.5),
    uWarpStrength: new Uniform(0.35),
    uBoundaryWarp: new Uniform(0),
    uRidged: new Uniform(0.4),
    uContrast: new Uniform(1.6),
    uEmissiveIntensity: new Uniform(1.6),
    uDensityScale: new Uniform(4.0), // gas amount per unit of local path length
    uGasAbsorption: new Uniform(1.0),
    uOpacityScale: new Uniform(1.0),
    uLodBlend: new Uniform(1.0), // mix premultiplied images BEFORE compositing
    uImpostorMap: new Uniform(null),
    uLocalToImpostor: new Uniform(new Matrix4()),
    // Глубина сцены (чанк SceneDepth): привязывает DepthVolumePass перед рендером;
    // по умолчанию выключена — запекание импостора маршит без обрезки
    uSceneDepth: new Uniform(null),
    uResolution: new Uniform(new Vector2(1, 1)),
    uLogFarFactor: new Uniform(1.0),
    uSceneDepthEnabled: new Uniform(0.0),
    // lobes / cavities (field-level composition) + Worley filaments
    uLobeCount: new Uniform(0),
    uLobeData: new Uniform(Array.from({ length: 8 }, () => new Vector4())),
    uLobeWeight: new Uniform(new Array<number>(8).fill(0)),
    uCavityCount: new Uniform(0),
    uCavityData: new Uniform(Array.from({ length: 8 }, () => new Vector4())),
    uCavityStrength: new Uniform(new Array<number>(8).fill(0)),
    uWorleyStrength: new Uniform(0.4),
    // palette + secondary + dust + cheap white light
    uPalette0: new Uniform(new Color(0x06141c)),
    uPalette1: new Uniform(new Color(0x1f6b66)),
    uPalette2: new Uniform(new Color(0x4cbfa6)),
    uPalette3: new Uniform(new Color(0xbdeede)),
    uPaletteT: new Uniform(new Vector4(0, 0.45, 0.8, 1)),
    uSecondaryColor: new Uniform(new Color(0x5aa0d8)),
    uSecondaryThreshold: new Uniform(0.6),
    uRadialMix: new Uniform(0),
    uInnerColor: new Uniform(new Color(0x8fd8ff)),
    uOuterColor: new Uniform(new Color(0xb85a3a)),
    uDustColor: new Uniform(new Color(0x05090c)),
    uDustStrength: new Uniform(0.6),
    uDustThreshold: new Uniform(0.55),
    uDustFrequency: new Uniform(0.9),
    uDustContrast: new Uniform(1),
    uDustNoiseOffset: new Uniform(new Vector3()),
    uScatterStrength: new Uniform(0.8),
    uPhaseHG: new Uniform(0),
    uAnisotropy: new Uniform(0),
    uShadowStrength: new Uniform(0),
    uAmbient: new Uniform(1.0),
    uStarLocal: new Uniform(new Vector3()),
    uHasStar: new Uniform(0),
    uLightColor: new Uniform(new Color(0xffffff)),
    uLightTint: new Uniform(0),
    uLightFalloff: new Uniform(0)
  }
}

export const nebulaRaymarchVertex = `
  precision highp float;
  varying vec3 vLocalPos;
  void main() {
    vLocalPos = position;       // raster proxy encloses density and impostor
    // modelViewMatrix, NOT modelMatrix followed by viewMatrix. Three builds it on
    // the CPU in double precision, so a proxy standing far from the world origin
    // has its offset cancelled against the camera BEFORE the values drop to
    // float32; multiplying the two in-shader quantises the vertices by the ULP of
    // the world position instead. Harmless today (Placements is empty, so every
    // nebula sits at the origin) and latent the moment one is placed elsewhere.
    // The white dwarf hit exactly this: 49 steps across its radius, see
    // WhiteDwarfShaderTemplate.
    //
    // The world-space varying that used to live here was dead — declared in both
    // stages, assigned, never read: the raymarch works off vLocalPos.
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    // gl_Position.z stays the standard projective value: only near/far CLIPPING of
    // this large proxy box depends on it (a per-vertex z-remap used to corrupt the
    // near-plane clip of triangles straddling a camera INSIDE the box). Depth is
    // neither tested nor written — occlusion is resolved by the marcher against the
    // scene depth (DepthVolumePass), see the fragment shader.
    gl_Position = projectionMatrix * mvPosition;
  }
`

export const nebulaRaymarchFragment = `
  precision highp float;
  precision highp sampler3D;
  // GLSL3 ShaderMaterial: Three maps varying/texture2D but does NOT declare the
  // fragment output, so we declare our own (needed to sample the baked sampler3D).
  layout(location = 0) out vec4 fragColor;
  layout(location = 1) out vec4 temporalPosition;
  #ifdef NEB_BAKED_ONLY
    // Complete RG8 field: exclude procedural noise from the compiled program,
    // including the secondary light march. The material selects this variant
    // only while a completed texture is bound.
    uniform highp sampler3D uDensityTex;
    vec2 nebulaMedium(vec3 p) {
      return textureLod(uDensityTex, p * 0.5 + 0.5, 0.0).rg;
    }
  #else
    #include <noiseFunctions>
    ${nebulaNoiseChunk}
    ${nebulaDensityChunk}
  #endif
  ${nebulaColorChunk}

  varying vec3 vLocalPos;
  uniform float uMaxSteps;
  uniform sampler2D uBlueNoise;
  uniform float uTemporalCapture;
  uniform float uTemporalJitter;
  uniform float uEmissiveIntensity;
  uniform float uOpacityScale;
  uniform float uLodBlend;
  uniform sampler2D uImpostorMap;
  uniform mat4 uLocalToImpostor;

  // Computed on the CPU, before large world coordinates lose float32 precision.
  uniform vec3 uCameraLocal;

  // Scene depth for the ray cut (SceneDepth chunk, bound by DepthVolumePass).
  // Three does not declare modelViewMatrix in the fragment prefix but uploads it
  // by name in any stage; it is camera-relative, so it keeps precision far from
  // the world origin.
  uniform mat4 modelViewMatrix;
  ${sceneDepthUniforms}
  ${sceneDepthFunctions}
  ${nebulaUpsamplingChunk}

  // Ray-box intersection in local space, box [-1,1]^3.
  vec2 intersectBox(vec3 ro, vec3 rd) {
    vec3 inv = 1.0 / rd;
    vec3 t0 = (vec3(-1.0) - ro) * inv;
    vec3 t1 = (vec3( 1.0) - ro) * inv;
    vec3 tmin = min(t0, t1);
    vec3 tmax = max(t0, t1);
    float tn = max(max(tmin.x, tmin.y), tmin.z);
    float tf = min(min(tmax.x, tmax.y), tmax.z);
    return vec2(tn, tf);
  }

  float dither(vec2 uv, bool temporalRay) {
    // Only eligible history rays animate their integration phase. Native draws,
    // depth cuts and incremental bake tiles keep the original fixed pattern.
    ivec2 pixel = ivec2(uv) % ivec2(${NEBULA_BLUE_NOISE_SIZE});
    return fract((texelFetch(uBlueNoise, pixel, 0).r * 255.0 + 0.5) / 256.0 + (temporalRay ? uTemporalJitter : 0.0));
  }

  vec4 marchNebula(vec3 roLocal, vec3 rdLocal, out vec4 representative) {
    representative = vec4(0.0);
    vec2 hit = intersectBox(roLocal, rdLocal);
    float tn = max(hit.x, 0.0);
    float tf = hit.y;
    // Cut the ray at the scene depth: fog behind an opaque surface inside the box
    // is not integrated, and a ray hitting a surface before entering the box
    // collapses and is discarded. rdLocal is proxy-local; mat3(modelViewMatrix)
    // carries the proxy scale into view space, so no normalisation here.
    tf = min(tf, sceneDepthRayT(mat3(modelViewMatrix) * rdLocal));
    if (tf <= tn) return vec4(0.0);

    int steps = int(uMaxSteps);
    float dt = (tf - tn) / uMaxSteps;
    bool temporalRay = uTemporalCapture > 0.5 && uSceneDepthEnabled > 0.5 &&
      texture(uSceneDepth, gl_FragCoord.xy / uResolution).r >= 1.0 - 1e-6;
    float t = tn + dt * dither(gl_FragCoord.xy, temporalRay);

    float transmittance = 1.0;
    float alpha = 0.0;
    vec3 accum = vec3(0.0);
    vec3 positionSum = vec3(0.0);
    float positionWeight = 0.0;
    for (int i = 0; i < 256; i++) {
      if (i >= steps) break;
      vec3 p = roLocal + rdLocal * t;
      vec2 medium = nebulaMedium(p);
      float gas = medium.r * uDensityScale;
      float dust = medium.g * uDustStrength;
      if (gas > 0.0 || dust > 0.0) {
        float sigma = gas * uGasAbsorption + dust;
        float tau = sigma * dt;
        // Exact constant-segment source integral. Its series avoids cancellation
        // in thin media and naturally gives weight=dt at zero extinction.
        float weight;
        float a;
        if (tau < 0.001) {
          weight = dt * (1.0 - 0.5 * tau + tau * tau / 6.0);
          a = sigma * weight;
        } else {
          a = 1.0 - exp(-tau);
          weight = a / sigma;
        }
        float scatter = nebulaStarLight(p, rdLocal);
        vec3 source = dust * nebulaDustColor(scatter);
        if (gas > 0.0) source += gas * nebulaGasColor(medium.r, p, scatter) * uEmissiveIntensity;
        if (temporalRay) {
          // Extinction covers black dust; radiance covers transparent emission.
          float contribution = transmittance * (a + max(source.r, max(source.g, source.b)) * weight);
          positionSum += p * contribution;
          positionWeight += contribution;
        }
        accum += transmittance * source * weight;
        // Accumulate opacity directly to retain very small optical depths.
        alpha += transmittance * a;
        transmittance = 1.0 - alpha;
        if (transmittance < 0.01) break;
      }
      t += dt;
    }
    if (positionWeight > 1e-8) representative = vec4(positionSum / positionWeight, 1.0);
    return vec4(accum, alpha);
  }

  vec4 sampleImpostor(vec3 ro, vec3 rd) {
    // Intersect the current ray with the LAST completed bake's billboard plane.
    // This reproduces its orientation without rotating the texture with camera roll.
    vec3 origin = (uLocalToImpostor * vec4(ro, 1.0)).xyz;
    vec3 direction = mat3(uLocalToImpostor) * rd;
    if (abs(direction.z) < 1e-6) return vec4(0.0);
    float t = -origin.z / direction.z;
    if (t < 0.0 || t > sceneDepthRayT(mat3(modelViewMatrix) * rd)) return vec4(0.0);
    vec2 uv = (origin.xy + direction.xy * t) * 0.5 + 0.5;
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec4(0.0);
    return texture(uImpostorMap, uv);
  }

  void main() {
    vec4 result = vec4(0.0);
    temporalPosition = vec4(0.0);
    #ifdef DEPTH_VOLUME_RECONSTRUCT
      // This small program marks matched pixels in a separate stencil target.
      if (!nebulaLowResolution(result)) discard;
      fragColor = result;
    #else
    #ifndef DEPTH_VOLUME_FALLBACK
    if (nebulaLowResolution(result)) {
      // Keep reconstruction as an early fragment exit. On ANGLE/D3D11 the
      // inverse branch retained the march's GPU cost even for reconstructed
      // pixels. Zero premultiplied RGBA is also a no-op for our blend state.
      fragColor = result;
      return;
    }
    #endif
    vec3 ro = uCameraLocal;
    vec3 rd = normalize(vLocalPos - ro);
    result = vec4(0.0);
    // Dynamic branches skip the entire march for far LOD. Reconstruction
    // already includes this LOD mix and opacity; apply them only once.
    if (uLodBlend < 1.0) result += sampleImpostor(ro, rd) * (1.0 - uLodBlend);
    if (uLodBlend > 0.0) result += marchNebula(ro, rd, temporalPosition) * uLodBlend;
    result *= uOpacityScale;
    // Transparent self-emission (absorption=0) still adds radiance to the scene.
    if (result.a <= 0.0 && all(lessThanEqual(result.rgb, vec3(0.0)))) discard;
    fragColor = result;
    #endif
  }
`

export const NebulaRaymarchShaderTemplate: ShaderProps = {
  name: 'NebulaRaymarchShader',
  uniforms: createNebulaUniforms(),
  vertexShader: nebulaRaymarchVertex,
  fragmentShader: nebulaRaymarchFragment
}
