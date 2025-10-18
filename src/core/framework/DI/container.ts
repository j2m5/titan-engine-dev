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

const container: Container = new Container()

container.bind(DIServices.Engine).to(Engine).inSingletonScope()
container.bind(DIServices.Application).to(Application).inSingletonScope()
container.bind(DIServices.RenderManager).to(RenderManager).inSingletonScope()
container.bind(DIServices.CubeMapTextureManager).to(CubeMapTextureManager).inSingletonScope()
container.bind(DIServices.TextureManager).to(TextureManager).inSingletonScope()
container.bind(DIServices.ImageBitmapManager).to(ImageBitmapManager).inSingletonScope()
container.bind(DIServices.SceneManager).to(SceneManager).inSingletonScope()
container.bind(DIServices.MarkerManager).to(MarkerManager).inSingletonScope()

export default container
