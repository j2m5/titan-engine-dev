import { describe, expect, it } from 'vitest'
import { decideHeightMaps, type HeightMapCandidate } from '@/core/terrain/heightMapGatePolicy'

const LOAD: number = 10
const RELEASE: number = 4

function candidate(path: string, actorPriority: number): HeightMapCandidate {
  return { path, actorPriority }
}

/** Тесты порогов бюджетом не интересуются: карты бесплатны, потолка нет. */
const FREE = (): number => 0
const UNLIMITED: number = Number.POSITIVE_INFINITY

describe('decideHeightMaps: политика гейта карт высот', () => {
  it('тело выше верхнего порога запрашивается', () => {
    const decision = decideHeightMaps([candidate('moon.raw', 12)], [], LOAD, RELEASE, FREE, UNLIMITED)

    expect(decision.request).toEqual(['moon.raw'])
    expect(decision.release).toEqual([])
  })

  it('ровно на верхнем пороге запрашивается — граница включающая', () => {
    expect(decideHeightMaps([candidate('moon.raw', LOAD)], [], LOAD, RELEASE, FREE, UNLIMITED).request).toEqual(['moon.raw'])
  })

  it('между порогами состояние не меняется: не грузится, если не держали', () => {
    const decision = decideHeightMaps([candidate('moon.raw', 6)], [], LOAD, RELEASE, FREE, UNLIMITED)

    expect(decision.request).toEqual([])
    expect(decision.release).toEqual([])
  })

  it('между порогами состояние не меняется: не отпускается, если держали (гистерезис)', () => {
    const decision = decideHeightMaps([candidate('moon.raw', 6)], ['moon.raw'], LOAD, RELEASE, FREE, UNLIMITED)

    expect(decision.request).toEqual([])
    expect(decision.release).toEqual([])
  })

  it('ниже нижнего порога удерживаемая карта освобождается', () => {
    const decision = decideHeightMaps([candidate('moon.raw', 1)], ['moon.raw'], LOAD, RELEASE, FREE, UNLIMITED)

    expect(decision.request).toEqual([])
    expect(decision.release).toEqual(['moon.raw'])
  })

  it('ровно на нижнем пороге не освобождается — граница включающая', () => {
    expect(decideHeightMaps([candidate('moon.raw', RELEASE)], ['moon.raw'], LOAD, RELEASE, FREE, UNLIMITED).release).toEqual([])
  })

  it('уже удерживаемая карта повторно не запрашивается', () => {
    const decision = decideHeightMaps([candidate('moon.raw', 12)], ['moon.raw'], LOAD, RELEASE, FREE, UNLIMITED)

    expect(decision.request).toEqual([])
  })

  it('удерживаемая карта тела, пропавшего из наблюдения, освобождается как сирота', () => {
    const decision = decideHeightMaps([], ['moon.raw'], LOAD, RELEASE, FREE, UNLIMITED)

    expect(decision.release).toEqual(['moon.raw'])
  })

  it('дубль пути берёт максимальный приоритет владельцев', () => {
    const decision = decideHeightMaps([candidate('moon.raw', 1), candidate('moon.raw', 12)], [], LOAD, RELEASE, FREE, UNLIMITED)

    expect(decision.request).toEqual(['moon.raw'])
  })

  it('несколько тел разводятся независимо', () => {
    const decision = decideHeightMaps(
      [candidate('moon.raw', 12), candidate('mars.raw', 1), candidate('io.raw', 6)],
      ['mars.raw', 'io.raw'],
      LOAD,
      RELEASE,
      FREE,
      UNLIMITED
    )

    expect(decision.request).toEqual(['moon.raw'])
    expect(decision.release).toEqual(['mars.raw'])
  })
})

/**
 * Бюджет резидентных карт высот (ревью 2026-08-20, находка №7). До него
 * политика запрашивала ВСЁ, что выше верхнего порога, без потолка: реестр рос
 * ровно настолько, насколько тел окажется рядом. У стримера текстур бюджет
 * есть с самой первой версии (`decideStreaming`), у карт высот — не было, хотя
 * это тот же дефицитный ресурс, только не видеопамять, а JS-heap: одна карта
 * 8192×4096 — 64 МиБ, а жадная загрузка сценария стоила 788 МиБ.
 */
describe('decideHeightMaps: бюджет резидентных карт', () => {
  const MiB: number = 1024 * 1024
  const sizes = (bytes: Record<string, number>) => (path: string): number | undefined => bytes[path]

  it('набор режется по приоритету: что не влезло — не запрашивается', () => {
    const decision = decideHeightMaps(
      [candidate('a.raw', 30), candidate('b.raw', 20), candidate('c.raw', 15)],
      [],
      LOAD,
      RELEASE,
      sizes({ 'a.raw': 40 * MiB, 'b.raw': 40 * MiB, 'c.raw': 40 * MiB }),
      100 * MiB
    )

    expect(decision.request).toEqual(['a.raw', 'b.raw'])
  })

  it('удерживаемая карта, не влезшая в бюджет, освобождается — даже будучи выше нижнего порога', () => {
    // c.raw держится и по дистанции отпускать её рано, но место занято двумя
    // более приоритетными: бюджет — потолок, а не пожелание
    const decision = decideHeightMaps(
      [candidate('a.raw', 30), candidate('b.raw', 20), candidate('c.raw', 15)],
      ['c.raw'],
      LOAD,
      RELEASE,
      sizes({ 'a.raw': 40 * MiB, 'b.raw': 40 * MiB, 'c.raw': 40 * MiB }),
      100 * MiB
    )

    expect(decision.release).toEqual(['c.raw'])
  })

  it('самая приоритетная карта резидентна ВСЕГДА — даже одна дороже всего бюджета', () => {
    // Пол: иначе тело, к которому подлетели, осталось бы без рельефа именно
    // потому, что его карта самая большая. Тот же приём, что у стримера
    // (floorPaths в decideStreaming).
    const decision = decideHeightMaps(
      [candidate('huge.raw', 30)],
      [],
      LOAD,
      RELEASE,
      sizes({ 'huge.raw': 512 * MiB },),
      64 * MiB
    )

    expect(decision.request).toEqual(['huge.raw'])
  })

  it('неизмеренная карта считается по максимуму — мимо бюджета не проскакивает', () => {
    // Размер известен только после загрузки; до неё путь стоит столько же,
    // сколько самая большая реальная карта (8192×4096).
    const decision = decideHeightMaps(
      [candidate('a.raw', 30), candidate('b.raw', 20)],
      [],
      LOAD,
      RELEASE,
      () => undefined,
      64 * MiB
    )

    expect(decision.request).toEqual(['a.raw'])
  })

  it('бюджет не воскрешает то, что ниже порогов: сирота и дальнее тело отпускаются как прежде', () => {
    const decision = decideHeightMaps(
      [candidate('far.raw', 1)],
      ['far.raw', 'orphan.raw'],
      LOAD,
      RELEASE,
      FREE,
      UNLIMITED
    )

    expect(decision.request).toEqual([])
    expect(decision.release.sort()).toEqual(['far.raw', 'orphan.raw'])
  })
})
