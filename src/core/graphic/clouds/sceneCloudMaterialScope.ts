import type { Material, Mesh, Scene, ShaderMaterial } from 'three'

/** Selected actual draw slots only. Restore exact arrays even after a partial traversal. */
export function withSceneCloudMaterials<T>(
  scene: Scene,
  bindings: ReadonlyMap<ShaderMaterial, ShaderMaterial>,
  draw: () => T
): T {
  const saved: Array<{ mesh: Mesh; material: Material | Material[] }> = []
  let result!: T,
    failure: unknown,
    failed = false
  try {
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
    })
    result = draw()
  } catch (error) {
    failed = true
    failure = error
  } finally {
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
