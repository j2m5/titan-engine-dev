import { describe, it, expect } from 'vitest'
import { cubeTextureName, cubeTextureRequest, textureRequestFrom } from '@/core/textures/textureRequest'
import type { IResource } from '@/core/models/types'

function resource(path: string, extra: Partial<IResource> = {}): IResource {
  return { id: 1, resourceType: 'diffuse', lifecycle: 'streamable', path, ...extra }
}

const FACES: string[] = ['px', 'nx', 'py', 'ny', 'pz', 'nz'].map((f) => `cubemaps/scene/main/${f}.jpg`)

describe('textureRequest', () => {
  it('имя обычной текстуры — её путь', () => {
    const request = textureRequestFrom(resource('planets/earth.jpg', { colorSpace: 'srgb' }))

    expect(request.name).toBe('planets/earth.jpg')
    expect(request.paths).toEqual(['planets/earth.jpg'])
    expect(request.params.colorSpace).toBe('srgb')
  })

  it('имя кубмапы — каталог первого пути со слэшами в дефисах', () => {
    // Правило дословно перенесено из CubeMapTextureManager: по этому имени
    // работают resourceStorage.getTexture и deleteTexture, менять его нельзя.
    expect(cubeTextureName(FACES)).toBe('cubemaps-scene-main')
  })

  it('запрос кубмапы несёт все шесть граней в исходном порядке', () => {
    const request = cubeTextureRequest(FACES.map((p) => resource(p, { resourceType: 'cube' })))

    expect(request.paths).toEqual(FACES)
    expect(request.name).toBe('cubemaps-scene-main')
    expect(request.resourceType).toBe('cube')
  })
})
