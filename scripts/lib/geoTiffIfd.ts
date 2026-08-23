/**
 * Общая часть минимальных читателей несжатых strip-based GeoTIFF (classic
 * TIFF): разбор IFD, обязательные теги геометрии, страйпы и GDAL-теги
 * (`GDAL_METADATA` 42112 — SCALE/OFFSET, `GDAL_NODATA` 42113). Разрядность и
 * SampleFormat проверяет уже конкретный читатель — `geoTiffInt16.ts`
 * (SampleFormat=2, 16 бит) и `geoTiffFloat32.ts` (SampleFormat=3, 32 бита).
 *
 * Полного TIFF-парсера не нужно: все известные файлы этого класса — без
 * сжатия, без тайлов, classic TIFF (не BigTIFF).
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

export type GeoTiffHeader = {
  /** Порядок байт файла: true — little-endian (сигнатура II). */
  le: boolean
  width: number
  height: number
  /** Разрядность одного сэмпла из тега BitsPerSample — проверяет конкретный читатель. */
  bitsPerSample: number
  /** Тег SampleFormat: 2 — signed int, 3 — IEEE float; undefined если тега нет. */
  sampleFormat: number | undefined
  rowsPerStrip: number
  stripOffsets: number[]
  stripByteCounts: number[]
  /** Множитель DN→физическая величина из GDAL_METADATA (SCALE), 1 если тега/пункта нет. */
  scale: number
  /** Слагаемое DN×scale→физическая величина из GDAL_METADATA (OFFSET), 0 если тега/пункта нет. */
  offset: number
  /** Сентинел отсутствующих данных из GDAL_NODATA (в единицах сырых сэмплов), undefined если тега нет. */
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

/** Разбирает заголовок GeoTIFF: геометрия, страйпы, GDAL-теги. Разрядность/формат сэмплов не проверяет. */
export function readGeoTiffHeader(buffer: Buffer): GeoTiffHeader {
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
  const compression = readNumbers(requireEntry(TAG_COMPRESSION, 'Compression'), le)[0]

  if (compression !== 1) {
    throw new Error(`GeoTIFF: Compression=${compression} не поддержан (ожидался 1 — без сжатия)`)
  }

  const sampleFormatEntry = entries.get(TAG_SAMPLE_FORMAT)
  const sampleFormat = sampleFormatEntry ? readNumbers(sampleFormatEntry, le)[0] : undefined

  const rowsPerStripEntry = entries.get(TAG_ROWS_PER_STRIP)
  const rowsPerStrip = rowsPerStripEntry ? readNumbers(rowsPerStripEntry, le)[0] : height

  const stripOffsets = readNumbers(requireEntry(TAG_STRIP_OFFSETS, 'StripOffsets'), le)
  const stripByteCounts = readNumbers(requireEntry(TAG_STRIP_BYTE_COUNTS, 'StripByteCounts'), le)

  if (stripOffsets.length !== stripByteCounts.length) {
    throw new Error(
      `GeoTIFF: число страйпов не сходится (StripOffsets=${stripOffsets.length}, StripByteCounts=${stripByteCounts.length})`
    )
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

  return { le, width, height, bitsPerSample, sampleFormat, rowsPerStrip, stripOffsets, stripByteCounts, scale, offset, nodata }
}

/**
 * Раскладывает пиксельные страйпы в готовый типизованный массив (row-major,
 * строка 0 — первая строка файла). `readSample` читает один сэмпл по
 * байтовому смещению в буфере с учётом порядка байт.
 */
export function decodeGeoTiffStrips(
  buffer: Buffer,
  header: GeoTiffHeader,
  sampleBytes: number,
  data: Int16Array | Float32Array,
  readSample: (offset: number) => number
): void {
  const { width, height, rowsPerStrip, stripOffsets, stripByteCounts } = header

  for (let strip = 0; strip < stripOffsets.length; strip++) {
    const rowStart = strip * rowsPerStrip
    const rowsInStrip = Math.min(rowsPerStrip, height - rowStart)
    const expectedBytes = rowsInStrip * width * sampleBytes

    if (stripByteCounts[strip] !== expectedBytes) {
      throw new Error(
        `GeoTIFF: страйп ${strip} — размер не сходится (ожидалось ${expectedBytes} байт при отсутствии сжатия, получено ${stripByteCounts[strip]})`
      )
    }

    const stripOffset = stripOffsets[strip]

    for (let r = 0; r < rowsInStrip; r++) {
      const rowOffset = stripOffset + r * width * sampleBytes
      const destRow = (rowStart + r) * width

      for (let x = 0; x < width; x++) {
        data[destRow + x] = readSample(rowOffset + x * sampleBytes)
      }
    }
  }
}
