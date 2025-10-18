import { IResource } from '@/core/models/types'
import type { Texture } from 'three'
import { Resources } from '@storage/database'
import { generateTexture } from '@/core/materials/helpers'

export type TTextureConfig = {
  TexturesDirectoryName: string
  FilesToLoad: IResource[]
  BitmapsToLoad: IResource[]
  CubeFilesToLoad: Array<IResource[]>
  LoadedTextures: Map<string, Texture>
}

const commonFiles: IResource[] = Resources.filter((resource: IResource): boolean => resource.actorId === null)

const commonCubemapFiles: IResource[] = Resources.filter(
  (resource: IResource): boolean => resource.resourceType === 'cube'
)

export const TextureConfig: TTextureConfig = {
  TexturesDirectoryName: 'textures',
  FilesToLoad: [...commonFiles],
  BitmapsToLoad: [],
  CubeFilesToLoad: [[...commonCubemapFiles]],
  LoadedTextures: new Map<string, Texture>()
}

export function addTexture(key: string, texture: Texture): void {
  TextureConfig.LoadedTextures.set(key, texture)
}

export function deleteTextureByKey(key: string): void {
  TextureConfig.LoadedTextures.delete(key)
}

export function getTextureByKey(key: string): Texture | null {
  return TextureConfig.LoadedTextures.get(key) || null
}

export function getTextureByKeyWithDefault(key: string, fallback: Texture = generateTexture()): Texture {
  return TextureConfig.LoadedTextures.get(key) || fallback
}

export function getLoadedTextures(): Map<string, Texture> {
  return TextureConfig.LoadedTextures
}

export function getCountLoadedTextures(): number {
  return TextureConfig.LoadedTextures.size
}

export function isExistsTexture(key: string): boolean {
  return TextureConfig.LoadedTextures.has(key)
}

export function getTexturesDirname(): string {
  return TextureConfig.TexturesDirectoryName
}
