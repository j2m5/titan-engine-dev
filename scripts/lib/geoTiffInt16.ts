/**
 * Минимальный читатель несжатых signed-int16 GeoTIFF (strip-based, classic
 * TIFF) — формат, в котором USGS Astrogeology раздаёт DEM планет (Меркурий/
 * Венера/Церера: Compression=1, SampleFormat=2, RowsPerStrip=1..N, без
 * тайлов). `sharp`/libvips для этих конкретных файлов путает буфер пикселей
 * (PlanarConfiguration=2 при SamplesPerPixel=1 — вне спеки, но, похоже, ломает
 * буфер-путь чтения; `sharp().stats()` при этом считает верно) — найдено и
 * задокументировано в хендоффе арки. Полного TIFF-парсера не нужно: все
 * известные файлы этого класса — без сжатия, без тайлов, классический TIFF
 * (не BigTIFF).
 *
 * Заодно читает GDAL-теги GDAL_METADATA (42112, XML, SCALE/OFFSET) и
 * GDAL_NODATA (42113, ASCII) — авторитетнее любого текстового описания
 * источника, DN конвертируется в физическую величину как `DN×scale+offset`.
 */

const TYPE_SIZES: Record<number, number> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
  6: 1, // SBYTE
  7: 1, // UNDEFINED
  8: 2, // SSHORT
  9: 4, // SLONG
  10: 8, // SRATIONAL
  11: 4, // FLOAT
  12: 8 // DOUBLE
}

const TAG_IMAGE_WIDTH = 256
const TAG_IMAGE_LENGTH = 257
const TAG_BITS_PER_SAMPLE = 258
const TAG_COMPRESSION = 259
const TAG_STRIP_OFFSETS = 273
const TAG_ROWS_PER_STRIP = 278
const TAG_STRIP_BYTE_COUNTS = 279
const TAG_TILE_WIDTH = 322
const TAG_SAMPLE_FORMAT = 339
const TAG_GDAL_METADATA = 42112
const TAG_GDAL_NODATA = 42113

type IfdEntry = { type: number; count: number; bytes: Buffer }

export type GeoTiffInt16 = {
  width: number
  height: number
  /** Сырые значения DN, row-major, строка 0 — первая строка файла (без применения scale/offset). */
  data: Int16Array
  /** Множитель DN→метры из GDAL_METADATA (тег SCALE), по умолчанию 1 если тега/пункта нет. */
  scale: number
  /** Слагаемое DN×scale→метры из GDAL_METADATA (тег OFFSET), по умолчанию 0 если тега/пункта нет. */
  offset: number
  /** Сентинел отсутствующих данных из GDAL_NODATA (сырой DN), undefined если тега нет. */
  nodata: number | undefined
}

function readIfdEntries(buffer: Buffer, ifdOffset: number, le: boolean): Map<number, IfdEntry> {
  const count = le ? buffer.readUInt16LE(ifdOffset) : buffer.readUInt16BE(ifdOffset)
  const entries = new Map<number, IfdEntry>()

  for (let i = 0; i < count; i++) {
    const entryOffset = ifdOffset + 2 + i * 12
    const tag = le ? buffer.readUInt16LE(entryOffset) : buffer.readUInt16BE(entryOffset)
    const type = le ? buffer.readUInt16LE(entryOffset + 2) : buffer.readUInt16BE(entryOffset + 2)
    const valueCount = le ? buffer.readUInt32LE(entryOffset + 4) : buffer.readUInt32BE(entryOffset + 4)
    const typeSize = TYPE_SIZES[type]

    if (typeSize === undefined) {
      // Незнакомый TIFF-тип поля — пропускаем тег, он нам не нужен (не входит в TAG_* выше).
      continue
    }

    const totalBytes = valueCount * typeSize
    const valueFieldOffset = entryOffset + 8
    // Значение лежит прямо в 4-байтном поле (левым краем), если помещается; иначе поле хранит смещение в файле.
    const dataOffset =
      totalBytes <= 4 ? valueFieldOffset : le ? buffer.readUInt32LE(valueFieldOffset) : buffer.readUInt32BE(valueFieldOffset)

    entries.set(tag, { type, count: valueCount, bytes: buffer.subarray(dataOffset, dataOffset + totalBytes) })
  }

  return entries
}

function readNumbers(entry: IfdEntry, le: boolean): number[] {
  const out: number[] = []

  for (let i = 0; i < entry.count; i++) {
    if (entry.type === 3) out.push(le ? entry.bytes.readUInt16LE(i * 2) : entry.bytes.readUInt16BE(i * 2))
    else if (entry.type === 4) out.push(le ? entry.bytes.readUInt32LE(i * 4) : entry.bytes.readUInt32BE(i * 4))
    else throw new Error(`GeoTIFF: ожидался числовой тег SHORT/LONG, получен type=${entry.type}`)
  }

  return out
}

function readAscii(entry: IfdEntry): string {
  // ASCII-поле TIFF NUL-терминировано, count включает завершающий байт.
  const nulIndex = entry.bytes.indexOf(0)

  return entry.bytes.toString('latin1', 0, nulIndex === -1 ? entry.bytes.length : nulIndex)
}

/** Вытаскивает числовой параметр `<Item name="NAME" ...>ЧИСЛО</Item>` из GDAL_METADATA XML. */
function extractGdalItem(xml: string, name: string): number | undefined {
  const match = new RegExp(`<Item\\s+name="${name}"[^>]*>([^<]+)</Item>`).exec(xml)

  if (!match) return undefined

  const value = Number(match[1])

  return Number.isFinite(value) ? value : undefined
}

export function readGeoTiffInt16(buffer: Buffer): GeoTiffInt16 {
  const byteOrder = buffer.toString('ascii', 0, 2)

  if (byteOrder !== 'II' && byteOrder !== 'MM') {
    throw new Error(`GeoTIFF: неверная сигнатура порядка байт «${byteOrder}» (ожидался II или MM)`)
  }

  const le = byteOrder === 'II'
  const magic = le ? buffer.readUInt16LE(2) : buffer.readUInt16BE(2)

  if (magic !== 42) {
    throw new Error(`GeoTIFF: magic=${magic} не поддержан (ожидался classic TIFF 42; BigTIFF не поддержан)`)
  }

  const ifdOffset = le ? buffer.readUInt32LE(4) : buffer.readUInt32BE(4)
  const entries = readIfdEntries(buffer, ifdOffset, le)

  const requireEntry = (tag: number, name: string): IfdEntry => {
    const entry = entries.get(tag)

    if (!entry) throw new Error(`GeoTIFF: обязательный тег ${name} (${tag}) отсутствует`)

    return entry
  }

  if (entries.has(TAG_TILE_WIDTH)) {
    throw new Error('GeoTIFF: тайловый формат не поддержан (найден тег TileWidth) — ожидался strip-based')
  }

  const width = readNumbers(requireEntry(TAG_IMAGE_WIDTH, 'ImageWidth'), le)[0]
  const height = readNumbers(requireEntry(TAG_IMAGE_LENGTH, 'ImageLength'), le)[0]
  const bitsPerSample = readNumbers(requireEntry(TAG_BITS_PER_SAMPLE, 'BitsPerSample'), le)[0]

  if (bitsPerSample !== 16) {
    throw new Error(`GeoTIFF: BitsPerSample=${bitsPerSample} не поддержан (ожидался 16)`)
  }

  const compression = readNumbers(requireEntry(TAG_COMPRESSION, 'Compression'), le)[0]

  if (compression !== 1) {
    throw new Error(`GeoTIFF: Compression=${compression} не поддержан (ожидался 1 — без сжатия)`)
  }

  const sampleFormatEntry = entries.get(TAG_SAMPLE_FORMAT)
  const sampleFormat = sampleFormatEntry ? readNumbers(sampleFormatEntry, le)[0] : undefined

  if (sampleFormat !== 2) {
    throw new Error(`GeoTIFF: SampleFormat=${sampleFormat ?? 'отсутствует'} не поддержан (ожидался 2 — signed int16)`)
  }

  const rowsPerStripEntry = entries.get(TAG_ROWS_PER_STRIP)
  const rowsPerStrip = rowsPerStripEntry ? readNumbers(rowsPerStripEntry, le)[0] : height

  const stripOffsets = readNumbers(requireEntry(TAG_STRIP_OFFSETS, 'StripOffsets'), le)
  const stripByteCounts = readNumbers(requireEntry(TAG_STRIP_BYTE_COUNTS, 'StripByteCounts'), le)

  if (stripOffsets.length !== stripByteCounts.length) {
    throw new Error(
      `GeoTIFF: число страйпов не сходится (StripOffsets=${stripOffsets.length}, StripByteCounts=${stripByteCounts.length})`
    )
  }

  const data = new Int16Array(width * height)

  for (let strip = 0; strip < stripOffsets.length; strip++) {
    const rowStart = strip * rowsPerStrip
    const rowsInStrip = Math.min(rowsPerStrip, height - rowStart)
    const expectedBytes = rowsInStrip * width * 2

    if (stripByteCounts[strip] !== expectedBytes) {
      throw new Error(
        `GeoTIFF: страйп ${strip} — размер не сходится (ожидалось ${expectedBytes} байт при отсутствии сжатия, получено ${stripByteCounts[strip]})`
      )
    }

    const stripOffset = stripOffsets[strip]

    for (let r = 0; r < rowsInStrip; r++) {
      const rowOffset = stripOffset + r * width * 2
      const destRow = (rowStart + r) * width

      for (let x = 0; x < width; x++) {
        data[destRow + x] = le ? buffer.readInt16LE(rowOffset + x * 2) : buffer.readInt16BE(rowOffset + x * 2)
      }
    }
  }

  const gdalMetadataEntry = entries.get(TAG_GDAL_METADATA)
  const gdalMetadataText = gdalMetadataEntry ? readAscii(gdalMetadataEntry) : undefined
  const scale = (gdalMetadataText !== undefined ? extractGdalItem(gdalMetadataText, 'SCALE') : undefined) ?? 1
  const offset = (gdalMetadataText !== undefined ? extractGdalItem(gdalMetadataText, 'OFFSET') : undefined) ?? 0

  const gdalNodataEntry = entries.get(TAG_GDAL_NODATA)
  const nodataText = gdalNodataEntry ? readAscii(gdalNodataEntry) : undefined
  const nodata = nodataText !== undefined ? Number(nodataText) : undefined

  if (nodataText !== undefined && !Number.isFinite(nodata)) {
    throw new Error(`GeoTIFF: GDAL_NODATA не число: «${nodataText}»`)
  }

  return { width, height, data, scale, offset, nodata }
}
