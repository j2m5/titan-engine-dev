import type { Texture } from 'three'
import type { ResourceParameters, ResourceType } from '@/core/models/types'

/**
 * Дескриптор загрузки. Строится вызывающим из `IResource` — загрузчик не знает
 * про модельный слой и потому тестируется без ORM.
 */
export interface TextureRequest {
  /** Один путь для обычной текстуры, шесть граней для кубмапы. */
  paths: string[]
  /** Имя в реестре ресурсов. Формирует вызывающий, стратегии его не выводят. */
  name: string
  /** Параметры three, применяемые после загрузки. */
  params: ResourceParameters
  /** Только для диагностики и сообщений об ошибках. */
  resourceType: ResourceType
}

/**
 * Результат загрузки — размеченное объединение по `ok`.
 *
 * Успех и провал обычной текстуры дают `texture` (во втором случае —
 * разделяемую заглушку), поэтому потребителю, которому детали безразличны,
 * достаточно `result.texture`. Единственный случай без текстуры — провал
 * кубмапы: подменять `CubeTexture` нечем. Объединение заставляет разобрать
 * этот случай явно, а не наткнуться на него в рантайме.
 */
export type LoadResult =
  | { ok: true; texture: Texture }
  | { ok: false; texture: Texture; error: Error }
  | { ok: false; texture: null; error: Error }

/** Стратегия загрузки одного семейства форматов. Бросает при сбое. */
export interface TextureLoadStrategy {
  supports(request: TextureRequest): boolean
  load(request: TextureRequest): Promise<Texture>
}
