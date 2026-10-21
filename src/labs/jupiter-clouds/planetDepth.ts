import { AerialPerspectiveEffect } from '@takram/three-atmosphere'
import type { CloudsEffect } from '@takram/three-clouds'
import { Uniform } from 'three'

// A log-depth -> perspective-depth -> view-Z round trip loses kilometres at orbital distances.
// Decode directly to metres. This adapter is scoped to the pinned Takram WebGL implementation.
const planetDepthGLSL = /* glsl */ `
float planetViewZ(const float depth, const float near, const float far) {
  #if defined(USE_LOGDEPTHBUF) || defined(USE_LOGARITHMIC_DEPTH_BUFFER)
    return -(exp2(depth * log2(far + 1.0)) - 1.0);
  #else
    return near * far / ((far - near) * depth - far);
  #endif
}
`

function replaceRequired(source: string, pattern: RegExp, replacement: string): string {
  if (!pattern.test(source)) throw new Error('Takram shader changed: review the Jupiter depth adapter before upgrading')
  return source.replace(pattern, replacement)
}

export function adaptCloudDepth(clouds: CloudsEffect): void {
  const material = clouds.cloudsPass.currentMaterial
  let shader = replaceRequired(
    material.fragmentShader,
    /depth = reverseLogDepth\(depth, cameraNear, cameraFar\);\s*viewZ = getViewZ\(depth\);/,
    'viewZ = planetViewZ(depth, cameraNear, cameraFar);'
  )
  shader = replaceRequired(shader, /float getRayDistanceToScene\(/, `${planetDepthGLSL}\nfloat getRayDistanceToScene(`)
  material.fragmentShader = shader
  material.needsUpdate = true
}

/** Only for this laboratory's single spherical occluder. Additional meshes need scene depth again.
 * A nearest depth texel represents a different ray than the jittered, lower-resolution cloud ray.
 * At Jupiter's scale that error can exceed the entire cloud thickness and erase large regions.
 */
export function applyAnalyticPlanetDepth(clouds: CloudsEffect): void {
  const material = clouds.cloudsPass.currentMaterial
  material.fragmentShader = replaceRequired(
    material.fragmentShader,
    /float getRayDistanceToScene\([\s\S]*?\n\}/,
    `float getRayDistanceToScene(const vec3 rayDirection, out float viewZ) {
      float distance = max(0.0, raySphereFirstIntersection(
        vCameraPosition + altitudeCorrection, rayDirection, bottomRadius));
      viewZ = -distance * dot(rayDirection, vCameraDirection);
      return distance;
}`
  )
  material.fragmentShader = limitShadowDistance(material.fragmentShader)
  material.needsUpdate = true
}

// Takram keeps its last shadow cascade active beyond shadowFar. Receivers outside the map
// then reveal its square UV boundary. Fade receivers within the final fifth of valid coverage.
function limitShadowDistance(shader: string): string {
  const pattern = /float sampleShadowOpticalDepth\([\s\S]*?\n\}/
  const match = shader.match(pattern)
  if (!match) throw new Error('Takram shadow sampler changed: review the Jupiter adapter')
  let sampler = replaceRequired(
    match[0],
    /int cascadeIndex = getFadedCascadeIndex\(/,
    `float receiverDistance = -(viewMatrix * vec4(worldPosition, 1.0)).z;
     float distanceFade = 1.0 - smoothstep(shadowFar * 0.8, shadowFar, receiverDistance);
     if (distanceFade <= 0.0) return 0.0;
     int cascadeIndex = getFadedCascadeIndex(`
  )
  sampler = replaceRequired(sampler, /return cascadeIndex >= 0/, 'return distanceFade * (cascadeIndex >= 0')
  sampler = replaceRequired(sampler, /: 0\.0;/, ': 0.0);')
  return replaceRequired(shader, pattern, sampler)
}

export class PlanetAerialPerspectiveEffect extends AerialPerspectiveEffect {
  private readonly detailOpacity = new Uniform(0)

  constructor(...args: ConstructorParameters<typeof AerialPerspectiveEffect>) {
    super(...args)
    let shader = replaceRequired(
      this.getFragmentShader(),
      /depth = reverseLogDepth\(depth, cameraNear, cameraFar\);[\s\S]*?vec3 viewPosition = screenToView\([\s\S]*?\);/,
      `float planetZ = planetViewZ(depth, cameraNear, cameraFar);
       vec3 planetRay = (inverseProjectionMatrix * vec4(uv * 2.0 - 1.0, 0.0, 1.0)).xyz;
       vec3 viewPosition = planetRay * (planetZ / planetRay.z);`
    )
    shader = replaceRequired(
      shader,
      /vec4 overlay = texture\(overlayBuffer, uv\);/,
      'vec4 overlay = texture(overlayBuffer, uv) * cloudDetailOpacity;'
    )
    shader = replaceRequired(
      shader,
      /float sunTransmittance = exp\(-opticalDepth\);/,
      'float sunTransmittance = exp(-opticalDepth * cloudDetailOpacity);'
    )
    shader = replaceRequired(
      shader,
      /void mainImage\(/,
      `uniform float cloudDetailOpacity;\n${planetDepthGLSL}\nvoid mainImage(`
    )
    this.uniforms.set('cloudDetailOpacity', this.detailOpacity)
    this.setFragmentShader(limitShadowDistance(shader))
  }

  setCloudOpacity(value: number): void {
    this.detailOpacity.value = value
  }
}
