/**
 * Реестр токенов приложения
 * Важно: все классы импортируются через `import type`
 */
import { token } from '@/core/framework/container/Container'
import type { Engine } from '@/core/Engine'
import type { Application } from '@/Application'
import type { CubeMapTextureManager } from '@/core/services/CubeMapTextureManager'
import type { TextureManager } from '@/core/services/TextureManager'
import type { ImageBitmapManager } from '@/core/services/ImageBitmapManager'
import type { SceneManager } from '@/core/services/SceneManager'
import type { MarkerManager } from '@/core/services/MarkerManager'
import type { ResourceObserver } from '@/core/services/ResourceObserver'
import type { SceneObserver } from '@/core/services/SceneObserver'

export const Tokens = {
  Engine: token<Engine>('Engine'),
  Application: token<Application>('Application'),
  CubeMapTextureManager: token<CubeMapTextureManager>('CubeMapTextureManager'),
  TextureManager: token<TextureManager>('TextureManager'),
  ImageBitmapManager: token<ImageBitmapManager>('ImageBitmapManager'),
  SceneManager: token<SceneManager>('SceneManager'),
  MarkerManager: token<MarkerManager>('MarkerManager'),
  ResourceObserver: token<ResourceObserver>('ResourceObserver'),
  SceneObserver: token<SceneObserver>('SceneObserver')
} as const
