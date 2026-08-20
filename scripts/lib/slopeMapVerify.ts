/**
 * Детектор артефакта libwebp: без `exact: true` энкодер обнуляет RGB у
 * текселей с A=0 — а у slope-карт тел с водой A=0 стоит ровно на СУШЕ.
 * Энкодер (`slopeMapEncode`) байт 0 в R/G выдать не может (минимум 1), так
 * что RGB=(0,0,0) под A=0 — однозначный признак битой карты.
 */
export function countZeroedLandTexels(data: Uint8Array, channels: 3 | 4): { land: number; zeroed: number } {
  if (data.length % channels !== 0) {
    throw new Error(`slopeMapVerify: длина ${data.length} не кратна числу каналов ${channels}`)
  }

  if (channels === 3) return { land: 0, zeroed: 0 }

  let land = 0
  let zeroed = 0

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] !== 0) continue

    land++
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0) zeroed++
  }

  return { land, zeroed }
}
