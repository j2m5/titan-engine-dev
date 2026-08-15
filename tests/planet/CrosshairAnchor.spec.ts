import { describe, expect, it } from 'vitest'
import { Group, Mesh, Object3D } from 'three'
import { resolveCrosshairAnchor } from '@/core/helpers/resolveCrosshairAnchor'

describe('resolveCrosshairAnchor: якорь прицела не гаснет вместе с LOD-переключением', () => {
  it('патч кубосферы: якорь — группа TerrainSphere, её parent (LOD) видим всегда', () => {
    const lod = new Object3D() // эмуляция THREE.LOD — сам не скрывается, скрывает свои уровни
    const terrainSphere = new Group()
    terrainSphere.userData.clickable = true
    const patch = new Mesh()
    patch.userData.clickable = true

    lod.add(terrainSphere)
    terrainSphere.add(patch)

    const anchor = resolveCrosshairAnchor(patch)

    expect(anchor).toBe(terrainSphere)
    expect(anchor.parent).toBe(lod)
  })

  it('легаси-меш без кликабельного родителя: якорь — сам объект (поведение прежнее)', () => {
    const lod = new Object3D()
    const planet = new Mesh()
    planet.userData.clickable = true

    lod.add(planet)

    const anchor = resolveCrosshairAnchor(planet)

    expect(anchor).toBe(planet)
    expect(anchor.parent).toBe(lod)
  })

  it('объект без родителя вообще — якорь сам объект, parent null', () => {
    const orphan = new Mesh()
    orphan.userData.clickable = true

    expect(resolveCrosshairAnchor(orphan)).toBe(orphan)
  })
})
