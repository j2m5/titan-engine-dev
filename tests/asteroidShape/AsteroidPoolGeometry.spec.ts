import { vi } from 'vitest'

vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: { getTexture: () => null }
}))

import { IcosahedronGeometry } from 'three'
import { InstancePool } from '@/core/renderables/DetailedRingStreamingSystem/InstancePool'

const cfg = { maxInstances: 10 }

describe('InstancePool: переданная геометрия L0 (массив геометрий, K=1)', () => {
  it('geometryMeshes[0].geometry делит position-атрибут (GPU-буфер) с переданной геометрией, но это НЕ тот же объект геометрии', () => {
    const l0Geometry = new IcosahedronGeometry(1, 2)
    const pool = new InstancePool(cfg, cfg, cfg, [l0Geometry], [new IcosahedronGeometry(1, 2)], 2.5)
    const meshGeometry = pool.geometryMeshes[0].geometry

    // Обёртка — свой BufferGeometry (иначе instanceFade мутировал бы разделяемый кэш архетипа)
    expect(meshGeometry).not.toBe(l0Geometry)
    // Тяжёлый атрибут разделяется по ссылке — GPU-буфер один, копий нет
    expect(meshGeometry.getAttribute('position')).toBe(l0Geometry.getAttribute('position'))
  })

  it('на ПЕРЕДАННОЙ геометрии instanceFade не появляется — защита от мутации разделяемого кэша', () => {
    const l0Geometry = new IcosahedronGeometry(1, 2)
    const pool = new InstancePool(cfg, cfg, cfg, [l0Geometry], [new IcosahedronGeometry(1, 2)], 2.5)
    expect(pool.geometryMeshes[0].geometry.getAttribute('instanceFade')).toBeDefined()
    expect(l0Geometry.getAttribute('instanceFade')).toBeUndefined()
  })

  it('на геометрии меша instanceFade существует и имеет ёмкость стрима (ceil(maxInstances/K·1.5), K=1)', () => {
    const l0Geometry = new IcosahedronGeometry(1, 2)
    const pool = new InstancePool(cfg, cfg, cfg, [l0Geometry], [new IcosahedronGeometry(1, 2)], 2.5)
    const attr = pool.geometryMeshes[0].geometry.getAttribute('instanceFade')
    expect(attr).toBeDefined()
    expect(attr.count).toBe(Math.ceil(cfg.maxInstances * 1.5))
  })
})
