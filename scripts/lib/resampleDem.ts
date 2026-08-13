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
  const { data, info } = await sharp(inputPath, { limitInputPixels: false })
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
