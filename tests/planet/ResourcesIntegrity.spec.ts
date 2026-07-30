import { Resources } from '@storage/database'
import { IResource } from '@/core/models/types'

describe('Целостность ресурсов планет', () => {
  it('id 66 (rhea_bump) — bump, а не diffuse', () => {
    const rheaBump: IResource | undefined = Resources.find((r: IResource) => r.id === 66)
    expect(rheaBump?.resourceType).toBe('bump')
  })

  it('id 113 (korriban_clouds) — cloud, а не specular', () => {
    const korribanClouds: IResource | undefined = Resources.find((r: IResource) => r.id === 113)
    expect(korribanClouds?.resourceType).toBe('cloud')
  })

  it('страж: ни один ресурс планет с "_bump" в пути не заведён как diffuse', () => {
    // Сужена до planets/ т.к. asteroid_bump.jpg в root — non-planet layer, резидентный ресурс
    const mislabeled: IResource[] = Resources.filter(
      (r: IResource) => r.path.startsWith('planets/') && r.path.includes('_bump') && r.resourceType === 'diffuse'
    )
    expect(mislabeled).toEqual([])
  })
})
