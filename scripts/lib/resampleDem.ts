import sharp from 'sharp'

export type ResampledDem = {
  width: number
  height: number
  data: Float32Array
}

/**
 * Чтение DEM (GeoTIFF/PNG) и ресемпл в целевые размеры, выход — float-высоты
 * одного канала. Float на выходе всегда: исходники разной глубины (float
 * GeoTIFF у MOLA, 16-бит у LOLA) сводятся к одному типу до нормировки.
 * lanczos3 — как штатный фильтр качества sharp; limitInputPixels снят —
 * исходные DEM больше дефолтного предела.
 */
export async function resampleDem(inputPath: string, width: number, height: number): Promise<ResampledDem> {
  // Сэмплы DEM — высоты: цветокоррекция по ICC не должна менять их значения.
  const source = sharp(inputPath, { limitInputPixels: false, ignoreIcc: true })
  const { space } = await source.metadata()
  const { data, info } = await source
    // sRGB по умолчанию сжимает 16-битные значения до 8 бит ещё до raw(float).
    // Сохраняем пространство исходника: первый канал содержит высоты, а не яркость.
    .toColourspace(space)
    .extractChannel(0)
    .resize(width, height, { fit: 'fill', kernel: 'lanczos3' })
    .raw({ depth: 'float' })
    .toBuffer({ resolveWithObject: true })

  return {
    width: info.width,
    height: info.height,
    data: new Float32Array(data.buffer, data.byteOffset, info.width * info.height)
  }
}
