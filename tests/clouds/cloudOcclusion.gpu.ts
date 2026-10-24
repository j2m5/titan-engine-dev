import {
  Camera,
  DepthTexture,
  GLSL3,
  Mesh,
  MeshBasicMaterial,
  NoBlending,
  PerspectiveCamera,
  PlaneGeometry,
  RawShaderMaterial,
  Scene,
  SphereGeometry,
  UnsignedIntType,
  WebGLRenderer,
  WebGLRenderTarget
} from 'three'
import { createJupiterAtmosphere, createJupiterClouds } from '@/labs/jupiter-clouds/JupiterCloudAdapter'
import { applyAnalyticPlanetDepth } from '@/labs/jupiter-clouds/planetDepth'

/** Rasterize the planet, then consume its nearest-filtered depth along lower-resolution cloud rays.
 * Every ray hitting the ground must leave the cloud layer before reaching the planet.
 */
export function checkCloudOcclusion(): { baselineClipped: number; analyticClipped: number; groundSamples: number } {
  const renderer = new WebGLRenderer({ logarithmicDepthBuffer: true })
  const { atmosphere } = createJupiterAtmosphere()
  const radius = atmosphere.bottomRadius
  const camera = new PerspectiveCamera(55, 1.6, 10, 5e8)
  camera.position.z = radius + 9e7
  camera.updateMatrixWorld()
  const clouds = createJupiterClouds(camera, atmosphere)
  const source = clouds.cloudsPass.currentMaterial.fragmentShader
  const ground = new Mesh(new SphereGeometry(radius, 512, 256), new MeshBasicMaterial())
  const scene = new Scene()
  scene.add(ground)
  const depthTarget = new WebGLRenderTarget(1280, 800)
  depthTarget.depthTexture = new DepthTexture(1280, 800, UnsignedIntType)
  const probeTarget = new WebGLRenderTarget(256, 160, { depthBuffer: false })
  const pixels = new Uint8Array(256 * 160 * 4)
  const quad = new PlaneGeometry(2, 2)
  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    depthTest: false,
    depthWrite: false,
    blending: NoBlending,
    uniforms: {
      depthBuffer: { value: depthTarget.depthTexture },
      inverseProjectionMatrix: { value: camera.projectionMatrixInverse }
    },
    vertexShader: `precision highp float; in vec3 position; out vec2 vUv;
      void main() { vUv=position.xy*0.5+0.5; gl_Position=vec4(position.xy,0.0,1.0); }`
  })
  const probeScene = new Scene()
  probeScene.add(new Mesh(quad, material))
  const extract = (name: string): string => {
    const match = source.match(new RegExp(`float ${name}\\([^]*?\\n\\}`))
    if (!match) throw new Error(`Cloud shader function missing: ${name}`)
    return match[0]
  }
  const intersections = [...source.matchAll(/float raySphereFirstIntersection\([\s\S]*?\n\}/g)]
    .map((m) => m[0])
    .join('\n')
  const run = (reader: string): { clipped: number; samples: number } => {
    material.fragmentShader = `precision highp float;
      #define PERSPECTIVE_CAMERA 1
      #define USE_LOGARITHMIC_DEPTH_BUFFER 1
      #include <packing>
      uniform sampler2D depthBuffer;
      uniform mat4 inverseProjectionMatrix;
      in vec2 vUv;
      out vec4 result;
      const float cameraNear=10.0, cameraFar=500000000.0, bottomRadius=${radius.toFixed(1)};
      const vec3 vCameraPosition=vec3(0.0,0.0,${camera.position.z.toFixed(1)});
      const vec3 vCameraDirection=vec3(0.0,0.0,-1.0), altitudeCorrection=vec3(0.0);
      const vec2 targetUvScale=vec2(1.0), temporalJitter=vec2(0.0011,-0.0018);
      float readDepthValue(sampler2D buffer, vec2 uv) { return texture(buffer,uv).r; }
      ${intersections}
      ${extract('reverseLogDepth')}
      ${extract('getViewZ')}
      ${extract('planetViewZ')}
      ${reader}
      void main() {
        vec3 ray=normalize((inverseProjectionMatrix*vec4((vUv+temporalJitter)*2.0-1.0,0.0,1.0)).xyz);
        float ground=raySphereFirstIntersection(vCameraPosition,ray,bottomRadius);
        float layerExit=raySphereFirstIntersection(vCameraPosition,ray,bottomRadius+10000.0);
        float viewZ;
        float sceneDistance=getRayDistanceToScene(ray,viewZ);
        result=vec4(float(ground>0.0 && sceneDistance<layerExit),float(ground>0.0),0.0,1.0);
      }`
    material.needsUpdate = true
    renderer.setRenderTarget(probeTarget)
    renderer.render(probeScene, new Camera())
    renderer.readRenderTargetPixels(probeTarget, 0, 0, 256, 160, pixels)
    let clipped = 0,
      samples = 0
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i]) clipped++
      if (pixels[i + 1]) samples++
    }
    return { clipped, samples }
  }
  try {
    renderer.setRenderTarget(depthTarget)
    renderer.render(scene, camera)
    const baseline = run(extract('getRayDistanceToScene'))
    applyAnalyticPlanetDepth(clouds)
    const reader = clouds.cloudsPass.currentMaterial.fragmentShader.match(
      /float getRayDistanceToScene\([\s\S]*?\n\}/
    )?.[0]
    if (!reader) throw new Error('Analytic planet depth function missing')
    const analytic = run(reader)
    if (baseline.clipped < 100 || analytic.samples < 10000 || analytic.clipped !== 0) {
      throw new Error(`Cloud occlusion regression: ${JSON.stringify({ baseline, analytic })}`)
    }
    if (renderer.getContext().getError()) throw new Error('Cloud occlusion check produced a WebGL error')
    return { baselineClipped: baseline.clipped, analyticClipped: analytic.clipped, groundSamples: analytic.samples }
  } finally {
    material.dispose()
    quad.dispose()
    ground.geometry.dispose()
    ground.material.dispose()
    depthTarget.dispose()
    probeTarget.dispose()
    clouds.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
