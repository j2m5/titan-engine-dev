import { describe, it, expect } from 'vitest'
import { ClampToEdgeWrapping, NearestFilter, Texture, RepeatWrapping, SRGBColorSpace, NoColorSpace } from 'three'
import type { WebGLRenderer } from 'three'
import { applyTextureParameters } from '@/core/textures/applyTextureParameters'
import type { TextureRequest } from '@/core/textures/types'

function rendererWithMaxAnisotropy(max: number): WebGLRenderer {
  return { capabilities: { getMaxAnisotropy: () => max } } as unknown as WebGLRenderer
}

function request(params: TextureRequest['params'] = {}): TextureRequest {
  return { paths: ['planets/earth.jpg'], name: 'planets/earth.jpg', params, resourceType: 'diffuse' }
}

describe('applyTextureParameters', () => {
  it('выставляет имя и цветовое пространство', () => {
    const texture = new Texture()

    applyTextureParameters(texture, request({ colorSpace: 'srgb' }), rendererWithMaxAnisotropy(16))

    expect(texture.name).toBe('planets/earth.jpg')
    expect(texture.colorSpace).toBe('srgb')
  })

  it('применяет заданные параметры three', () => {
    // Сегодня в данных заполнен только colorSpace, остальные семь полей
    // ResourceParameters не встречаются ни в одной из 124 строк — но схема
    // обязана быть честной, иначе поля так и останутся мёртвыми.
    const texture = new Texture()

    applyTextureParameters(
      texture,
      request({ wrapS: RepeatWrapping, wrapT: ClampToEdgeWrapping, magFilter: NearestFilter }),
      rendererWithMaxAnisotropy(16)
    )

    expect(texture.wrapS).toBe(RepeatWrapping)
    expect(texture.wrapT).toBe(ClampToEdgeWrapping)
    expect(texture.magFilter).toBe(NearestFilter)
  })

  it('зажимает анизотропию по возможностям устройства', () => {
    const texture = new Texture()

    applyTextureParameters(texture, request({ anisotropy: 16 }), rendererWithMaxAnisotropy(4))

    expect(texture.anisotropy).toBe(4)
  })

  it('без анизотропии в данных берёт 8, но всё равно зажимает', () => {
    const texture = new Texture()

    applyTextureParameters(texture, request(), rendererWithMaxAnisotropy(2))

    expect(texture.anisotropy).toBe(2)
  })

  it('не затирает colorSpace, выставленный загрузчиком, когда в запросе его нет', () => {
    // Регрессия: CubeTextureLoader сам ставит SRGBColorSpace сразу после
    // создания CubeTexture. Строки кубических карт в данных не задают
    // colorSpace вовсе, и раньше `params.colorSpace ?? ''` затирало это
    // значение на NoColorSpace, посеризуя млечный путь на скайбоксе.
    const texture = new Texture()
    texture.colorSpace = SRGBColorSpace

    applyTextureParameters(texture, request(), rendererWithMaxAnisotropy(16))

    expect(texture.colorSpace).toBe(SRGBColorSpace)
  })

  it('явный пустой colorSpace в запросе всё равно перекрывает colorSpace загрузчика', () => {
    // Намеренный случай: colorSpace: '' в данных — это явное NoColorSpace,
    // а не «поле отсутствует», и должно побеждать то, что выставил загрузчик.
    const texture = new Texture()
    texture.colorSpace = SRGBColorSpace

    applyTextureParameters(texture, request({ colorSpace: '' }), rendererWithMaxAnisotropy(16))

    expect(texture.colorSpace).toBe(NoColorSpace)
  })
})
