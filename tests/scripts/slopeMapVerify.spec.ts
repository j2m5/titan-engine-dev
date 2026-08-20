import { describe, expect, it } from 'vitest'
import { countZeroedLandTexels } from '../../scripts/lib/slopeMapVerify'

describe('countZeroedLandTexels: артефакт libwebp без exact — RGB обнулён под A=0', () => {
  it('4 канала: считает сушу (A=0) и обнулённые тексели среди неё', () => {
    // тексель 0: суша, RGB чистые (128,128,128) — ок
    // тексель 1: суша, RGB=0 — дефект
    // тексель 2: вода (A=255), RGB=0 — НЕ считается (под водой RGB не читается)
    const data = new Uint8Array([128, 128, 128, 0, 0, 0, 0, 0, 0, 0, 0, 255])

    expect(countZeroedLandTexels(data, 4)).toEqual({ land: 2, zeroed: 1 })
  })

  it('3 канала (тело без воды): суши по альфе нет, дефект невозможен', () => {
    const data = new Uint8Array([0, 0, 0, 128, 128, 128])

    expect(countZeroedLandTexels(data, 3)).toEqual({ land: 0, zeroed: 0 })
  })

  it('длина буфера не кратна числу каналов — ошибка, не тихий обрезок', () => {
    expect(() => countZeroedLandTexels(new Uint8Array(5), 4)).toThrow()
  })
})
