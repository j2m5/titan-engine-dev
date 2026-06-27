import { selectLOD } from '@/core/renderables/Nebula/volume/lod'

describe('selectLOD', () => {
  it('uses raymarch when the nebula is large on screen', () => {
    expect(selectLOD(800, 'auto').mode).toBe('raymarch')
    expect(selectLOD(800, 'auto').blend).toBe(1)
  })

  it('uses impostor when small on screen', () => {
    expect(selectLOD(40, 'auto').mode).toBe('impostor')
    expect(selectLOD(40, 'auto').blend).toBe(0)
  })

  it('produces a blended band between the thresholds', () => {
    const r = selectLOD(300, 'auto')
    expect(r.blend).toBeGreaterThan(0)
    expect(r.blend).toBeLessThan(1)
  })

  it('respects forced LOD', () => {
    expect(selectLOD(40, 'raymarch').mode).toBe('raymarch')
    expect(selectLOD(40, 'raymarch').blend).toBe(1)
    expect(selectLOD(800, 'impostor').mode).toBe('impostor')
    expect(selectLOD(800, 'impostor').blend).toBe(0)
  })
})
