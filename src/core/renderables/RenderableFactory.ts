import { LOD, Object3D, WebGLRenderer } from 'three'
import { Actor } from '@/core/models/Actor'
import { Barycenter } from '@/core/renderables/Barycenter'
import { BlackHole } from '@/core/renderables/BlackHole'
import { BlackHoleImpostor } from '@/core/renderables/BlackHole/BlackHoleImpostor'
import { BlackHoleLod } from '@/core/renderables/utils/BlackHoleLod'
import { StaticNode } from '@/core/renderables/utils/StaticNode'
import { DynamicNode } from '@/core/renderables/utils/DynamicNode'
import { Star } from '@/core/renderables/Star'
import { StarInnerLayer } from '@/core/renderables/utils/StarInnerLayer'
import { StarOuterLayer } from '@/core/renderables/utils/StarOuterLayer'
import { FakeStar } from '@/core/renderables/utils/FakeStar'
import { StarLod } from '@/core/renderables/utils/StarLod'
import { ApparentSizeLod } from '@/core/renderables/utils/ApparentSizeLod'
import { Planet } from '@/core/renderables/Planet'
import { TerrainSphere } from '@/core/renderables/TerrainSphere'
import { FakePlanet } from '@/core/renderables/utils/FakePlanet'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { terrainHeightFieldFor } from '@/core/terrain/TerrainHeightField'
import { BrunetonAtmosphere } from '@/core/renderables/Atmosphere/BrunetonAtmosphere'
import { Ring } from '@/core/renderables/Ring'
import { AsteroidRingSystem } from '@/core/renderables/DetailedRingStreamingSystem'
import { degToRad } from 'three/src/math/MathUtils'
import { config } from '@/core/framework/config'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { requireRenderingData } from '@/core/helpers/renderingData'
import { BROWN_DWARF_IMPOSTOR_PIXELS, WHITE_DWARF_IMPOSTOR_PIXELS } from '@/core/helpers/apparentSize'
import { Nebula } from '@/core/renderables/Nebula'
import { nebulaParamsFromData } from '@/core/renderables/Nebula/NebulaRenderingData'
import { PlacedNode } from '@/core/renderables/utils/PlacedNode'
import { BrownDwarf } from '@/core/renderables/BrownDwarf'
import { BrownDwarfImpostor } from '@/core/renderables/BrownDwarf/BrownDwarfImpostor'
import { WhiteDwarf } from '@/core/renderables/WhiteDwarf/WhiteDwarf'
import { WhiteDwarfImpostor } from '@/core/renderables/WhiteDwarf/WhiteDwarfImpostor'
import { INebulaRenderingObject, IRingRenderingObject } from '@/core/models/types'
import { ResourceObserver } from '@/core/services/ResourceObserver'

class RenderableFactory {
  public constructor(
    private readonly renderer: WebGLRenderer,
    private readonly resourceObserver: ResourceObserver
  ) {}

  public make(actor: Actor): Object3D {
    switch (actor.getAttribute('categoryId', -1)) {
      case 1:
        return this.createBarycenter(actor)
      case 2:
        return this.createBlackHole(actor)
      case 3:
        return this.createStar(actor)
      case 4:
        return this.createPlanet(actor)
      case 5:
        return this.createAtmosphere(actor)
      case 6:
        return this.createRing(actor)
      case 7:
        return this.createNebula(actor)
      case 8:
        return this.createBrownDwarf(actor)
      case 9:
        return this.createWhiteDwarf(actor)
      default:
        throw new Error("Couldn't resolve actor")
    }
  }

  private createBarycenter(actor: Actor): Object3D {
    return new Barycenter(actor)
  }

  private createBlackHole(actor: Actor): Object3D {
    const node = new DynamicNode(actor)
    const lodl1 = new BlackHole(actor, this.resourceObserver)
    const lodl2 = new BlackHoleImpostor(actor, lodl1.parameters)
    const lod = new BlackHoleLod(lodl1.parameters.simulationRadius, this.renderer)

    node.name = actor.getAttribute('name', '')
    node.renderable = lodl1

    lod.name = actor.getAttribute('name', '') + 'LOD'

    // Стартовое значение: дальше BlackHoleLod пересчитывает дистанцию каждый
    // кадр — порог задан в пикселях и обязан переживать ресайз и смену fov
    lod.addLevel(lodl1)
    lod.addLevel(lodl2, lod.switchDistance(config('camera.fov')), config('blackHole.lodHysteresis'))

    node.add(lod)

    return node
  }

  private createStar(actor: Actor): Object3D {
    const node = new DynamicNode(actor)
    const lod = new StarLod(actor.physicalObject!.getAttribute('radius')!, this.renderer)
    const lodl1 = new Star(actor)
    const lodl2 = new FakeStar(actor, this.renderer)
    const starInnerLayer = new StarInnerLayer(actor)
    const starOuterLayer = new StarOuterLayer(actor)

    lod.add(starInnerLayer)
    lodl1.add(starOuterLayer)

    node.name = actor.getAttribute('name', '')
    node.renderable = lodl1

    lod.name = actor.getAttribute('name', '') + 'LOD'

    // Стартовое значение: дальше StarLod пересчитывает дистанцию каждый кадр,
    // потому что билборд меряет свой размер живой высотой вьюпорта
    lod.addLevel(lodl1)
    // Гистерезис против мигания на границе: обратное переключение на
    // d·(1−h), диск возвращается на ~12.6px вместо 12 (см. config/star.ts)
    lod.addLevel(lodl2, lod.switchDistance(config('camera.fov')), config('star.lodHysteresis'))

    node.add(lod)

    return node
  }

  private createBrownDwarf(actor: Actor): Object3D {
    const node = new DynamicNode(actor)
    const lod = new ApparentSizeLod(
      actor.physicalObject!.getAttribute('radius')!,
      this.renderer,
      BROWN_DWARF_IMPOSTOR_PIXELS
    )
    const body = new BrownDwarf(actor)
    const impostor = new BrownDwarfImpostor(body, this.renderer)

    // Ореол висит на LOD, а не на теле: он нужен на обоих уровнях, и
    // сильнее всего именно на дальнем, где тело меньше пикселя.
    // Приглушён против звёздного — карлик тлеет, а не сияет
    lod.add(new StarInnerLayer(actor, 0.8, config('brownDwarf.haloOpacity')))

    node.name = actor.getAttribute('name', '')
    node.renderable = body

    lod.name = actor.getAttribute('name', '') + 'LOD'
    lod.addLevel(body)
    lod.addLevel(impostor, lod.switchDistance(config('camera.fov')), config('brownDwarf.lodHysteresis'))

    node.add(lod)

    return node
  }

  private createWhiteDwarf(actor: Actor): Object3D {
    const node = new DynamicNode(actor)
    const lod = new ApparentSizeLod(
      actor.physicalObject!.getAttribute('radius')!,
      this.renderer,
      WHITE_DWARF_IMPOSTOR_PIXELS
    )
    const body = new WhiteDwarf(actor)
    const impostor = new WhiteDwarfImpostor(body, this.renderer)

    // Ореол висит на LOD, а не на теле: он нужен на обоих уровнях, и сильнее
    // всего на дальнем. У карлика это не украшение — при угловом размере в
    // сотню раз меньше солнечного тело почти всегда мельче пикселя, и весь
    // его вид несёт ореол. Отсюда opacity выше звёздной при меньшем масштабе:
    // жёсткая искра, а не раздутая корона, которой у карлика нет физически
    lod.add(new StarInnerLayer(actor, config('whiteDwarf.haloScale'), config('whiteDwarf.haloOpacity')))

    node.name = actor.getAttribute('name', '')
    node.renderable = body

    lod.name = actor.getAttribute('name', '') + 'LOD'
    lod.addLevel(body)
    lod.addLevel(impostor, lod.switchDistance(config('camera.fov')), config('whiteDwarf.lodHysteresis'))

    node.add(lod)

    return node
  }

  private createPlanet(actor: Actor): Object3D {
    const node = new DynamicNode(actor)
    const lod = new LOD()
    // Рельеф — по фактически загруженной карте: провал загрузки деградирует
    // к легаси-сфере согласованно с материалом и коллизией
    const heightPath = actor.resources.where('resourceType', 'height').first()?.getAttribute('path')
    const heightMap = typeof heightPath === 'string' ? heightFieldStorage.get(heightPath) : undefined
    const lodl1 = heightMap
      ? new TerrainSphere(
          actor,
          terrainHeightFieldFor(heightMap, actor.physicalObject!.getAttribute('radius')!),
          this.renderer
        )
      : new Planet(actor)
    const lodl2 = new FakePlanet(actor)

    // Известно-неверная высота кадра: tan(fov) вместо 2*tan(fov/2), поэтому
    // переключение происходит на 3.8 px вместо номинальных 3. Не тронута
    // намеренно — честная правка отодвинула бы переключение на 28% дальше и
    // требует замера кадра. У ЧД это уже вылечено (BlackHoleLod + пересчёт
    // lodPixels под фактический порог) — тот же приём применим и здесь
    const distanceLod = (pixels: number): number => {
      const radius: number = actor.physicalObject!.getAttribute('radius')!
      const fov: number = degToRad(config('camera.fov'))

      return toThreeJSUnits((2 * radius * this.renderer.domElement.height) / (Math.tan(fov) * pixels))
    }

    node.name = actor.getAttribute('name', '')
    node.renderable = lodl1

    lod.name = actor.getAttribute('name', '') + 'LOD'

    lod.addLevel(lodl1)
    lod.addLevel(lodl2, distanceLod(3))

    node.add(lod)

    return node
  }

  private createAtmosphere(actor: Actor): Object3D {
    return new BrunetonAtmosphere(actor, this.renderer)
  }

  private createRing(actor: Actor): Object3D {
    // Проверка стоит до конструирования: кольцо без конфига не построить, и отказ здесь
    // ничего не аллоцирует, а сужение дальше доказывает сам tsc
    const ringData: IRingRenderingObject = requireRenderingData<IRingRenderingObject>(
      actor,
      'RenderableFactory',
      'кольца'
    )

    const node = new StaticNode(actor)
    const lod = new LOD()
    const base = new Ring(actor)
    const detailed = new Ring(actor)
    detailed.add(new AsteroidRingSystem(actor))

    const distanceLod = toThreeJSUnits(ringData.outerRadius * 2)

    node.name = actor.getAttribute('name', '') + 'Ring'
    lod.name = actor.getAttribute('name', '') + 'Ring'
    node.renderable = base

    lod.addLevel(detailed)
    lod.addLevel(base, distanceLod)

    node.add(lod)

    return node
  }

  private createNebula(actor: Actor): Object3D {
    // Как и у кольца: проверка до конструирования — туманность без конфига
    // не построить, отказ здесь ничего не аллоцирует
    const data: INebulaRenderingObject = requireRenderingData<INebulaRenderingObject>(
      actor,
      'RenderableFactory',
      'туманности'
    )

    const node = new PlacedNode(actor)

    node.name = actor.getAttribute('name', '')
    // renderable намеренно остаётся null: Nebula — контейнер без собственных
    // geometry/material, а RenderableObject3D требует оба. Следствие —
    // у туманности нет маркера и прицела, она не навигационное тело.
    node.add(new Nebula(this.renderer, nebulaParamsFromData(data)))

    return node
  }
}

export { RenderableFactory }
