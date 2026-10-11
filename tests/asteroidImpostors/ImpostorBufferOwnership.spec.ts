import { BoxGeometry, type BufferGeometry } from 'three'
import { WebGLAttributes } from 'three/src/renderers/webgl/WebGLAttributes.js'
import { WebGLGeometries } from 'three/src/renderers/webgl/WebGLGeometries.js'
import { InstancePool } from '@/core/renderables/DetailedRingStreamingSystem/InstancePool'

function gpuHarness() {
  const buffers = new Set<object>()
  const gl = { ARRAY_BUFFER: 34962, ELEMENT_ARRAY_BUFFER: 34963, FLOAT: 5126, UNSIGNED_SHORT: 5123, UNSIGNED_INT: 5125,
    createBuffer: () => { const buffer = {}; buffers.add(buffer); return buffer },
    bindBuffer: () => {}, bufferData: () => {}, deleteBuffer: (buffer: object) => { buffers.delete(buffer) } } as unknown as WebGL2RenderingContext
  const attributes = new WebGLAttributes(gl), info = { memory: { geometries: 0 } }
  // Типы пакета ещё не описывают четвёртый параметр r182.
  const Geometries = WebGLGeometries as unknown as new (...args: unknown[]) => WebGLGeometries
  const geometries = new Geometries(gl, attributes, info, { releaseStatesOfGeometry: () => {} })
  return { buffers, attributes, info, render: (pool: InstancePool) => {
    for (const mesh of [...pool.geometryMeshes, ...pool.nearMeshes, pool.billboardMesh]) {
      geometries.get(mesh, mesh.geometry); geometries.update(mesh.geometry)
      if (mesh.geometry.index) attributes.update(mesh.geometry.index, gl.ELEMENT_ARRAY_BUFFER)
    }
  } }
}
const pool = (l0: BufferGeometry, near: BufferGeometry) => new InstancePool(
  { maxInstances: 3 }, { maxInstances: 3 }, { maxInstances: 3 }, [l0], [near], 2, undefined, false, false, true)
const dispose = (p: InstancePool) => {
  for (const mesh of [...p.geometryMeshes, ...p.nearMeshes, p.billboardMesh]) mesh.geometry.dispose()
  p.geometryMaterial.dispose(); p.billboardMaterial.dispose()
}

describe('Владение VBO общих форм через установленный three.js', () => {
  it('замена освобождает вытесненные буферы, сохраняет instance-данные, teardown удаляет все handles', () => {
    const gpu = gpuHarness(), p = pool(new BoxGeometry(), new BoxGeometry())
    gpu.render(p)
    const old = p.geometryMeshes[0].geometry.getAttribute('position')
    const fade = p.geometryMeshes[0].geometry.getAttribute('instanceFade'), data = Array.from(fade.array)
    p.replaceArchetypeGeometry(0, new BoxGeometry(2, 1, 1), new BoxGeometry(3, 2, 1))
    expect(gpu.attributes.get(old)).toBeUndefined()
    expect(p.geometryMeshes[0].geometry.getAttribute('instanceFade')).toBe(fade)
    expect(Array.from(fade.array)).toEqual(data)
    gpu.render(p)
    expect(gpu.attributes.get(fade)).toBeDefined()
    dispose(p)
    expect(gpu.buffers.size).toBe(0)
    expect(gpu.info.memory.geometries).toBe(0)
  })

  it('общие VBO живут до последнего отрисованного потребителя, а не до первого dispose', () => {
    const gpu = gpuHarness(), source = new BoxGeometry(), a = pool(source, source), b = pool(source, source)
    gpu.render(a); gpu.render(b)
    const attribute = source.getAttribute('position'), buffer = gpu.attributes.get(attribute)!.buffer
    a.replaceArchetypeGeometry(0, new BoxGeometry(), new BoxGeometry())
    expect(gpu.attributes.get(attribute)!.buffer).toBe(buffer)
    gpu.render(a)
    dispose(b)
    expect(gpu.attributes.get(attribute)).toBeUndefined()
    dispose(a)
    expect(gpu.buffers.size).toBe(0)
  })

  it('неотрисованная новая обёртка не удерживает VBO после удаления последней GPU-обёртки', () => {
    const gpu = gpuHarness(), source = new BoxGeometry(), p = pool(source, source)
    gpu.render(p)
    const update = p.prepareArchetypeGeometry(0, source, source)
    update.commit(); update.dispose()
    expect(gpu.attributes.get(source.getAttribute('position'))).toBeUndefined()
    dispose(p)
    expect(gpu.buffers.size).toBe(0)
  })
})
