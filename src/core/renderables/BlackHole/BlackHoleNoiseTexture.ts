import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat } from 'three'

/**
 * Общая тайлящаяся noise-текстура аккреционного диска
 *
 * Генерируется на CPU один раз на приложение (lazy) и разделяется всеми
 * дырами: разнообразие между дырами достигается seed-зависимым смещением
 * UV в шейдере (uNoiseOffset), а не отдельными текстурами
 *
 * Каналы: R — базовая турбулентность (fbm, 4 октавы),
 *         G — высокочастотная деталь (fbm с другим зерном и базовым периодом)
 * Текстура периодична по обеим осям (периодический value noise) —
 * обязательное условие бесшовности по азимуту диска
 */
class BlackHoleNoiseTexture {
  private static texture: DataTexture | null = null

  private static readonly SIZE: number = 256

  public static get(): DataTexture {
    if (!this.texture) this.texture = this.generate()

    return this.texture
  }

  public static dispose(): void {
    this.texture?.dispose()
    this.texture = null
  }

  private static generate(): DataTexture {
    const size: number = this.SIZE
    const data: Uint8Array = new Uint8Array(size * size * 4)

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u: number = x / size
        const v: number = y / size

        const base: number = this.fbm(u, v, 8, 4, 17)
        const detail: number = this.fbm(u, v, 16, 3, 53)

        const index: number = (y * size + x) * 4
        data[index] = Math.round(base * 255)
        data[index + 1] = Math.round(detail * 255)
        data[index + 2] = 0
        data[index + 3] = 255
      }
    }

    const texture: DataTexture = new DataTexture(data, size, size, RGBAFormat)
    texture.wrapS = RepeatWrapping
    texture.wrapT = RepeatWrapping
    texture.magFilter = LinearFilter
    texture.minFilter = LinearMipmapLinearFilter
    texture.generateMipmaps = true
    texture.needsUpdate = true
    texture.name = 'BlackHoleDiskNoise'

    return texture
  }

  /** Детерминированный хэш узла решётки */
  private static hash(x: number, y: number, seed: number): number {
    const s: number = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123

    return s - Math.floor(s)
  }

  /** Периодический value noise: решётка замыкается по period в обеих осях */
  private static valueNoise(u: number, v: number, period: number, seed: number): number {
    const px: number = u * period
    const py: number = v * period

    const ix: number = Math.floor(px)
    const iy: number = Math.floor(py)
    const fx: number = px - ix
    const fy: number = py - iy

    const sx: number = fx * fx * (3 - 2 * fx)
    const sy: number = fy * fy * (3 - 2 * fy)

    const wrap = (value: number): number => ((value % period) + period) % period

    const a: number = this.hash(wrap(ix), wrap(iy), seed)
    const b: number = this.hash(wrap(ix + 1), wrap(iy), seed)
    const c: number = this.hash(wrap(ix), wrap(iy + 1), seed)
    const d: number = this.hash(wrap(ix + 1), wrap(iy + 1), seed)

    const ab: number = a + (b - a) * sx
    const cd: number = c + (d - c) * sx

    return ab + (cd - ab) * sy
  }

  /** Тайлящийся fbm: периоды октав кратны базовому — тайлинг сохраняется */
  private static fbm(u: number, v: number, basePeriod: number, octaves: number, seed: number): number {
    let total: number = 0
    let amplitude: number = 1
    let maxValue: number = 0
    let period: number = basePeriod

    for (let i = 0; i < octaves; i++) {
      total += this.valueNoise(u, v, period, seed + i * 101) * amplitude
      maxValue += amplitude
      amplitude *= 0.55
      period *= 2
    }

    return total / maxValue
  }
}

export { BlackHoleNoiseTexture }
