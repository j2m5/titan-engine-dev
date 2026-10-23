import { vi } from 'vitest'
import type { BufferGeometry } from 'three'
import { buildArchetypeGeometry } from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ArchetypeGeometry'
import { ArchetypeShape, generateArchetypeParams, type ArchetypeMorphology } from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ArchetypeShape'
import { SeededRandom } from '@/core/renderables/DetailedRingStreamingSystem/SeededRandom'
import { buildArchetypeGeometry as buildOriginalGeometry } from './nonIndexedGeometryReference'

const morphologies: ArchetypeMorphology[] = ['fragment', 'rubble', 'binary', 'top', 'cratered']
const makeShape = (morphology: ArchetypeMorphology = 'fragment') =>
  new ArchetypeShape(generateArchetypeParams(new SeededRandom(9137), morphology))

/** Expand triangle corners, retaining float32 bits (including signed zero). */
function expandedWords(geometry: BufferGeometry, name: string): Uint32Array {
  const attribute = geometry.getAttribute(name), array = attribute.array as Float32Array
  const words = new Uint32Array(array.buffer, array.byteOffset, array.length)
  const count = geometry.index?.count ?? attribute.count
  const expanded = new Uint32Array(count * attribute.itemSize)
  for (let corner = 0; corner < count; corner++) {
    const vertex = geometry.index?.getX(corner) ?? corner
    expect(vertex).toBeGreaterThanOrEqual(0)
    expect(vertex).toBeLessThan(attribute.count)
    expanded.set(words.subarray(vertex * attribute.itemSize, (vertex + 1) * attribute.itemSize), corner * attribute.itemSize)
  }
  return expanded
}

function checkOriginalBits(morphology: ArchetypeMorphology, detail: number, radius: number): void {
  const shape = makeShape(morphology)
  const original = buildOriginalGeometry(shape, detail, radius), indexed = buildArchetypeGeometry(shape, detail, radius)
  try {
    for (const name of ['position', 'normal', 'surfaceData']) {
      expect(expandedWords(indexed, name), name).toEqual(expandedWords(original, name))
    }
  } finally { original.dispose(); indexed.dispose() }
}

describe('exact procedural asteroid indexing', () => {
  it.each([[0, 60, 12], [1, 240, 42], [3, 960, 162], [7, 3840, 642]])(
    'detail %i keeps %i triangle corners using %i unique vertices', (detail, corners, unique) => {
      const geometry = buildArchetypeGeometry(makeShape(), detail, 0.005)
      try {
        expect(geometry.index?.count).toBe(corners)
        for (const name of ['position', 'normal', 'surfaceData']) expect(geometry.getAttribute(name).count).toBe(unique)
      } finally { geometry.dispose() }
    }
  )

  for (const morphology of morphologies) {
    it.each([0, 1, 3, 7])(`${morphology}, detail %i: all expanded attributes match the original bits`, detail => {
      checkOriginalBits(morphology, detail, 0.005)
    })
    it.each([1e-9, 0, -0.005])(`${morphology}, radius %s: no tolerance welding or lost surface data`, radius => {
      checkOriginalBits(morphology, 3, radius)
    })
  }

  it('evaluates the shape once per unique direction, including four normal samples', () => {
    const shape = makeShape(), surface = vi.spyOn(shape, 'surfaceAt')
    const geometry = buildArchetypeGeometry(shape, 0, 1)
    try { expect(surface).toHaveBeenCalledTimes(12 * 5) }
    finally { surface.mockRestore(); geometry.dispose() }
  })
})
