import { Texture, TextureLoader, SRGBColorSpace, NoColorSpace } from 'three'

export interface EarthTextures {
  surface: Texture
  clouds: Texture
  night: Texture
  specular: Texture
  dispose(): void
}
const assets = [
  ['surface', new URL('./assets/earth.jpg', import.meta.url).href, SRGBColorSpace],
  ['clouds', new URL('./assets/earth_clouds.jpg', import.meta.url).href, SRGBColorSpace],
  ['night', new URL('./assets/earth_night.jpg', import.meta.url).href, SRGBColorSpace],
  ['specular', new URL('./assets/earth_specular.jpg', import.meta.url).href, NoColorSpace]
] as const

export async function loadEarthTextures(
  loader: Pick<TextureLoader, 'loadAsync'> = new TextureLoader()
): Promise<EarthTextures> {
  const results = await Promise.allSettled(assets.map(([, url]) => Promise.resolve().then(() => loader.loadAsync(url))))
  const owned = new Set(results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])))
  const failures = results.flatMap((result, i) =>
    result.status === 'rejected' ? [`${assets[i][0]} (${assets[i][1]}): ${String(result.reason)}`] : []
  )
  if (failures.length) {
    owned.forEach((texture) => texture.dispose())
    throw new Error(`Earth texture load failed: ${failures.join('; ')}`)
  }
  const textures = results.map((result, i) => {
    if (result.status !== 'fulfilled') throw new Error('Unreachable Earth texture state')
    result.value.colorSpace = assets[i][2]
    return result.value
  })
  let disposed = false
  return {
    surface: textures[0],
    clouds: textures[1],
    night: textures[2],
    specular: textures[3],
    dispose() {
      if (disposed) return
      disposed = true
      owned.forEach((texture) => texture.dispose())
    }
  }
}
