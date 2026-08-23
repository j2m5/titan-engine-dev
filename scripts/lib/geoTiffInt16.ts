import { decodeGeoTiffStrips, readGeoTiffHeader } from './geoTiffIfd'

/**
 * Минимальный читатель несжатых signed-int16 GeoTIFF (strip-based, classic
 * TIFF) — формат, в котором USGS Astrogeology раздаёт DEM планет (Меркурий/
 * Венера/Церера: Compression=1, SampleFormat=2, RowsPerStrip=1..N, без
 * тайлов). `sharp`/libvips для этих конкретных файлов путает буфер пикселей
 * (PlanarConfiguration=2 при SamplesPerPixel=1 — вне спеки, но, похоже, ломает
 * буфер-путь чтения; `sharp().stats()` при этом считает верно) — найдено и
 * задокументировано в хендоффе арки. Разбор IFD и GDAL-тегов (SCALE/OFFSET/
 * NODATA) — общий, в `geoTiffIfd.ts`.
 */

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

export function readGeoTiffInt16(buffer: Buffer): GeoTiffInt16 {
  const header = readGeoTiffHeader(buffer)

  if (header.bitsPerSample !== 16) {
    throw new Error(`GeoTIFF: BitsPerSample=${header.bitsPerSample} не поддержан (ожидался 16)`)
  }

  if (header.sampleFormat !== 2) {
    throw new Error(
      `GeoTIFF: SampleFormat=${header.sampleFormat ?? 'отсутствует'} не поддержан (ожидался 2 — signed int16)`
    )
  }

  const data = new Int16Array(header.width * header.height)

  decodeGeoTiffStrips(buffer, header, 2, data, offset =>
    header.le ? buffer.readInt16LE(offset) : buffer.readInt16BE(offset)
  )

  return { width: header.width, height: header.height, data, scale: header.scale, offset: header.offset, nodata: header.nodata }
}
