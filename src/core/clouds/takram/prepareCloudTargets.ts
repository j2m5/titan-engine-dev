import type { CloudsEffect } from '@takram/three-clouds'
/** Takram 0.7.6 obtains the array texture handle before binding its target.
 * Initialize it first so the first current/resolve draw attaches every layer.
 */
export function prepareCloudTargets(clouds: CloudsEffect): () => void {
  const restores = [clouds.shadowPass.currentPass, clouds.shadowPass.resolvePass].map((pass) => {
    const original = pass.render
    pass.render = function (...args: Parameters<typeof original>) {
      args[0].initRenderTarget(args[2])
      return original.apply(this, args)
    }
    return () => {
      pass.render = original
    }
  })
  let restored = false
  return () => {
    if (restored) return
    restored = true
    restores.forEach((restore) => restore())
  }
}
