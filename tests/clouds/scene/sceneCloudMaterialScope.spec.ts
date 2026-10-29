import { describe, expect, it } from 'vitest'
import { Group, Mesh, Scene, ShaderMaterial } from 'three'
import { withSceneCloudMaterials } from '@/core/graphic/clouds/sceneCloudMaterialScope'
import type { SceneCloudReceiver } from '@/core/clouds/receivers/SceneCloudReceiver'

describe('selected scene cloud material scope', () => {
  it('attributes only an actual owned draw, suspends all user hooks, and restores exact hooks after throw', () => {
    const far = new ShaderMaterial(),
      near = new ShaderMaterial(),
      mesh = new Mesh(undefined, far),
      scene = new Scene()
    const receiver = {} as SceneCloudReceiver
    let marker: SceneCloudReceiver | null = null
    const hook = () => {
      expect(marker).toBeNull()
    }
    mesh.onBeforeRender = hook
    mesh.onAfterRender = hook
    near.onBeforeRender = hook
    near.onBeforeCompile = hook
    const before = mesh.onBeforeRender,
      after = mesh.onAfterRender,
      materialBefore = near.onBeforeRender,
      compile = near.onBeforeCompile
    const key = () => 'stable-owned-variant'
    near.customProgramCacheKey = key
    scene.add(mesh)
    expect(() =>
      withSceneCloudMaterials(
        scene,
        new Map([[far, near]]),
        () => {
          Reflect.apply(mesh.onBeforeRender, mesh, [])
          Reflect.apply(near.onBeforeRender, near, [])
          expect(marker).toBe(receiver)
          Reflect.apply(near.onBeforeCompile, near, [])
          expect(marker).toBe(receiver)
          Reflect.apply(mesh.onAfterRender, mesh, [])
          expect(marker).toBeNull()
          throw Error('near scoped exception')
        },
        {
          owners: new Map([[near, receiver]]),
          set: (value) => {
            marker = value
          }
        }
      )
    ).toThrow('near scoped exception')
    expect(mesh.material).toBe(far)
    expect(mesh.onBeforeRender).toBe(before)
    expect(mesh.onAfterRender).toBe(after)
    expect(near.onBeforeRender).toBe(materialBefore)
    expect(near.onBeforeCompile).toBe(compile)
    expect(near.customProgramCacheKey).toBe(key)
    expect(marker).toBeNull()
  })
  it.each([false, true])('restores shared Mesh slots and exact arrays, ignoring getter Groups (throw=%s)', (fail) => {
    const far = new ShaderMaterial(),
      near = new ShaderMaterial(),
      other = new ShaderMaterial()
    const scene = new Scene(),
      group = new Group(),
      a = new Mesh(undefined, far),
      b = new Mesh(undefined, [other, far]),
      c = new Mesh(undefined, other)
    Object.defineProperty(group, 'material', { get: () => far })
    group.add(a, b, c)
    scene.add(group)
    const array = b.material
    const draw = () =>
      withSceneCloudMaterials(scene, new Map([[far, near]]), () => {
        expect(a.material).toBe(near)
        expect(b.material).toEqual([other, near])
        expect(c.material).toBe(other)
        if (fail) throw Error('near draw')
      })
    if (fail) expect(draw).toThrow('near draw')
    else draw()
    expect(a.material).toBe(far)
    expect(b.material).toBe(array)
  })
  it('restores earlier swaps when a later Mesh assignment fails', () => {
    const far = new ShaderMaterial(),
      near = new ShaderMaterial(),
      a = new Mesh(undefined, far),
      b = new Mesh(undefined, far),
      scene = new Scene()
    Object.defineProperty(b, 'material', {
      get: () => far,
      set: () => {
        throw Error('partial swap')
      }
    })
    scene.add(a, b)
    expect(() => withSceneCloudMaterials(scene, new Map([[far, near]]), () => {})).toThrow('partial swap')
    expect(a.material).toBe(far)
  })
})
