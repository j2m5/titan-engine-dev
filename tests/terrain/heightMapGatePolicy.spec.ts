import { describe, expect, it } from 'vitest'
import { decideHeightMaps, type HeightMapCandidate } from '@/core/terrain/heightMapGatePolicy'

const LOAD: number = 10
const RELEASE: number = 4

function candidate(path: string, actorPriority: number): HeightMapCandidate {
  return { path, actorPriority }
}

describe('decideHeightMaps: политика гейта карт высот', () => {
  it('тело выше верхнего порога запрашивается', () => {
    const decision = decideHeightMaps([candidate('moon.raw', 12)], [], LOAD, RELEASE)

    expect(decision.request).toEqual(['moon.raw'])
    expect(decision.release).toEqual([])
  })

  it('ровно на верхнем пороге запрашивается — граница включающая', () => {
    expect(decideHeightMaps([candidate('moon.raw', LOAD)], [], LOAD, RELEASE).request).toEqual(['moon.raw'])
  })

  it('между порогами состояние не меняется: не грузится, если не держали', () => {
    const decision = decideHeightMaps([candidate('moon.raw', 6)], [], LOAD, RELEASE)

    expect(decision.request).toEqual([])
    expect(decision.release).toEqual([])
  })

  it('между порогами состояние не меняется: не отпускается, если держали (гистерезис)', () => {
    const decision = decideHeightMaps([candidate('moon.raw', 6)], ['moon.raw'], LOAD, RELEASE)

    expect(decision.request).toEqual([])
    expect(decision.release).toEqual([])
  })

  it('ниже нижнего порога удерживаемая карта освобождается', () => {
    const decision = decideHeightMaps([candidate('moon.raw', 1)], ['moon.raw'], LOAD, RELEASE)

    expect(decision.request).toEqual([])
    expect(decision.release).toEqual(['moon.raw'])
  })

  it('ровно на нижнем пороге не освобождается — граница включающая', () => {
    expect(decideHeightMaps([candidate('moon.raw', RELEASE)], ['moon.raw'], LOAD, RELEASE).release).toEqual([])
  })

  it('уже удерживаемая карта повторно не запрашивается', () => {
    const decision = decideHeightMaps([candidate('moon.raw', 12)], ['moon.raw'], LOAD, RELEASE)

    expect(decision.request).toEqual([])
  })

  it('удерживаемая карта тела, пропавшего из наблюдения, освобождается как сирота', () => {
    const decision = decideHeightMaps([], ['moon.raw'], LOAD, RELEASE)

    expect(decision.release).toEqual(['moon.raw'])
  })

  it('дубль пути берёт максимальный приоритет владельцев', () => {
    const decision = decideHeightMaps([candidate('moon.raw', 1), candidate('moon.raw', 12)], [], LOAD, RELEASE)

    expect(decision.request).toEqual(['moon.raw'])
  })

  it('несколько тел разводятся независимо', () => {
    const decision = decideHeightMaps(
      [candidate('moon.raw', 12), candidate('mars.raw', 1), candidate('io.raw', 6)],
      ['mars.raw', 'io.raw'],
      LOAD,
      RELEASE
    )

    expect(decision.request).toEqual(['moon.raw'])
    expect(decision.release).toEqual(['mars.raw'])
  })
})
