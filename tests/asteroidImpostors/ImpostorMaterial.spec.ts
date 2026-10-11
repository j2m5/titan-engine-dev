import { DataArrayTexture } from 'three'
import { BillboardAsteroidMaterial } from '@/core/renderables/DetailedRingStreamingSystem/BillboardAsteroidMaterial'
import { createImpostorLayout } from '@/core/renderables/DetailedRingStreamingSystem/impostors/impostorLayout'
import type { ImpostorSnapshot } from '@/core/renderables/DetailedRingStreamingSystem/impostors/impostorTypes'

function readySnapshot(): ImpostorSnapshot {
  const layout = createImpostorLayout(8, 64)
  return { generation: 1, state: 'ready', atlas: { normalDepth: new DataArrayTexture(), surfaceCoverage: new DataArrayTexture(), layout, layerCount: 3, dispose: vi.fn() },
    slotLayers: new Int32Array([0, 1]), halfExtents: new Float32Array([1.05, 1.2]), revisions: [], reason: null }
}

describe('атласный материал L1', () => {
  it('при отказе компиляции включает отдельную legacy-программу и восстанавливает атлас после готовности', () => {
    const material = new BillboardAsteroidMaterial(undefined, true, true, true)
    const legacy = new BillboardAsteroidMaterial(undefined, true, true)
    const snapshot = readySnapshot(), uniforms = { ...material.uniforms }
    const atlasFragment = material.fragmentShader, atlasVertex = material.vertexShader, version = material.version
    material.fragmentShader = 'broken atlas program'
    material.setImpostorSnapshot({ ...snapshot, state: 'legacy', atlas: null, reason: 'Ошибка шейдера' })
    expect(material.vertexShader).toBe(legacy.vertexShader)
    expect(material.fragmentShader).toBe(legacy.fragmentShader)
    expect(material.version).toBeGreaterThan(version)
    expect(material.uniforms.uImpostorReady.value).toBe(0)
    material.setImpostorSnapshot(snapshot)
    expect(material.vertexShader).toBe(atlasVertex)
    expect(material.fragmentShader).toBe(atlasFragment)
    for (const key of Object.keys(uniforms)) expect(material.uniforms[key]).toBe(uniforms[key])
    material.dispose(); legacy.dispose()
  })

  it('готовит обе ветки заранее и меняет снимок без перекомпиляции', () => {
    const material = new BillboardAsteroidMaterial(undefined, false, false, true), next = readySnapshot()
    const uniforms = { ...material.uniforms }, version = material.version
    expect(material.uniforms.uImpostorReady.value).toBe(0)
    material.setImpostorSnapshot(next)
    expect(material.uniforms.uImpostorReady.value).toBe(1)
    expect(material.uniforms.uImpostorNormalDepth.value).toBe(next.atlas!.normalDepth)
    expect(material.uniforms.uImpostorSurfaceCoverage.value).toBe(next.atlas!.surfaceCoverage)
    expect(Array.from(material.uniforms.uImpostorSlotLayers.value).slice(0, 2)).toEqual([0, 1])
    expect(material.uniforms.uImpostorHalfExtents.value[1]).toBeCloseTo(1.2, 6)
    for (const key of Object.keys(uniforms)) expect(material.uniforms[key]).toBe(uniforms[key])
    material.setImpostorSnapshot(null)
    expect(material.uniforms.uImpostorReady.value).toBe(0)
    expect(material.version).toBe(version)
    expect(material.fragmentShader).toContain('billboardSilhouette(')
    expect(material.fragmentShader).toContain('shadeAsteroid(')
    material.dispose()
  })

  it('не уничтожает заимствованный атлас', () => {
    const material = new BillboardAsteroidMaterial(undefined, false, false, true), snapshot = readySnapshot(), dispose = vi.fn()
    snapshot.atlas!.normalDepth.addEventListener('dispose', dispose)
    material.setImpostorSnapshot(snapshot)
    material.dispose()
    expect(dispose).not.toHaveBeenCalled()
    expect(snapshot.atlas!.dispose).not.toHaveBeenCalled()
  })

  it('наследует позу, пишет восстановленную глубину и не умножает dither-fade в alpha', () => {
    const material = new BillboardAsteroidMaterial(undefined, true, true, true)
    expect(material.vertexShader).toContain('asteroidSpinMatrix(')
    expect(material.fragmentShader).toContain('uniform highp sampler2DArray uImpostorNormalDepth')
    expect(material.fragmentShader).toContain('textureLod(')
    expect(material.fragmentShader).toContain('gl_FragDepth = log2(1.0 - viewPosition.z)')
    expect(material.fragmentShader).toContain('coverage * uFade * vDistanceFade')
    expect(material.vertexShader).toContain('instanceDetailEnd > 0.0')
    material.dispose()
  })

  it('сохраняет прежний материал без atlasMode', () => {
    const legacy = new BillboardAsteroidMaterial()
    expect(legacy.vertexShader).not.toContain('uSpinPeriod')
    expect(legacy.uniforms.uImpostorReady).toBeUndefined()
    legacy.dispose()
  })
})
