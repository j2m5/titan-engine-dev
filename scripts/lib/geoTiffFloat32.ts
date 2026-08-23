import { decodeGeoTiffStrips, readGeoTiffHeader } from './geoTiffIfd'

/**
 * Минимальный читатель несжатых float32 GeoTIFF (strip-based, classic TIFF,
 * SampleFormat=3) — так раздают DEM внешних спутников (Энцелад, Schenk 2024:
 * 8049×4025, RowsPerStrip=1, единицы километры). Сестра `geoTiffInt16.ts`,
 * разбор IFD/GDAL-тегов общий (`geoTiffIfd.ts`).
 *
 * Sharp этот файл читает верно, но его путь ресемплит ДО подмены NODATA, а
 * сентинел здесь −3.4e38 — lanczos размазал бы его по соседям; поэтому
 * float-DEM идёт своим ридером, как и int16.
 *
 * `nodata` округляется до float32 (`Math.fround`): тег GDAL_NODATA хранит
 * десятичную запись double, а сэмплы читаются как float32 — без округления
 * сравнение на равенство не сходилось бы.
 */

export type GeoTiffFloat32 = {
  width: number
  height: number
  /** Значения сэмплов, row-major, строка 0 — первая строка файла (без применения scale/offset). */
  data: Float32Array
  /** Множитель сэмпл→метры из GDAL_METADATA (тег SCALE), по умолчанию 1 если тега/пункта нет. */
  scale: number
  /** Слагаемое сэмпл×scale→метры из GDAL_METADATA (тег OFFSET), по умолчанию 0 если тега/пункта нет. */
  offset: number
  /** Сентинел отсутствующих данных из GDAL_NODATA, округлённый до float32; undefined если тега нет. */
  nodata: number | undefined
}

export function readGeoTiffFloat32(buffer: Buffer): GeoTiffFloat32 {
  const header = readGeoTiffHeader(buffer)

  if (header.bitsPerSample !== 32) {
    throw new Error(`GeoTIFF: BitsPerSample=${header.bitsPerSample} не поддержан (ожидался 32)`)
  }

  if (header.sampleFormat !== 3) {
    throw new Error(`GeoTIFF: SampleFormat=${header.sampleFormat ?? 'отсутствует'} не поддержан (ожидался 3 — IEEE float)`)
  }

  const data = new Float32Array(header.width * header.height)

  decodeGeoTiffStrips(buffer, header, 4, data, offset =>
    header.le ? buffer.readFloatLE(offset) : buffer.readFloatBE(offset)
  )

  return {
    width: header.width,
    height: header.height,
    data,
    scale: header.scale,
    offset: header.offset,
    nodata: header.nodata === undefined ? undefined : Math.fround(header.nodata)
  }
}
