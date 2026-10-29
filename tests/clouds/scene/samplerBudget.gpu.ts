import {
  Camera,
  DataTexture,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  WebGLRenderer,
  WebGLRenderTarget
} from 'three'
import { Actor } from '@/core/models/Actor'
import { TerrainMaterial } from '@/core/materials/TerrainMaterial'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { heightPathOf } from '@/core/terrain/heightPath'
import { STEEP_DETAIL_PATHS } from '@/core/terrain/steepDetailPaths'
import type { SurfaceCloudMap } from '@/core/clouds/SceneCloudConfig'
import {
  sceneCloudProgramSignature,
  syncSceneCloudNearMaterial
} from '@/core/clouds/receivers/sceneCloudEndpointMaterial'

function checkLiveUniforms(renderer: WebGLRenderer): number[] {
  const owner = new ShaderMaterial({
    vertexShader: 'void main(){gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: 'uniform float level,added;void main(){gl_FragColor=vec4(level+added,0.,0.,1.);}',
    uniforms: { level: { value: 0.25 } }
  })
  const near = new ShaderMaterial(),
    geometry = new PlaneGeometry(2, 2),
    scene = new Scene(),
    target = new WebGLRenderTarget(1, 1)
  scene.add(new Mesh(geometry, near))
  let signature = ''
  const sample = () => {
    const next = sceneCloudProgramSignature(owner)
    syncSceneCloudNearMaterial(owner, near)
    if (signature !== next) {
      near.needsUpdate = true
      signature = next
    }
    renderer.setRenderTarget(target)
    renderer.render(scene, new Camera())
    const bytes = new Uint8Array(4)
    renderer.readRenderTargetPixels(target, 0, 0, 1, 1, bytes)
    return bytes[0]
  }
  try {
    const first = sample(),
      version = near.version,
      dictionary = near.uniforms
    owner.uniforms = { level: { value: 0.75 } }
    const replaced = sample()
    if (near.version !== version || near.uniforms !== dictionary || near.uniforms.level !== owner.uniforms.level)
      throw Error('Replacing a Uniform entry churned the material or lost live identity')
    owner.uniforms.added = { value: 0.1 }
    const added = sample(),
      addedVersion = near.version
    sample()
    if (near.version !== addedVersion) throw Error('Unchanged uniform layout churned material')
    delete owner.uniforms.added
    owner.uniforms.level.value = 0.5
    const removed = sample()
    const values = [first, replaced, added, removed]
    if (values.some((value, i) => Math.abs(value - [64, 191, 217, 128][i]) > 1))
      throw Error('Live Uniform GPU pixels ' + JSON.stringify(values))
    return values
  } finally {
    renderer.setRenderTarget(null)
    owner.dispose()
    near.dispose()
    geometry.dispose()
    target.dispose()
  }
}

/** Program linking fixture: authored resource presence, tiny bytes, no appearance claim. */
export function checkSamplerBudget(renderer: WebGLRenderer): unknown {
  const actor = Actor.find(7)!
  const paths = new Set(['', 'default.png', 'night.jpg', ...Object.values(STEEP_DETAIL_PATHS)])
  for (const resource of actor.resources) {
    const path = resource.getAttribute('path')
    if (path) paths.add(path)
  }
  for (const path of paths) {
    const texture = new DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1)
    texture.name = path
    texture.needsUpdate = true
    resourceStorage.addTexture(texture)
  }
  heightFieldStorage['maps'].set(heightPathOf(actor)!, {
    width: 4,
    height: 2,
    minMeters: -1000,
    maxMeters: 1000,
    data: new Uint16Array(8).fill(32768)
  })
  const owner = new TerrainMaterial(actor)
  owner.name = 'Earth fully enabled TerrainMaterial'
  const source = resourceStorage.getTexture('default.png')!
  const rgb: SurfaceCloudMap = {
    pattern: { kind: 'mask', encoding: 'rgb-cloud-map', map: { resourceId: 26 } },
    mapping: { frame: 'planet-fixed', projection: 'equirectangular', longitudeOffsetRadians: 0 },
    color: { kind: 'constant', srgb: [1, 1, 1] }
  }
  owner.sceneCloudReceiver.setFarMap(rgb, source)
  owner.updateMaterial()
  // The ready atmosphere's exact surface flags. LUT values do not affect program linking.
  owner.defines = { ...owner.defines, USE_SUN_TINT: '1', USE_SKY_AMBIENT: '1' }
  const geometry = new SphereGeometry(1, 8, 4),
    scene = new Scene(),
    camera = new PerspectiveCamera(),
    mesh = new Mesh(geometry, owner as ShaderMaterial)
  scene.add(mesh)
  const gl = renderer.getContext() as WebGL2RenderingContext
  const inspect = (material: ShaderMaterial) => {
    mesh.material = material
    renderer.compile(scene, camera)
    const program = (renderer.properties.get(material) as unknown as { currentProgram: { program: WebGLProgram } })
      .currentProgram.program
    const linked = !!gl.getProgramParameter(program, gl.LINK_STATUS)
    const samplers: { name: string; size: number; type: number }[] = []
    if (linked)
      for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i++) {
        const u = gl.getActiveUniform(program, i)!
        if (new Set<number>([gl.SAMPLER_2D, gl.SAMPLER_CUBE, gl.SAMPLER_3D, gl.SAMPLER_2D_ARRAY]).has(u.type))
          samplers.push({ name: u.name, size: u.size, type: u.type })
      }
    return {
      linked,
      log: gl.getProgramInfoLog(program),
      samplers,
      count: samplers.reduce((n, u) => n + u.size, 0),
      program
    }
  }
  try {
    const rgbFar = inspect(owner)
    const near = owner.sceneCloudReceiver.getEndpointMaterial('near')
    const nearResult = inspect(near),
      version = near.version,
      population = renderer.info.programs!.length
    for (let i = 0; i < 3; i++) {
      inspect(owner)
      const current = inspect(owner.sceneCloudReceiver.getEndpointMaterial('near'))
      if (
        near.version !== version ||
        current.program !== nearResult.program ||
        renderer.info.programs!.length !== population
      )
        throw Error('Endpoint alternation churned program/version')
    }
    owner.sceneCloudReceiver.setFarMap(
      {
        ...rgb,
        pattern: {
          kind: 'mask',
          map: { resourceId: 26 },
          decode: { channel: 'r', sampleSpace: 'linear', inputRange: [0, 1], exponent: 1, invert: false }
        },
        color: { kind: 'map', map: { resourceId: 27 }, strength: 1 }
      },
      source,
      resourceStorage.getTexture('night.jpg')!
    )
    const scalarFar = inspect(owner)
    const evidence = {
      owner: owner.name,
      limit: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
      defines: owner.defines,
      rgbFar,
      scalarFar,
      near: nearResult,
      stableAlternations: 3,
      liveUniformPixels: checkLiveUniforms(renderer)
    }
    console.log('TASK6_SAMPLER_BUDGET ' + JSON.stringify(evidence))
    if (
      !rgbFar.linked ||
      rgbFar.count !== 15 ||
      !scalarFar.linked ||
      scalarFar.count !== 16 ||
      !nearResult.linked ||
      nearResult.count !== 16
    )
      throw Error('TASK6_SAMPLER_BUDGET ' + JSON.stringify(evidence))
    return evidence
  } finally {
    owner.dispose()
    geometry.dispose()
    heightFieldStorage.clear()
    resourceStorage.deleteAllTextures()
  }
}
