type IocTypes = {
  ModelManager: ModelManager
  RenderManager: RenderManager
  CubeMapTextureManager: CubeMapTextureManager
  TextureManager: TextureManager
  RayManager: RayManager
}

type NoUndefined<T> = T extends undefined ? never : T

declare module 'ioc-service-container' {
  export function scg<T extends keyof IocTypes, U extends IocTypes[T]>(id: T): U

  export const ServiceContainer: {
    set<T>(id: string, provider: NoUndefined<T>): void
    override<T_1>(id: string, provider: NoUndefined<T_1>): void
    get<T extends keyof IocTypes, U extends IocTypes[T]>(id: T): U
    isSet(id: string): boolean
    reset(): void
  }
}
