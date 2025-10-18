import { Container } from 'inversify'
import 'reflect-metadata'
import DIServices from '@/core/framework/DI/DIServices.ts'
import { Engine } from '@/core/Engine.ts'
import { Application } from '@/Application.ts'
import { RenderManager } from '@/core/services/RenderManager.ts'
import { CubeMapTextureManager } from '@/core/services/CubeMapTextureManager.ts'
import { TextureManager } from '@/core/services/TextureManager.ts'
import { ImageBitmapManager } from '@/core/services/ImageBitmapManager.ts'
import { SceneManager } from '@/core/services/SceneManager.ts'
import { MarkerManager } from '@/core/services/MarkerManager.ts'

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
