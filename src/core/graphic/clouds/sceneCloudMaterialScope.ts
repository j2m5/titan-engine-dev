import type { Material, Mesh, Scene, ShaderMaterial } from 'three'
import type { SceneCloudReceiver } from '@/core/clouds/receivers/SceneCloudReceiver'

export interface CloudDrawAttribution {
  owners: ReadonlyMap<ShaderMaterial, SceneCloudReceiver>
  set(receiver: SceneCloudReceiver | null): void
}

/** Selected actual draw slots only. Restore exact arrays even after a partial traversal. */
export function withSceneCloudMaterials<T>(
  scene: Scene,
  bindings: ReadonlyMap<ShaderMaterial, ShaderMaterial>,
  draw: () => T,
  attribution?: CloudDrawAttribution
): T {
  const saved: Array<{ mesh: Mesh; material: Material | Material[] }> = []
  const restorers: Array<() => void> = []
  const wrapped = new Set<ShaderMaterial>()
  let current: SceneCloudReceiver | null = null
  const mark = (value: SceneCloudReceiver | null) => {
    current = value
    attribution?.set(value)
  }
  let result!: T,
    failure: unknown,
    failed = false
  try {
    mark(null)
    scene.traverse((object) => {
      const mesh = object as Mesh
      if (!mesh.isMesh) return
      const original = mesh.material
      const replace = (material: Material) => bindings.get(material as ShaderMaterial) ?? material
      const next = Array.isArray(original) ? original.map(replace) : replace(original)
      if (
        Array.isArray(original)
          ? original.every((material, i) => material === (next as Material[])[i])
          : next === original
      )
        return
      saved.push({ mesh, material: original })
      mesh.material = next
      if (attribution) {
        const before = mesh.onBeforeRender,
          after = mesh.onAfterRender
        restorers.push(() => {
          mesh.onBeforeRender = before
          mesh.onAfterRender = after
        })
        mesh.onBeforeRender = function (...args) {
          mark(null)
          try {
            before.apply(this, args)
          } finally {
            mark(null)
          }
        }
        mesh.onAfterRender = function (...args) {
          mark(null)
          try {
            after.apply(this, args)
          } finally {
            mark(null)
          }
        }
        for (const material of Array.isArray(next) ? next : [next]) {
          const near = material as ShaderMaterial,
            receiver = attribution.owners.get(near)
          if (!receiver || wrapped.has(near)) continue
          wrapped.add(near)
          const before = near.onBeforeRender,
            compile = near.onBeforeCompile
          restorers.push(() => {
            near.onBeforeRender = before
            near.onBeforeCompile = compile
          })
          near.onBeforeRender = function (...args) {
            mark(null)
            try {
              before.apply(this, args)
            } finally {
              mark(null)
            }
            mark(receiver)
          }
          near.onBeforeCompile = function (...args) {
            const previous = current
            mark(null)
            compile.apply(this, args)
            mark(previous)
          }
        }
      }
    })
    result = draw()
  } catch (error) {
    failed = true
    failure = error
  } finally {
    mark(null)
    for (const restore of restorers.reverse())
      try {
        restore()
      } catch (error) {
        if (!failed) failure = error
        failed = true
      }
    // Try every restoration even if an unexpected owner setter throws.
    for (const { mesh, material } of saved.reverse())
      try {
        mesh.material = material
      } catch (error) {
        if (!failed) failure = error
        failed = true
      }
  }
  if (failed) throw failure
  return result
}
