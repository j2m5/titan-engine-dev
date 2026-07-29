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
 *
 * `colorSpace` — единственное поле, которое нельзя присваивать безусловно.
 * Часть загрузчиков three выставляет его сама: `CubeTextureLoader` сразу
 * после создания `CubeTexture` ставит `SRGBColorSpace` (так и задокументировано
 * в классе). Если строка ресурса не задаёт `colorSpace` явно, безусловное
 * `params.colorSpace ?? ''` затирало это значение на `NoColorSpace` — sRGB-байты
 * переставали декодироваться при семплинге, а `WebGLBackground` заодно включал
 * тоунмаппинг фона, которого раньше не было (см. `getTransfer(colorSpace) !== SRGBTransfer`
 * в `WebGLBackground.js`). Отсюда посеризация млечного пути на скайбоксе.
 * Поэтому поле трогается, только когда данные ресурса действительно его
 * задают, — и это намеренно проверяется через `!== undefined`, а не через
 * truthy-проверку: пустая строка `colorSpace: ''` в данных — валидное явное
 * значение `NoColorSpace`, а не «поле отсутствует».
 */
export function applyTextureParameters(
  texture: Texture,
  request: TextureRequest,
  renderer: WebGLRenderer
): void {
  const { params } = request

  texture.name = request.name
  if (params.colorSpace !== undefined) texture.colorSpace = params.colorSpace

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
