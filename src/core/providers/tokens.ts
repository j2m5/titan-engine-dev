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
import type { SimulationClock } from '@/core/time/SimulationClock'
import type { CameraController } from '@/core/camera/CameraController'
import type { Settings } from '@/core/ports/Settings'
import type { NotificationSink } from '@/core/ports/NotificationSink'
import type { LoadingProgressReporter } from '@/core/ports/LoadingProgressReporter'
import type { MenuController } from '@/core/ports/MenuController'

export const Tokens = {
  Engine: token<Engine>('Engine'),
  Application: token<Application>('Application'),
  CubeMapTextureManager: token<CubeMapTextureManager>('CubeMapTextureManager'),
  TextureManager: token<TextureManager>('TextureManager'),
  ImageBitmapManager: token<ImageBitmapManager>('ImageBitmapManager'),
  SceneManager: token<SceneManager>('SceneManager'),
  MarkerManager: token<MarkerManager>('MarkerManager'),
  ResourceObserver: token<ResourceObserver>('ResourceObserver'),
  SceneObserver: token<SceneObserver>('SceneObserver'),
  SimulationClock: token<SimulationClock>('SimulationClock'),
  CameraController: token<CameraController>('CameraController'),
  Settings: token<Settings>('Settings'),
  NotificationSink: token<NotificationSink>('NotificationSink'),
  LoadingProgressReporter: token<LoadingProgressReporter>('LoadingProgressReporter'),
  MenuController: token<MenuController>('MenuController')
} as const
