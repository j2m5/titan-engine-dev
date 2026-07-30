/**
 * Реестр токенов приложения
 * Важно: все классы импортируются через `import type`
 */
import { token } from '@/core/framework/container/Container'
import type { Engine } from '@/core/Engine'
import type { Application } from '@/Application'
import type { TextureProvider } from '@/core/textures/TextureProvider'
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
import type { Clock, PerspectiveCamera, Scene, WebGLRenderer } from 'three'
import type { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer'
import type { AstroControls } from '@/core/libs/AstroControls'
import type { Postprocessing } from '@/core/graphic/Postprocessing'
import type { RenderableFactory } from '@/core/renderables/RenderableFactory'
import type { LeakDetector } from '@/core/lifecycle/LeakDetector'
import type { TextureBudget } from '@/core/streaming/TextureBudget'

export const Tokens = {
  Engine: token<Engine>('Engine'),
  Application: token<Application>('Application'),
  TextureProvider: token<TextureProvider>('TextureProvider'),
  SceneManager: token<SceneManager>('SceneManager'),
  MarkerManager: token<MarkerManager>('MarkerManager'),
  ResourceObserver: token<ResourceObserver>('ResourceObserver'),
  SceneObserver: token<SceneObserver>('SceneObserver'),
  SimulationClock: token<SimulationClock>('SimulationClock'),
  CameraController: token<CameraController>('CameraController'),
  Settings: token<Settings>('Settings'),
  NotificationSink: token<NotificationSink>('NotificationSink'),
  LoadingProgressReporter: token<LoadingProgressReporter>('LoadingProgressReporter'),
  MenuController: token<MenuController>('MenuController'),
  Renderer: token<WebGLRenderer>('Renderer'),
  LabelRenderer: token<CSS2DRenderer>('LabelRenderer'),
  Scene: token<Scene>('Scene'),
  Camera: token<PerspectiveCamera>('Camera'),
  AstroControls: token<AstroControls>('AstroControls'),
  Clock: token<Clock>('Clock'),
  Postprocessing: token<Postprocessing>('Postprocessing'),
  RenderableFactory: token<RenderableFactory>('RenderableFactory'),
  LeakDetector: token<LeakDetector>('LeakDetector'),
  TextureBudget: token<TextureBudget>('TextureBudget')
} as const
