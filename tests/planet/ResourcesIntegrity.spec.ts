import { Resources, RenderingObjects } from '@storage/database'
import { IResource, IRenderingObject } from '@/core/models/types'
import { isValidSlopeRange, SLOPE_RANGE } from '@/core/terrain/slopeMapFormat'

describe('Целостность ресурсов планет', () => {
  // Прежний страж «у тела с картой высот не осталось planets/-bump» поглощён
  // стражем ниже: тип bump снят целиком, ни одной строки с ним нет в принципе.

  it('страж: астероидные наборы камня лежат под detail*-типами, тип bump вымер', () => {
    // Наборы PBR-карт трипланара астероидов резидентные, ни к одному актору не
    // привязаны (кольца ищут их по пути, см. AsteroidRingSystem.__applyDetailMaps)
    // и удалению не подлежат — без них рассыпается детализация колец. Исторически
    // лежали под типом bump; после ретайпа на detail*-типы планетного носителя у
    // bump не осталось и тип снят целиком.
    const detail = Resources.filter(
      (r: IResource): boolean => r.path.startsWith('asteroids/') && /_2k\.jpg$/.test(r.path)
    )

    expect(detail).toHaveLength(6)
    expect(detail.every((r: IResource): boolean => r.lifecycle === 'resident')).toBe(true)

    const typeBySuffix: Record<string, string> = { _diff: 'detailDiffuse', _nor_gl: 'detailNormal', _arm: 'detailArm' }
    for (const r of detail) {
      const suffix = Object.keys(typeBySuffix).find((s: string): boolean => r.path.includes(s))
      expect(suffix, r.path).toBeDefined()
      expect(r.resourceType, r.path).toBe(typeBySuffix[suffix!])
    }

    expect(Resources.filter((r: IResource): boolean => (r.resourceType as string) === 'bump')).toEqual([])
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

  it('страж: карты облаков и ночных огней читаются как sRGB', () => {
    // Обе — художественные картинки в sRGB, а не данные: без colorSpace
    // загрузчик берёт линейное чтение, и середина шкалы уезжает вверх
    // (облака бледнеют, огни городов пересвечены). Политика единая на тип.
    const wrong = Resources.filter(
      (r: IResource) => (r.resourceType === 'cloud' || r.resourceType === 'night') && r.colorSpace !== 'srgb'
    )

    expect(wrong).toEqual([])
  })

  it('height-ресурсы всегда resident: streamable-провал на неизвестном расширении откатывает все ресурсы актора', () => {
    const wrong = Resources.filter((r: IResource) => r.resourceType === 'height' && r.lifecycle !== 'resident')

    expect(wrong).toEqual([])
  })

  it('страж: у каждой slope-строки объявлен slopeRange из сетки', () => {
    const slopes = Resources.filter((r) => r.resourceType === 'slope')
    expect(slopes.length).toBeGreaterThanOrEqual(50)
    for (const r of slopes) {
      expect(isValidSlopeRange(r.slopeRange), `${r.path}: slopeRange=${String(r.slopeRange)}`).toBe(true)
    }
  })

  it('страж: slopeRange не выше SLOPE_RANGE — липшицева константа марша CameraCollision', () => {
    const steep = Resources.filter((r) => r.resourceType === 'slope' && (r.slopeRange ?? SLOPE_RANGE) > SLOPE_RANGE)
    expect(steep).toEqual([]) // 4 в сетке допустим только вместе с ревизией marchTerrain
  })
})
