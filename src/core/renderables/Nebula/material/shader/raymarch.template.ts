import { Color, IUniform, Uniform, Vector3, Vector4 } from 'three'
import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { nebulaNoiseChunk } from './chunks/NebulaNoise'
import { nebulaDensityChunk } from './chunks/NebulaDensity'
import { nebulaColorChunk } from './chunks/NebulaColor'

// Fresh uniform set per shader instance. Module-level Uniform singletons would be
// shared by every NebulaRaymarchMaterial (toJSON spreads references), so two
// nebulas on screen would clobber each other's params. Mirrors StarShader, which
// also builds its uniforms per-instance.
export function createNebulaUniforms(): Record<string, IUniform> {
  return {
    uMaxSteps: new Uniform(96),
    uTime: new Uniform(0),
    uShape: new Uniform(0),
    uInvAxis: new Uniform(new Vector3(1, 1, 1)),
    uEdgeFalloff: new Uniform(0.35),
    uOctaves: new Uniform(5),
    uFrequency: new Uniform(1.6),
    uLacunarity: new Uniform(2.0),
    uGain: new Uniform(0.5),
    uWarpStrength: new Uniform(0.35),
    uRidged: new Uniform(0.4),
    uContrast: new Uniform(1.6),
    uEmissiveIntensity: new Uniform(1.6),
    uDensityScale: new Uniform(4.0), // optical thickness / absorption per step
    uOpacityScale: new Uniform(1.0), // crossfade against the impostor (Task 12)
    // lobes / cavities (field-level composition) + Worley filaments (Task 11)
    uLobeCount: new Uniform(0),
    uLobeData: new Uniform(Array.from({ length: 8 }, () => new Vector4())),
    uLobeWeight: new Uniform(new Array<number>(8).fill(0)),
    uCavityCount: new Uniform(0),
    uCavityData: new Uniform(Array.from({ length: 8 }, () => new Vector4())),
    uCavityStrength: new Uniform(new Array<number>(8).fill(0)),
    uWorleyStrength: new Uniform(0.4),
    // palette + secondary + dust + cheap white light (Task 10)
    uPalette0: new Uniform(new Color(0x06141c)),
    uPalette1: new Uniform(new Color(0x1f6b66)),
    uPalette2: new Uniform(new Color(0x4cbfa6)),
    uPalette3: new Uniform(new Color(0xbdeede)),
    uPaletteT: new Uniform(new Vector4(0, 0.45, 0.8, 1)),
    uSecondaryColor: new Uniform(new Color(0x5aa0d8)),
    uSecondaryThreshold: new Uniform(0.6),
    uDustColor: new Uniform(new Color(0x05090c)),
    uDustStrength: new Uniform(0.6),
    uDustThreshold: new Uniform(0.55),
    uScatterStrength: new Uniform(0.8),
    uAmbient: new Uniform(1.0),
    uStarLocal: new Uniform(new Vector3()),
    uHasStar: new Uniform(0)
  }
}

export const nebulaRaymarchVertex = `
  precision highp float;
  varying vec3 vLocalPos;      // proxy-local position [-1,1]
  varying vec3 vWorldPos;
  void main() {
    vLocalPos = position;       // unit-cube geometry in [-1,1]
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

export const nebulaRaymarchFragment = `
  precision highp float;
  #include <noiseFunctions>
  ${nebulaNoiseChunk}
  ${nebulaDensityChunk}
  ${nebulaColorChunk}

  varying vec3 vLocalPos;
  varying vec3 vWorldPos;
  uniform float uMaxSteps;
  uniform float uEmissiveIntensity;
  uniform float uDensityScale;
  uniform float uOpacityScale;

  // Camera position in proxy-local space via the model matrix inverse.
  uniform mat4 uInvModelMatrix;
  uniform vec3 uCameraWorld;

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

  void main() {
    vec3 roLocal = (uInvModelMatrix * vec4(uCameraWorld, 1.0)).xyz;
    vec3 rdLocal = normalize(vLocalPos - roLocal);
    vec2 hit = intersectBox(roLocal, rdLocal);
    float tn = max(hit.x, 0.0);
    float tf = hit.y;
    if (tf <= tn) discard;

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
        float a = clamp(d * dt * uDensityScale, 0.0, 1.0);
        vec3 c = nebulaColor(d, dust, p, rdLocal) * uEmissiveIntensity;
        accum += transmittance * a * c;
        transmittance *= (1.0 - a);
        if (transmittance < 0.01) break;
      }
      t += dt;
    }
    float alpha = 1.0 - transmittance;
    if (alpha < 0.002) discard;
    gl_FragColor = vec4(accum, alpha) * uOpacityScale; // premultiplied; scaled for crossfade
  }
`

export const NebulaRaymarchShaderTemplate: ShaderProps = {
  name: 'NebulaRaymarchShader',
  uniforms: createNebulaUniforms(),
  vertexShader: nebulaRaymarchVertex,
  fragmentShader: nebulaRaymarchFragment
}
