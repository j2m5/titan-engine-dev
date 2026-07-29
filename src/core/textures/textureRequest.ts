import type dayjs from 'dayjs'
import type { IResource } from '@/core/models/types'
import type { TextureRequest } from '@/core/textures/types'

/**
 * Мета-данные загруженной текстуры, живущие в `texture.userData.resource`.
 * Их читает `ResourceObserver.releaseUnusedTextures` при выгрузке по истечении
 * срока. Штампует их сам `ResourceObserver`: срок жизни — вопрос политики
 * стриминга, а не загрузки.
 */
export interface ResourceItem {
  actorId: number | null
  type: 'default' | 'cube' | 'bitmap' | 'compressed'
  loadedAt: dayjs.Dayjs
  expiredAt: dayjs.Dayjs
}

/** Запрос на одиночную текстуру: имя совпадает с путём ресурса. */
export function textureRequestFrom(resource: IResource): TextureRequest {
  return {
    paths: [resource.path],
    name: resource.path,
    params: resource,
    resourceType: resource.resourceType
  }
}

/**
 * Имя кубической карты в реестре: каталог первого пути, слэши заменены дефисами
 * (`cubemaps/scene/main/px.jpg` → `cubemaps-scene-main`).
 *
 * Правило перенесено дословно из удалённого `CubeMapTextureManager`. Менять его
 * нельзя: по этому имени работают `getTexture` и `deleteTexture` реестра ресурсов.
 */
export function cubeTextureName(paths: string[]): string {
  return paths[0].replace(/(.*)\/.*?\..*$/, '$1').replace(/\//g, '-')
}

/** Запрос на кубическую карту: шесть граней в порядке, заданном сценарием. */
export function cubeTextureRequest(resources: IResource[]): TextureRequest {
  const paths: string[] = resources.map((resource: IResource): string => resource.path)

  return {
    paths,
    name: cubeTextureName(paths),
    params: resources[0],
    resourceType: 'cube'
  }
}
