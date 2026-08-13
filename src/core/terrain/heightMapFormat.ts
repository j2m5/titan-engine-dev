export type HeightMapData = {
  width: number
  height: number
  minMeters: number
  maxMeters: number
  data: Uint16Array
}

/**
 * Бинарный формат карты высот (little-endian): magic 'TEHM', версия, размеры,
 * диапазон высот в метрах, тело Uint16 (строка 0 — север, min→0, max→65535).
 *
 * Заголовок в файле, а не поля в БД: у IResource нет metadata-мешка, а факты
 * кодирования файла (размеры, нормировка) — свойство самого файла, как у
 * любого контейнера. Строка ресурса остаётся тривиальной.
 */
export const HEIGHT_MAP_MAGIC = 0x4d484554 // байты 'T','E','H','M' как u32 LE
export const HEIGHT_MAP_VERSION = 1
export const HEIGHT_MAP_HEADER_BYTES = 24

export function parseHeightMap(buffer: ArrayBuffer): HeightMapData {
  if (buffer.byteLength < HEIGHT_MAP_HEADER_BYTES) {
    throw new Error(`Карта высот: файл короче заголовка (${buffer.byteLength} байт)`)
  }

  const view = new DataView(buffer)
  const magic = view.getUint32(0, true)

  if (magic !== HEIGHT_MAP_MAGIC) {
    throw new Error(`Карта высот: неверный magic 0x${magic.toString(16)}`)
  }

  const version = view.getUint32(4, true)

  if (version !== HEIGHT_MAP_VERSION) {
    throw new Error(`Карта высот: неподдерживаемая версия ${version}`)
  }

  const width = view.getUint32(8, true)
  const height = view.getUint32(12, true)
  const minMeters = view.getFloat32(16, true)
  const maxMeters = view.getFloat32(20, true)
  const expectedBytes = HEIGHT_MAP_HEADER_BYTES + width * height * 2

  if (buffer.byteLength !== expectedBytes) {
    throw new Error(`Карта высот: размер тела не сходится (ожидалось ${expectedBytes}, получено ${buffer.byteLength})`)
  }

  // Смещение 24 кратно 2 — Uint16Array-вью валиден. Платформа предполагается
  // little-endian, как всюду в вебе.
  const data = new Uint16Array(buffer, HEIGHT_MAP_HEADER_BYTES, width * height)

  return { width, height, minMeters, maxMeters, data }
}
