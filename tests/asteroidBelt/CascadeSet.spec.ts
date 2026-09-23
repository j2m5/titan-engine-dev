import { describe, it, expect, vi } from 'vitest'
import { Matrix4, Vector3 } from 'three'
import { CascadeSet } from '@/core/renderables/DetailedRingStreamingSystem/CascadeSet'
import type { SectorManager } from '@/core/renderables/DetailedRingStreamingSystem/SectorManager'

const fakeManager = (activeSectors: number) =>
  ({
    update: vi.fn(),
    rebaseOrigins: vi.fn(),
    deactivateAll: vi.fn(),
    activeCount: activeSectors,
    getDebugInfo: vi.fn(() => ({ activeSectors, byLod: { l0: 1, near: 0, l1: activeSectors - 1 }, pendingRemoval: 0 }))
  }) as unknown as SectorManager

describe('CascadeSet', () => {
  it('обновляет все каскады теми же аргументами', () => {
    const a = fakeManager(2)
    const b = fakeManager(3)
    const set = new CascadeSet([a, b])
    const viewProj = new Matrix4()
    const localToWorld = new Matrix4()

    set.update(0.5, 100, 2, viewProj, localToWorld, 0.016)

    expect(a.update).toHaveBeenCalledWith(0.5, 100, 2, viewProj, localToWorld, 0.016)
    expect(b.update).toHaveBeenCalledWith(0.5, 100, 2, viewProj, localToWorld, 0.016)
  })

  it('переезд начала и сброс доходят до каждого каскада', () => {
    const a = fakeManager(1)
    const b = fakeManager(1)
    const set = new CascadeSet([a, b])
    const shift = new Vector3(1, 0, 0)

    set.rebaseOrigins(shift)
    set.deactivateAll()

    expect(a.rebaseOrigins).toHaveBeenCalledWith(shift)
    expect(b.rebaseOrigins).toHaveBeenCalledWith(shift)
    expect(a.deactivateAll).toHaveBeenCalled()
    expect(b.deactivateAll).toHaveBeenCalled()
  })

  it('диагностика — сумма по каскадам и разбивка по каждому', () => {
    const set = new CascadeSet([fakeManager(2), fakeManager(3)])
    const info = set.getDebugInfo()

    expect(info.activeSectors).toBe(5)
    expect(info.perCascade).toHaveLength(2)
    expect(set.activeCount).toBe(5)
  })

  it('один каскад — поведение как у одиночного менеджера', () => {
    const only = fakeManager(4)
    const set = new CascadeSet([only])

    set.update(0, 50, 0, new Matrix4(), new Matrix4(), 0.016)

    expect(only.update).toHaveBeenCalledTimes(1)
    expect(set.activeCount).toBe(4)
  })
})
