import { Color, IUniform, Matrix3, Matrix4, Uniform, Vector2, Vector3, Vector4 } from 'three'
import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { nebulaNoiseChunk } from './chunks/NebulaNoise'
import { nebulaDensityChunk } from './chunks/NebulaDensity'
import { nebulaColorChunk } from './chunks/NebulaColor'
import { sceneDepthFunctions, sceneDepthUniforms } from '@/core/materials/shaders/lib/chunks/SceneDepth'

// Fresh uniform set per shader instance. Module-level Uniform singletons would be
// shared by every NebulaRaymarchMaterial (toJSON spreads references), so two
// nebulas on screen would clobber each other's params. Mirrors StarShader, which
// also builds its uniforms per-instance.
export function createNebulaUniforms(): Record<string, IUniform> {
  return {
    uMaxSteps: new Uniform(96),
    uTime: new Uniform(0),
    uNoiseOffset: new Uniform(new Vector3()),
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
    uDensityScale: new Uniform(4.0), // absorption per unit of local path length
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
    uScatterStrength: new Uniform(0.8),
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
  out vec4 fragColor;
  #include <noiseFunctions>
  ${nebulaNoiseChunk}
  ${nebulaDensityChunk}
  ${nebulaColorChunk}

  varying vec3 vLocalPos;
  uniform float uMaxSteps;
  uniform float uEmissiveIntensity;
  uniform float uDensityScale;
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

  float dither(vec2 uv) {
    return fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453);
  }

  vec4 marchNebula(vec3 roLocal, vec3 rdLocal) {
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
    float t = tn + dt * dither(gl_FragCoord.xy);

    float transmittance = 1.0;
    vec3 accum = vec3(0.0);
    for (int i = 0; i < 256; i++) {
      if (i >= steps) break;
      vec3 p = roLocal + rdLocal * t;
      float d = nebulaDensity(p);
      if (d > 0.001) {
        float dust = nebulaDust(p);
        // Beer-Lambert: splitting a homogeneous segment into more steps leaves
        // its total transmittance unchanged.
        float a = 1.0 - exp(-d * dt * uDensityScale);
        vec3 c = nebulaColor(d, dust, p, rdLocal) * uEmissiveIntensity;
        accum += transmittance * a * c;
        transmittance *= (1.0 - a);
        if (transmittance < 0.01) break;
      }
      t += dt;
    }
    float alpha = 1.0 - transmittance;
    if (alpha < 0.002) return vec4(0.0);
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
    vec3 ro = uCameraLocal;
    vec3 rd = normalize(vLocalPos - ro);
    vec4 result = vec4(0.0);
    // Dynamic branches skip the entire march for the far LOD and the texture
    // lookup for the near LOD. A single source-over operation follows the mix.
    if (uLodBlend < 1.0) result += sampleImpostor(ro, rd) * (1.0 - uLodBlend);
    if (uLodBlend > 0.0) result += marchNebula(ro, rd) * uLodBlend;
    if (result.a <= 0.0) discard;
    fragColor = result * uOpacityScale;
  }
`

export const NebulaRaymarchShaderTemplate: ShaderProps = {
  name: 'NebulaRaymarchShader',
  uniforms: createNebulaUniforms(),
  vertexShader: nebulaRaymarchVertex,
  fragmentShader: nebulaRaymarchFragment
}
