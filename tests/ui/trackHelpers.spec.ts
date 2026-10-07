import { describe, it, expect } from 'vitest'
import { hasNextTrack, trackLabel } from '@/ui/components/common/audio/trackHelpers'

describe('trackLabel — подпись трека', () => {
  it('название и исполнитель из метаданных', () => {
    expect(trackLabel({ title: 'a.mp3', src: 's', metadata: { title: 'A Hidden Home', artist: 'Pedro', album: 'SC' } })).toBe(
      'A Hidden Home - Pedro'
    )
  })

  it('метаданные не разобрались — только название, без «- undefined»', () => {
    expect(trackLabel({ title: 'StarMap.ogg', src: 's' })).toBe('StarMap.ogg')
  })

  it('пустой исполнитель — тоже только название', () => {
    expect(trackLabel({ title: 't', src: 's', metadata: { title: 'T', artist: '', album: '' } })).toBe('T')
  })
})

describe('hasNextTrack — конец плейлиста', () => {
  it('есть следующий, пока не последний', () => {
    expect(hasNextTrack(0, 2)).toBe(true)
  })

  it('на последнем треке следующего нет: плеер останавливается, а не уходит за конец', () => {
    expect(hasNextTrack(1, 2)).toBe(false)
  })

  it('пустой плейлист и «трек не выбран» (-1) — следующего нет только у пустого', () => {
    expect(hasNextTrack(-1, 0)).toBe(false)
    expect(hasNextTrack(-1, 2)).toBe(true)
  })
})
