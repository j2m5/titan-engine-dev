import { ShaderChunk, ShaderMaterial, Uniform, Vector3 } from 'three'
import {
  planetSurfaceVertexLight,
  planetSurfaceVertexOutputs,
  planetSurfaceVertexPars
} from './shaders/lib/chunks/PlanetSurfaceCommon'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import type { SceneCloudReceiver } from '@/core/clouds/receivers/SceneCloudReceiver'
import { sceneCloudProgramSignature, syncSceneCloudNearMaterial } from '@/core/clouds/receivers/sceneCloudEndpointMaterial'

export const BOULDER_TEXTURE_METERS = 8
const excluded = new Set([
  'USE_SLOPE',
  'USE_CAVITY',
  'USE_TERRAIN_MACRO_DETAIL',
  'USE_TERRAIN_FROST',
  'USE_WATER_EDGE',
  'USE_TERRAIN_GLINT',
  'USE_TERRAIN_TALUS',
  'USE_RING'
])

/** Uses the live terrain texture/light uniforms; owns only the local texture domain and shape inputs. */
export class TerrainBoulderMaterial extends ShaderMaterial {
  public readonly sceneCloudReceiver?: SceneCloudReceiver
  public readonly origin = new Vector3()
  public readonly detailOrigin = new Vector3()
  public readonly detailOrigin2 = new Vector3()
  private defineKey = ''
  private readonly localUniforms = {
    uBoulderOrigin: new Uniform(this.origin),
    uBoulderDetailOrigin: new Uniform(this.detailOrigin),
    uBoulderDetailOrigin2: new Uniform(this.detailOrigin2),
    uDetailScale: new Uniform(1 / toThreeJSUnits(BOULDER_TEXTURE_METERS / 1000)),
    uDetailNormalScale: new Uniform(0.65)
  }

  public constructor(parent: ShaderMaterial, sizeScale = 1) {
    super({
      vertexShader: `
        ${planetSurfaceVertexPars}
        uniform vec3 uBoulderOrigin, uBoulderDetailOrigin, uBoulderDetailOrigin2;
        attribute vec2 boulderState;
        varying vec3 vBoulderNormal;
        varying vec3 vBoulderState;
        #ifdef USE_TERRAIN_DETAIL
          varying vec3 vDetailPos, vDetailPos2;
          varying float vHeightMeters;
        #endif
        void main() {
          vec3 morphedPosition = (instanceMatrix * vec4(position, 1.0)).xyz;
          ${planetSurfaceVertexLight}
          vec3 vertexDir = normalize(morphedPosition + uBoulderOrigin);
          ${planetSurfaceVertexOutputs}
          mat3 rotationScale = mat3(instanceMatrix);
          vec3 scaleSquared = vec3(dot(rotationScale[0], rotationScale[0]), dot(rotationScale[1], rotationScale[1]), dot(rotationScale[2], rotationScale[2]));
          vBoulderNormal = normalize(rotationScale * (normal / scaleSquared));
          vBoulderState = vec3(boulderState, clamp(position.y + 0.5, 0.0, 1.0));
          #ifdef USE_TERRAIN_DETAIL
            vDetailPos = morphedPosition + uBoulderDetailOrigin;
            vDetailPos2 = morphedPosition + uBoulderDetailOrigin2;
            vHeightMeters = 0.0;
          #endif
          ${ShaderChunk.logdepthbuf_vertex}
        }
      `,
      // The parent already includes cloud receiver injection and application chunks.
      fragmentShader: parent.fragmentShader
    })
    this.name = 'Terrain boulders'
    this.localUniforms.uDetailScale.value = 1 / toThreeJSUnits((BOULDER_TEXTURE_METERS * sizeScale) / 1000)
    this.sync(parent)
    const receiver = (parent as ShaderMaterial & { sceneCloudReceiver?: SceneCloudReceiver }).sceneCloudReceiver
    if (receiver) this.sceneCloudReceiver = this.borrowCloudReceiver(receiver)
  }

  public sync(parent: ShaderMaterial): void {
    Object.assign(this.uniforms, parent.uniforms, this.localUniforms)
    if (this.fragmentShader !== parent.fragmentShader) {
      this.fragmentShader = parent.fragmentShader
      this.needsUpdate = true
    }
    const defines = Object.fromEntries(Object.entries(parent.defines).filter(([name]) => !excluded.has(name)))
    defines.USE_TERRAIN_BOULDER = true
    const key = JSON.stringify(defines)
    if (key !== this.defineKey) {
      this.defineKey = key
      this.defines = defines
      this.needsUpdate = true
    }
  }

  /** Share the terrain's cloud state, but register our own draw slots and near program. */
  private borrowCloudReceiver(parent: SceneCloudReceiver): SceneCloudReceiver {
    let near: ShaderMaterial | null = null, signature = '', retry = 0, disposed = false
    const releaseNear = (): void => {
      near?.dispose()
      near = null
      signature = ''
    }
    return {
      getLightSettings: parent.getLightSettings?.bind(parent),
      getEndpointMaterial: (endpoint, cascadeCount) => {
        if (disposed) throw new Error('Boulder cloud receiver is disposed')
        const source = parent.getEndpointMaterial(endpoint, cascadeCount)
        this.sync(endpoint === 'far' ? source : parent.getEndpointMaterial('far'))
        if (endpoint === 'far') return this
        const cascades = source.defines.SCENE_CLOUD_SHADOW_CASCADE_COUNT
        const nextSignature = `${sceneCloudProgramSignature(this)};cascades:${cascades}`
        near ??= new ShaderMaterial()
        syncSceneCloudNearMaterial(this, near)
        near.defines.SCENE_CLOUD_SHADOW_CASCADE_COUNT = cascades
        const key = near.customProgramCacheKey()
        near.customProgramCacheKey = () => `${key};boulder-cloud-retry-${retry}`
        if (nextSignature !== signature) {
          signature = nextSignature
          near.needsUpdate = true
        }
        return near
      },
      retryEndpointMaterial: () => {
        if (disposed) return
        releaseNear()
        retry++
      },
      // The terrain receiver is registered alongside this one and owns these
      // shared uniforms. Do not reset or reinject its state for a derived draw.
      setFarMap: () => {},
      setEndpoint: () => {},
      dispose: () => {
        if (disposed) return
        disposed = true
        releaseNear()
      }
    }
  }

  public override dispose(): void {
    this.sceneCloudReceiver?.dispose()
    super.dispose()
  }
}

export function createBoulderContactMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: 'Boulder contact',
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    vertexShader: `
      ${ShaderChunk.common}
      ${ShaderChunk.logdepthbuf_pars_vertex}
      attribute vec2 boulderState;
      varying vec2 vContactUv;
      varying float vContactFade;
      void main() {
        vContactUv = uv * 2.0 - 1.0;
        vContactFade = boulderState.x;
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        ${ShaderChunk.logdepthbuf_vertex}
      }
    `,
    fragmentShader: `
      ${ShaderChunk.common}
      ${ShaderChunk.logdepthbuf_pars_fragment}
      varying vec2 vContactUv;
      varying float vContactFade;
      void main() {
        ${ShaderChunk.logdepthbuf_fragment}
        float r = dot(vContactUv, vContactUv);
        if (r >= 1.0) discard;
        gl_FragColor = vec4(0.0, 0.0, 0.0, 0.32 * (1.0 - smoothstep(0.08, 1.0, r)) * vContactFade);
      }
    `
  })
}
