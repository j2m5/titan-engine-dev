import type { Texture, WebGLRenderer } from 'three'
import type { TextureRequest } from '@/core/textures/types'

/** Значение анизотропии, когда в данных ресурса её нет. */
const DEFAULT_ANISOTROPY: number = 8

/**
 * Единственное место, где на текстуру выставляются параметры three.
 *
 * До этой арки параметры применялись в четырёх менеджерах вразнобой: везде
 * дублировался `colorSpace`, анизотропия была захардкожена восьмёркой, а
 * остальные семь полей `ResourceParameters` не применялись нигде.
 *
 * Анизотропия зажимается по возможностям устройства: запросить больше, чем
 * умеет GPU, — тихая потеря качества там, где ждёшь обратного.
 */
export function applyTextureParameters(
  texture: Texture,
  request: TextureRequest,
  renderer: WebGLRenderer
): void {
  const { params } = request

  texture.name = request.name
  texture.colorSpace = params.colorSpace ?? ''

  if (params.mapping !== undefined) texture.mapping = params.mapping
  if (params.wrapS !== undefined) texture.wrapS = params.wrapS
  if (params.wrapT !== undefined) texture.wrapT = params.wrapT
  if (params.magFilter !== undefined) texture.magFilter = params.magFilter
  if (params.minFilter !== undefined) texture.minFilter = params.minFilter
  if (params.format !== undefined) texture.format = params.format
  if (params.type !== undefined) texture.type = params.type

  texture.anisotropy = Math.min(params.anisotropy ?? DEFAULT_ANISOTROPY, renderer.capabilities.getMaxAnisotropy())

  texture.needsUpdate = true
}
