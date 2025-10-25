import { Container } from 'inversify'
import 'reflect-metadata'
import DIServices from '@/core/framework/DI/DIServices'
import { Engine } from '@/core/Engine'
import { Application } from '@/Application'
import { RenderManager } from '@/core/services/RenderManager'
import { CubeMapTextureManager } from '@/core/services/CubeMapTextureManager'
import { TextureManager } from '@/core/services/TextureManager'
import { ImageBitmapManager } from '@/core/services/ImageBitmapManager'
import { SceneManager } from '@/core/services/SceneManager'
import { MarkerManager } from '@/core/services/MarkerManager'
import { ScenarioLoader } from '@/core/services/ScenarioLoader'
import { RenderSystem } from '@/core/systems/RenderSystem'
import { EntitySystem } from '@/core/systems/EntitySystem'
import { CameraObserver } from '@/core/services/CameraObserver'

const container: Container = new Container()

container.bind(DIServices.Engine).to(Engine).inSingletonScope()
container.bind(DIServices.Application).to(Application).inSingletonScope()
container.bind(DIServices.RenderManager).to(RenderManager).inSingletonScope()
container.bind(DIServices.CubeMapTextureManager).to(CubeMapTextureManager).inSingletonScope()
container.bind(DIServices.TextureManager).to(TextureManager).inSingletonScope()
container.bind(DIServices.ImageBitmapManager).to(ImageBitmapManager).inSingletonScope()
container.bind(DIServices.SceneManager).to(SceneManager).inSingletonScope()
container.bind(DIServices.MarkerManager).to(MarkerManager).inSingletonScope()
container.bind(DIServices.ScenarioLoader).to(ScenarioLoader).inSingletonScope()
container.bind(DIServices.RenderSystem).to(RenderSystem).inSingletonScope()
container.bind(DIServices.EntitySystem).to(EntitySystem).inSingletonScope()
container.bind(DIServices.CameraObserver).to(CameraObserver).inSingletonScope()

export default container
