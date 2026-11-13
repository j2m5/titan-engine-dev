import type { UpdateContext } from '@/core/UpdateContext'
import type { TerrainPatchGroup } from '@/core/terrain/TerrainPatchGroup'

/** Direct surface tests run the same simulation/view phases as SceneManager. */
export function updateTerrainFrame(group: TerrainPatchGroup, ctx: UpdateContext): void {
  group.updateObject(ctx)
  group.updateView(ctx.camera)
}
