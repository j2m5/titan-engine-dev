import { Resources, RenderingObjects } from '@storage/database'
import { IResource, IRenderingObject } from '@/core/models/types'

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

  it('страж: resourceType планет соответствует суффиксу пути (_clouds/_night/_specular/_bump)', () => {
    const suffixToType: Record<string, string> = {
      _clouds: 'cloud',
      _night: 'night',
      _specular: 'specular',
      _bump: 'bump',
      _height: 'height'
    }
    const mislabeled: Array<{ id: number; path: string; resourceType: string; expected: string }> = []
    for (const resource of Resources) {
      if (!resource.path.startsWith('planets/')) continue
      for (const [suffix, expected] of Object.entries(suffixToType)) {
        if (resource.path.includes(suffix) && resource.resourceType !== expected) {
          mislabeled.push({ id: resource.id, path: resource.path, resourceType: resource.resourceType, expected })
        }
      }
    }
    expect(mislabeled).toEqual([])
  })

  it('actorId 28 (Рея) имеет renderingObjects-запись с bumpScale > 0', () => {
    const rheaRenderingObject: IRenderingObject | undefined = RenderingObjects.find(
      (r: IRenderingObject) => r.actorId === 28
    )
    expect(rheaRenderingObject).toBeDefined()
    expect((rheaRenderingObject?.data as { bumpScale?: number })?.bumpScale).toBeGreaterThan(0)
  })

  it('height-ресурсы всегда resident: streamable-провал на неизвестном расширении откатывает все ресурсы актора', () => {
    const wrong = Resources.filter((r: IResource) => r.resourceType === 'height' && r.lifecycle !== 'resident')

    expect(wrong).toEqual([])
  })
})
