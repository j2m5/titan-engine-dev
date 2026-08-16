import { describe, expect, it } from 'vitest'
import { readGeoTiffInt16 } from '../../scripts/lib/geoTiffInt16'

// Байт-order-агностичные записи — обёртки вместо тернарников-выражений (eslint no-unused-expressions).
function w16(buf: Buffer, value: number, offset: number, le: boolean): void {
  if (le) buf.writeUInt16LE(value, offset)
  else buf.writeUInt16BE(value, offset)
}
function w32(buf: Buffer, value: number, offset: number, le: boolean): void {
  if (le) buf.writeUInt32LE(value, offset)
  else buf.writeUInt32BE(value, offset)
}
function wi16(buf: Buffer, value: number, offset: number, le: boolean): void {
  if (le) buf.writeInt16LE(value, offset)
  else buf.writeInt16BE(value, offset)
}

/**
 * Собирает минимальный classic TIFF (strip-based, uncompressed signed int16)
 * вручную, байт в байт — тем же форматом, что и реальные файлы USGS
 * Astrogeology (см. докблок geoTiffInt16.ts). Тестовый хелпер, не часть
 * продакшен-кода.
 */
function buildTiff(opts: {
  le: boolean
  rows: number[][]
  rowsPerStrip?: number
  compression?: number
  bitsPerSample?: number
  sampleFormat?: number | 'absent'
  gdalMetadata?: string
  gdalNodata?: string
  tiled?: boolean
}): Buffer {
  const { le, rows } = opts
  const height = rows.length
  const width = rows[0].length
  const rowsPerStrip = opts.rowsPerStrip ?? height
  const compression = opts.compression ?? 1
  const bitsPerSample = opts.bitsPerSample ?? 16
  const sampleFormat = opts.sampleFormat ?? 2
  const numStrips = Math.ceil(height / rowsPerStrip)

  const stripByteCounts: number[] = []
  const stripBuffers: Buffer[] = []

  for (let s = 0; s < numStrips; s++) {
    const rowStart = s * rowsPerStrip
    const rowsInStrip = Math.min(rowsPerStrip, height - rowStart)
    const buf = Buffer.alloc(rowsInStrip * width * 2)

    for (let r = 0; r < rowsInStrip; r++) {
      for (let x = 0; x < width; x++) {
        const off = (r * width + x) * 2
        const value = rows[rowStart + r][x]

        wi16(buf, value, off, le)
      }
    }
    stripBuffers.push(buf)
    stripByteCounts.push(buf.length)
  }

  type Field = { tag: number; type: 3 | 4 | 2; values?: number[]; text?: string }
  const fields: Field[] = []

  fields.push({ tag: 256, type: 3, values: [width] })
  fields.push({ tag: 257, type: 3, values: [height] })
  fields.push({ tag: 258, type: 3, values: [bitsPerSample] })
  fields.push({ tag: 259, type: 3, values: [compression] })

  if (opts.tiled) {
    fields.push({ tag: 322, type: 3, values: [width] }) // TileWidth — присутствия достаточно, чтобы отвергнуть
    fields.push({ tag: 323, type: 3, values: [height] })
    fields.push({ tag: 324, type: 4, values: [0] })
    fields.push({ tag: 325, type: 4, values: [0] })
  } else {
    fields.push({ tag: 273, type: 4, values: stripByteCounts.map(() => 0) }) // StripOffsets — патчим ниже
    fields.push({ tag: 278, type: 3, values: [rowsPerStrip] })
    fields.push({ tag: 279, type: 4, values: stripByteCounts })
  }

  if (sampleFormat !== 'absent') fields.push({ tag: 339, type: 3, values: [sampleFormat] })
  if (opts.gdalMetadata !== undefined) fields.push({ tag: 42112, type: 2, text: opts.gdalMetadata })
  if (opts.gdalNodata !== undefined) fields.push({ tag: 42113, type: 2, text: opts.gdalNodata })

  fields.sort((a, b) => a.tag - b.tag)

  const n = fields.length
  const ifdStart = 8
  const entriesStart = ifdStart + 2
  const entriesSize = n * 12
  const nextIfdOffsetPos = entriesStart + entriesSize
  let externalCursor = nextIfdOffsetPos + 4

  const externalOffsets = new Map<number, number>() // field index -> external byte offset
  const externalSizes = new Map<number, number>()

  for (let i = 0; i < n; i++) {
    const f = fields[i]
    const totalBytes = f.type === 2 ? Buffer.byteLength(f.text!, 'latin1') + 1 : f.values!.length * (f.type === 3 ? 2 : 4)

    if (totalBytes > 4) {
      externalOffsets.set(i, externalCursor)
      externalSizes.set(i, totalBytes)
      externalCursor += totalBytes
    }
  }

  // StripOffsets значения известны только после того, как определено, где начнутся пиксельные страйпы.
  const pixelDataStart = externalCursor
  const stripOffsetsValues: number[] = []
  let cursor = pixelDataStart

  for (const buf of stripBuffers) {
    stripOffsetsValues.push(cursor)
    cursor += buf.length
  }

  const stripOffsetsFieldIndex = fields.findIndex(f => f.tag === 273)

  if (stripOffsetsFieldIndex !== -1) fields[stripOffsetsFieldIndex].values = stripOffsetsValues

  const totalSize = cursor
  const out = Buffer.alloc(totalSize)

  out.write(le ? 'II' : 'MM', 0, 'ascii')
  w16(out, 42, 2, le)
  w32(out, ifdStart, 4, le)

  w16(out, n, ifdStart, le)

  for (let i = 0; i < n; i++) {
    const f = fields[i]
    const entryOff = entriesStart + i * 12

    w16(out, f.tag, entryOff, le)
    w16(out, f.type, entryOff + 2, le)

    const count = f.type === 2 ? Buffer.byteLength(f.text!, 'latin1') + 1 : f.values!.length

    w32(out, count, entryOff + 4, le)

    const valueFieldOff = entryOff + 8
    const external = externalOffsets.get(i)

    if (external !== undefined) {
      w32(out, external, valueFieldOff, le)

      if (f.type === 2) {
        out.write(f.text!, external, 'latin1')
        out.writeUInt8(0, external + Buffer.byteLength(f.text!, 'latin1'))
      } else {
        f.values!.forEach((v, vi) => {
          const off = external + vi * (f.type === 3 ? 2 : 4)

          if (f.type === 3) w16(out, v, off, le)
          else w32(out, v, off, le)
        })
      }
    } else if (f.type === 2) {
      out.write(f.text!, valueFieldOff, 'latin1')
    } else if (f.type === 3) {
      // SHORT инлайн — левый край 4-байтного поля, независимо от byte order.
      w16(out, f.values![0], valueFieldOff, le)
    } else {
      w32(out, f.values![0], valueFieldOff, le)
    }
  }

  w32(out, 0, nextIfdOffsetPos, le)

  for (const buf of stripBuffers) {
    buf.copy(out, stripOffsetsValues[stripBuffers.indexOf(buf)])
  }

  return out
}

describe('readGeoTiffInt16: strip-based signed int16 GeoTIFF', () => {
  it('LE, один страйп — значения совпадают, scale/offset/nodata дефолтные', () => {
    const tiff = buildTiff({ le: true, rows: [[-100, 200], [300, -400]] })
    const result = readGeoTiffInt16(tiff)

    expect(result.width).toBe(2)
    expect(result.height).toBe(2)
    expect(Array.from(result.data)).toEqual([-100, 200, 300, -400])
    expect(result.scale).toBe(1)
    expect(result.offset).toBe(0)
    expect(result.nodata).toBeUndefined()
  })

  it('BE, несколько страйпов (rowsPerStrip=1) — строки не перепутаны', () => {
    const rows = [
      [1000, -1000],
      [0, 32000],
      [-32000, 12345]
    ]
    const tiff = buildTiff({ le: false, rows, rowsPerStrip: 1 })
    const result = readGeoTiffInt16(tiff)

    expect(result.width).toBe(2)
    expect(result.height).toBe(3)
    expect(Array.from(result.data)).toEqual([1000, -1000, 0, 32000, -32000, 12345])
  })

  it('GDAL_METADATA/GDAL_NODATA — SCALE/OFFSET/nodata детектятся из тегов файла', () => {
    const gdalMetadata =
      '<GDALMetadata>\n  <Item name="OFFSET" sample="0" role="offset">300</Item>\n  <Item name="SCALE" sample="0" role="scale">0.5</Item>\n</GDALMetadata>\n'
    const tiff = buildTiff({
      le: true,
      rows: [[5, -32768]],
      gdalMetadata,
      gdalNodata: '-32768'
    })
    const result = readGeoTiffInt16(tiff)

    expect(result.scale).toBe(0.5)
    expect(result.offset).toBe(300)
    expect(result.nodata).toBe(-32768)
    expect(Array.from(result.data)).toEqual([5, -32768])
  })

  it('GDAL_METADATA без SCALE/OFFSET-пунктов — дефолты 1/0', () => {
    const tiff = buildTiff({ le: true, rows: [[1, 2]], gdalMetadata: '<GDALMetadata>\n</GDALMetadata>\n' })
    const result = readGeoTiffInt16(tiff)

    expect(result.scale).toBe(1)
    expect(result.offset).toBe(0)
  })

  it('Compression≠1 — понятная ошибка', () => {
    const tiff = buildTiff({ le: true, rows: [[1, 2]], compression: 5 })

    expect(() => readGeoTiffInt16(tiff)).toThrow(/Compression=5/)
  })

  it('BitsPerSample≠16 — понятная ошибка', () => {
    const tiff = buildTiff({ le: true, rows: [[1, 2]], bitsPerSample: 8 })

    expect(() => readGeoTiffInt16(tiff)).toThrow(/BitsPerSample=8/)
  })

  it('SampleFormat отсутствует или не signed — понятная ошибка', () => {
    const tiffAbsent = buildTiff({ le: true, rows: [[1, 2]], sampleFormat: 'absent' })
    const tiffUnsigned = buildTiff({ le: true, rows: [[1, 2]], sampleFormat: 1 })

    expect(() => readGeoTiffInt16(tiffAbsent)).toThrow(/SampleFormat/)
    expect(() => readGeoTiffInt16(tiffUnsigned)).toThrow(/SampleFormat=1/)
  })

  it('тайловый формат (TileWidth) — понятная ошибка, не поддержан', () => {
    const tiff = buildTiff({ le: true, rows: [[1, 2]], tiled: true })

    expect(() => readGeoTiffInt16(tiff)).toThrow(/тайлов/)
  })
})
