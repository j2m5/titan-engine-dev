import { CanvasTexture, Texture } from 'three'
import { Colorable } from '@/core/models/types'

export function generateTexture(color: string = '#cccccc'): Texture {
  const size: number = 64
  const canvas: HTMLCanvasElement = document.createElement('canvas')
  canvas.width = canvas.height = size

  const context: CanvasRenderingContext2D = canvas.getContext('2d')!
  context.fillStyle = color
  context.fillRect(0, 0, size, size)

  const texture: CanvasTexture = new CanvasTexture(canvas)
  texture.needsUpdate = true

  return texture
}

export function calculateScatterRGB(color: Colorable, strength: number): Colorable {
  return {
    r: Math.pow(400 / color.r, 4) * strength,
    g: Math.pow(400 / color.g, 4) * strength,
    b: Math.pow(400 / color.b, 4) * strength
  }
}
