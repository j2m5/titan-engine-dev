import { describe, expect, it } from 'vitest'
import { readGeoTiffFloat32 } from '../../scripts/lib/geoTiffFloat32'

/**
 * Собирает минимальный classic TIFF (strip-based, uncompressed) вручную,
 * байт в байт — тем же форматом, что и реальный DEM Энцелада (Schenk 2024):
 * SampleFormat=3, BitsPerSample=32, RowsPerStrip=1..N. Тестовый хелпер.
 */
function buildFloatTiff(opts: {
  le: boolean
  rows: number[][]
  rowsPerStrip?: number
  bitsPerSample?: number
  sampleFormat?: number | 'absent'
  gdalMetadata?: string
  gdalNodata?: string
}): Buffer {
  const { le, rows } = opts
  const height = rows.length
  const width = rows[0].length
  const rowsPerStrip = opts.rowsPerStrip ?? height
  const sampleBytes = 4
  const numStrips = Math.ceil(height / rowsPerStrip)

  const w16 = (buf: Buffer, v: number, o: number): void => {
    if (le) buf.writeUInt16LE(v, o)
    else buf.writeUInt16BE(v, o)
  }
  const w32 = (buf: Buffer, v: number, o: number): void => {
    if (le) buf.writeUInt32LE(v, o)
    else buf.writeUInt32BE(v, o)
  }
  const wf32 = (buf: Buffer, v: number, o: number): void => {
    if (le) buf.writeFloatLE(v, o)
    else buf.writeFloatBE(v, o)
  }

  const stripBuffers: Buffer[] = []

  for (let s = 0; s < numStrips; s++) {
    const rowStart = s * rowsPerStrip
    const rowsInStrip = Math.min(rowsPerStrip, height - rowStart)
    const buf = Buffer.alloc(rowsInStrip * width * sampleBytes)

    for (let r = 0; r < rowsInStrip; r++) {
      for (let x = 0; x < width; x++) wf32(buf, rows[rowStart + r][x], (r * width + x) * sampleBytes)
    }
    stripBuffers.push(buf)
  }

  type Field = { tag: number; type: 3 | 4 | 2; values?: number[]; text?: string }
  const fields: Field[] = [
    { tag: 256, type: 3, values: [width] },
    { tag: 257, type: 3, values: [height] },
    { tag: 258, type: 3, values: [opts.bitsPerSample ?? 32] },
    { tag: 259, type: 3, values: [1] },
    { tag: 273, type: 4, values: stripBuffers.map(() => 0) }, // StripOffsets — патчится ниже
    { tag: 278, type: 3, values: [rowsPerStrip] },
    { tag: 279, type: 4, values: stripBuffers.map(b => b.length) }
  ]

  const sampleFormat = opts.sampleFormat ?? 3

  if (sampleFormat !== 'absent') fields.push({ tag: 339, type: 3, values: [sampleFormat] })
  if (opts.gdalMetadata !== undefined) fields.push({ tag: 42112, type: 2, text: opts.gdalMetadata })
  if (opts.gdalNodata !== undefined) fields.push({ tag: 42113, type: 2, text: opts.gdalNodata })

  fields.sort((a, b) => a.tag - b.tag)

  const entriesStart = 10
  const nextIfdOffsetPos = entriesStart + fields.length * 12
  let cursor = nextIfdOffsetPos + 4

  const externalOffsets = new Map<number, number>()

  fields.forEach((f, i) => {
    const totalBytes = f.type === 2 ? Buffer.byteLength(f.text!, 'latin1') + 1 : f.values!.length * (f.type === 3 ? 2 : 4)

    if (totalBytes > 4) {
      externalOffsets.set(i, cursor)
      cursor += totalBytes
    }
  })

  // StripOffsets известны только после того, как определено начало пиксельных данных.
  const stripOffsetsValues: number[] = []

  for (const buf of stripBuffers) {
    stripOffsetsValues.push(cursor)
    cursor += buf.length
  }
  fields[fields.findIndex(f => f.tag === 273)].values = stripOffsetsValues

  const out = Buffer.alloc(cursor)

  out.write(le ? 'II' : 'MM', 0, 'ascii')
  w16(out, 42, 2)
  w32(out, 8, 4)
  w16(out, fields.length, 8)

  fields.forEach((f, i) => {
    const entryOff = entriesStart + i * 12

    w16(out, f.tag, entryOff)
    w16(out, f.type, entryOff + 2)
    w32(out, f.type === 2 ? Buffer.byteLength(f.text!, 'latin1') + 1 : f.values!.length, entryOff + 4)

    const valueFieldOff = entryOff + 8
    const external = externalOffsets.get(i)

    if (external !== undefined) {
      w32(out, external, valueFieldOff)

      if (f.type === 2) {
        out.write(f.text!, external, 'latin1')
        out.writeUInt8(0, external + Buffer.byteLength(f.text!, 'latin1'))
      } else {
        f.values!.forEach((v, vi) => {
          if (f.type === 3) w16(out, v, external + vi * 2)
          else w32(out, v, external + vi * 4)
        })
      }
    } else if (f.type === 2) {
      out.write(f.text!, valueFieldOff, 'latin1')
    } else if (f.type === 3) {
      // SHORT инлайн — левый край 4-байтного поля, независимо от byte order.
      w16(out, f.values![0], valueFieldOff)
    } else {
      w32(out, f.values![0], valueFieldOff)
    }
  })

  w32(out, 0, nextIfdOffsetPos)
  stripBuffers.forEach((buf, i) => buf.copy(out, stripOffsetsValues[i]))

  return out
}

describe('readGeoTiffFloat32: strip-based float32 GeoTIFF', () => {
  it('LE, один страйп — значения совпадают, scale/offset/nodata дефолтные', () => {
    const tiff = buildFloatTiff({ le: true, rows: [[-2.675, 2.278], [0.5, -0.25]] })
    const result = readGeoTiffFloat32(tiff)

    expect(result.width).toBe(2)
    expect(result.height).toBe(2)
    expect(Array.from(result.data)).toEqual([Math.fround(-2.675), Math.fround(2.278), 0.5, -0.25])
    expect(result.scale).toBe(1)
    expect(result.offset).toBe(0)
    expect(result.nodata).toBeUndefined()
  })

  it('BE, несколько страйпов (rowsPerStrip=1) — строки не перепутаны', () => {
    const rows = [
      [1, -1],
      [0, 2],
      [-3, 4]
    ]
    const tiff = buildFloatTiff({ le: false, rows, rowsPerStrip: 1 })
    const result = readGeoTiffFloat32(tiff)

    expect(result.height).toBe(3)
    expect(Array.from(result.data)).toEqual([1, -1, 0, 2, -3, 4])
  })

  it('GDAL_NODATA −3.4e38 округляется до float32 и сходится с сэмплом', () => {
    const nodataText = '-3.40282265508890445e+38'
    const tiff = buildFloatTiff({ le: true, rows: [[Number(nodataText), 1.5]], gdalNodata: nodataText })
    const result = readGeoTiffFloat32(tiff)

    expect(result.nodata).toBeDefined()
    expect(result.data[0]).toBe(result.nodata)
    expect(result.data[1]).toBe(1.5)
  })

  it('GDAL_METADATA — SCALE/OFFSET детектятся из тегов файла', () => {
    const gdalMetadata =
      '<GDALMetadata>\n  <Item name="OFFSET" sample="0" role="offset">300</Item>\n  <Item name="SCALE" sample="0" role="scale">1000</Item>\n</GDALMetadata>\n'
    const tiff = buildFloatTiff({ le: true, rows: [[1, 2]], gdalMetadata })
    const result = readGeoTiffFloat32(tiff)

    expect(result.scale).toBe(1000)
    expect(result.offset).toBe(300)
  })

  it('int16-файл (SampleFormat=2, 16 бит) — понятная ошибка', () => {
    const tiff = buildFloatTiff({ le: true, rows: [[1, 2]], sampleFormat: 2, bitsPerSample: 16 })

    expect(() => readGeoTiffFloat32(tiff)).toThrow(/BitsPerSample=16/)
  })

  it('SampleFormat отсутствует — понятная ошибка', () => {
    const tiff = buildFloatTiff({ le: true, rows: [[1, 2]], sampleFormat: 'absent' })

    expect(() => readGeoTiffFloat32(tiff)).toThrow(/SampleFormat/)
  })
})
