import { ShaderMaterial } from 'three'

const hookIds = new WeakMap<object, number>()
let nextHookId = 0
const signatures = new WeakMap<
  ShaderMaterial,
  {
    vertex: string
    fragment: string
    settings: string
    signature: string
  }
>()
function hookId(value: object): number {
  if (!hookIds.has(value)) hookIds.set(value, ++nextHookId)
  return hookIds.get(value)!
}
/** Only program inputs, never uniform values or owner.version. */
export function sceneCloudProgramSignature(owner: ShaderMaterial): string {
  const settings = [
    Object.entries(owner.defines).sort(([a], [b]) => a.localeCompare(b)),
    owner.glslVersion,
    owner.extensions,
    owner.precision,
    owner.lights,
    owner.fog,
    owner.clipping,
    owner.clippingPlanes?.length,
    owner.clipIntersection,
    owner.vertexColors,
    owner.side,
    owner.shadowSide,
    owner.transparent,
    owner.alphaTest > 0,
    owner.alphaHash,
    owner.alphaToCoverage,
    owner.premultipliedAlpha,
    owner.dithering,
    owner.toneMapped,
    owner.index0AttributeName,
    hookId(owner.onBeforeCompile),
    owner.customProgramCacheKey(),
    Object.keys(owner.uniforms).sort()
  ]
  const settingsSignature = JSON.stringify(settings)
  const cached = signatures.get(owner)
  if (
    cached?.vertex === owner.vertexShader &&
    cached.fragment === owner.fragmentShader &&
    cached.settings === settingsSignature
  )
    return cached.signature
  // Shader sources dominate this string's size. Unchanged materials reuse the
  // full signature; live defines, hooks and uniform layout are still checked.
  const signature = JSON.stringify([owner.vertexShader, owner.fragmentShader, ...settings])
  signatures.set(owner, {
    vertex: owner.vertexShader,
    fragment: owner.fragmentShader,
    settings: settingsSignature,
    signature
  })
  return signature
}

/** ShaderMaterial.copy normally clones borrowed Texture Sources and UniformsGroups. */
export function syncSceneCloudNearMaterial(owner: ShaderMaterial, near: ShaderMaterial): void {
  const uniforms = near.uniforms
  // Read through the owner prototype/accessors; a spread loses inherited alpha settings.
  const source: ShaderMaterial = Object.create(owner)
  Object.defineProperties(source, {
    uniforms: { value: {} },
    uniformsGroups: { value: [] },
    userData: { value: {} }
  })
  near.copy(source)
  near.name = `${owner.name}:scene-cloud-near`
  for (const name of Object.keys(uniforms)) if (!(name in owner.uniforms)) delete uniforms[name]
  Object.assign(uniforms, owner.uniforms)
  near.uniforms = uniforms
  near.uniformsGroups = owner.uniformsGroups
  near.defines = { ...owner.defines, SCENE_CLOUD_NEAR: 1 }
  near.onBeforeCompile = owner.onBeforeCompile
  near.onBeforeRender = owner.onBeforeRender
  const names = JSON.stringify(Object.keys(uniforms).sort())
  near.customProgramCacheKey = () => `${owner.customProgramCacheKey()};scene-cloud-uniforms:${names}`
}
