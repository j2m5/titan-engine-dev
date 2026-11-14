import {
  DataTexture,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  WebGLRenderer
} from 'three'
import { Actor } from '@/core/models/Actor'
import { TerrainMaterial } from '@/core/materials/TerrainMaterial'
import { TerrainBoulderMaterial } from '@/core/materials/TerrainBoulderMaterial'
import { createBoulderGeometry } from '@/core/terrain/boulderGeometry'
import { terrainDataOf } from '@/core/terrain/terrainClassPresets'
import { heightPathOf } from '@/core/terrain/heightPath'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { proceduralDiffuseKey } from '@/core/services/ProceduralSurfaceGenerator'
import { STEEP_DETAIL_PATHS, TALUS_DETAIL_PATHS } from '@/core/terrain/steepDetailPaths'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import type { AtmosphereConfig } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import { readRenderingData } from '@/core/helpers/renderingData'
import { ATMOSPHERE_CATEGORY_ID } from '@/core/constants'
import { resolveSceneClouds } from '@/core/clouds/resolveSceneClouds'

/** Compile actual catalog materials after texture arrival, including procedural worlds and water-adjacent land. */
export function checkRockyTerrainRollout() {
  const bodies = Actor.all()
    .filter((body) => heightPathOf(body) !== undefined && (terrainDataOf(body).boulderDensity ?? 0) > 0)
    .all()
  if (bodies.length !== 36) throw new Error(`Expected 36 rocky bodies, got ${bodies.length}`)
  const paths = new Set([
    'default.png',
    'night.jpg',
    ...Object.values(STEEP_DETAIL_PATHS),
    ...Object.values(TALUS_DETAIL_PATHS)
  ])
  const maps = (heightFieldStorage as unknown as { maps: Map<string, HeightMapData> }).maps
  for (const body of bodies) {
    paths.add(proceduralDiffuseKey(body.getAttribute('id')!))
    for (const resource of body.resources.all()) {
      const type = resource.getAttribute('resourceType'),
        path = resource.getAttribute('path')
      if (path && type !== 'height') paths.add(path)
    }
    maps.set(heightPathOf(body)!, { width: 4, height: 2, minMeters: 0, maxMeters: 1, data: new Uint16Array(8) })
  }
  for (const path of paths) {
    const texture = new DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1)
    texture.name = path
    texture.needsUpdate = true
    resourceStorage.addTexture(texture)
  }
  const registry = new AtmosphereRegistry()
  const lut = resourceStorage.getTexture('default.png')!
  for (const body of bodies) {
    const atmosphere = body.children.where('categoryId', ATMOSPHERE_CATEGORY_ID).first()
    if (atmosphere)
      registry.register({
        actorId: atmosphere.getAttribute('id')!,
        generation: 0,
        ready: true,
        name: atmosphere.getAttribute('name')!,
        object: new Object3D(),
        config: readRenderingData<AtmosphereConfig>(atmosphere)!,
        lut: { transmittance: lut, irradiance: lut, scattering: lut }
      })
  }
  const records: { name: string; log: boolean; endpoint: string; residency: string; samplers: number }[] = []
  let checks = 0
  try {
    for (const logarithmicDepthBuffer of [false, true]) {
      const renderer = new WebGLRenderer({ logarithmicDepthBuffer })
      renderer.setSize(8, 8)
      let context = ''
      renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
        throw new Error(
          `${context}: ${gl.getProgramInfoLog(program)} ${gl.getShaderInfoLog(vertex)} ${gl.getShaderInfoLog(fragment)}`
        )
      }
      const scene = new Scene(),
        camera = new PerspectiveCamera(50, 1, 0.01, 100),
        ground = new PlaneGeometry(2, 2),
        rock = createBoulderGeometry(0)
      ground.setAttribute('height', new Float32BufferAttribute([2000, 2000, 2000, 2000], 1))
      rock.setAttribute('boulderState', new InstancedBufferAttribute(new Float32Array([1, 1]), 2))
      try {
        for (const body of bodies) {
          const material = new TerrainMaterial(body, registry)
          material.updateMaterial()
          material.syncSunTint()
          const clouds = resolveSceneClouds(
            body.getAttribute('id')!,
            undefined,
            new Set(body.resources.all().map((resource) => resource.getAttribute('id')!))
          )
          const cloudTexture = (id: number) =>
            resourceStorage.getTexture(body.resources.where('id', id).first()!.getAttribute('path')!)!
          material.sceneCloudReceiver.setFarMap(
            clouds.far,
            clouds.far ? cloudTexture(clouds.far.pattern.map.resourceId) : null,
            clouds.far?.color.kind === 'map' ? cloudTexture(clouds.far.color.map.resourceId) : null
          )
          const boulder = new TerrainBoulderMaterial(material)
          try {
            if (
              !material.defines.USE_BOULDER_SHADOW ||
              !boulder.defines.USE_BOULDER_SHADOW ||
              material.uniforms.uTalusGate.value !== 1
            )
              throw new Error(`Incomplete material rollout: ${body.getAttribute('name')}`)
            const terrain = new Mesh<PlaneGeometry, ShaderMaterial>(ground, material),
              caster = new InstancedMesh(rock, boulder, 1)
            terrain.position.z = -4
            terrain.frustumCulled = false
            caster.frustumCulled = false
            caster.setMatrixAt(0, new Matrix4().makeTranslation(0, 0, -3))
            // Earth combines night lights, LUTs and clouds. Its shared talus color
            // must keep fitting the shader while that resource arrives or is evicted.
            const diffuse = resourceStorage.getTexture(TALUS_DETAIL_PATHS.diffuse)!
            for (const residency of body.getAttribute('id') === 7 ? ['evicted', 'loaded'] : ['loaded']) {
              if (residency === 'evicted') resourceStorage.deleteTexture(TALUS_DETAIL_PATHS.diffuse)
              else {
                diffuse.needsUpdate = true
                resourceStorage.addTexture(diffuse)
              }
              material.updateMaterial()
              for (const endpoint of clouds.volume ? (['far', 'near'] as const) : (['far'] as const)) {
                terrain.material = material.sceneCloudReceiver.getEndpointMaterial(endpoint)
                context = `${body.getAttribute('name')} ${endpoint} ${residency}, log=${logarithmicDepthBuffer}, defines=${JSON.stringify(terrain.material.defines)}`
                boulder.sync(terrain.material)
                scene.add(terrain, caster)
                renderer.render(scene, camera)
                scene.remove(terrain, caster)
                const gl = renderer.getContext() as WebGL2RenderingContext,
                  samplerTypes = new Set<number>([
                    gl.SAMPLER_2D,
                    gl.SAMPLER_3D,
                    gl.SAMPLER_CUBE,
                    gl.SAMPLER_2D_ARRAY,
                    gl.SAMPLER_2D_SHADOW
                  ])
                let maxSamplers = 0
                for (const program of renderer.info.programs ?? []) {
                  let samplers = 0
                  for (let i = 0; i < gl.getProgramParameter(program.program, gl.ACTIVE_UNIFORMS); i++) {
                    const uniform = gl.getActiveUniform(program.program, i)!
                    if (samplerTypes.has(uniform.type)) samplers += uniform.size
                  }
                  maxSamplers = Math.max(maxSamplers, samplers)
                }
                if (maxSamplers > 16 || gl.getError() !== 0)
                  throw new Error(`Rocky material GPU budget/error: ${body.getAttribute('name')}`)
                records.push({
                  name: body.getAttribute('name')!,
                  log: logarithmicDepthBuffer,
                  endpoint,
                  residency,
                  samplers: maxSamplers
                })
                checks += 2
              }
            }
            caster.dispose()
          } finally {
            boulder.dispose()
            material.dispose()
          }
        }
      } finally {
        ground.dispose()
        rock.dispose()
        renderer.dispose()
        renderer.forceContextLoss()
      }
    }
    return { bodies: bodies.length, checks, records }
  } finally {
    heightFieldStorage.clear()
    resourceStorage.deleteAllTextures()
  }
}
