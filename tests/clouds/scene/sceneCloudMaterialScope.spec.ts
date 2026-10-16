import { describe, expect, it } from 'vitest'
import { Group, Mesh, Scene, ShaderMaterial } from 'three'
import { withSceneCloudMaterials } from '@/core/graphic/clouds/sceneCloudMaterialScope'

describe('selected scene cloud material scope', () => {
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
