import { LOD, Object3D, WebGLRenderer } from 'three'
import { Actor } from '@/core/models/Actor'
import { Barycenter } from '@/core/renderables/Barycenter'
import { BlackHole } from '@/core/renderables/BlackHole'
import { BlackHoleImpostor } from '@/core/renderables/BlackHole/BlackHoleImpostor'
import { StaticNode } from '@/core/renderables/utils/StaticNode'
import { DynamicNode } from '@/core/renderables/utils/DynamicNode'
import { Star } from '@/core/renderables/Star'
import { StarInnerLayer } from '@/core/renderables/utils/StarInnerLayer'
import { StarOuterLayer } from '@/core/renderables/utils/StarOuterLayer'
import { FakeStar } from '@/core/renderables/utils/FakeStar'
import { Planet } from '@/core/renderables/Planet'
import { FakePlanet } from '@/core/renderables/utils/FakePlanet'
import { BrunetonAtmosphere } from '@/core/renderables/Atmosphere/BrunetonAtmosphere'
import { Ring } from '@/core/renderables/Ring'
import { AsteroidRingSystem } from '@/core/renderables/DetailedRingStreamingSystem'
import { degToRad } from 'three/src/math/MathUtils'
import { config } from '@/core/framework/config'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { requireRenderingData } from '@/core/helpers/renderingData'
import { Nebula } from '@/core/renderables/Nebula'
import { nebulaParamsFromData } from '@/core/renderables/Nebula/NebulaRenderingData'
import { PlacedNode } from '@/core/renderables/utils/PlacedNode'
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
      default:
        throw new Error("Couldn't resolve actor")
    }
  }

  private createBarycenter(actor: Actor): Object3D {
    return new Barycenter(actor)
  }

  private createBlackHole(actor: Actor): Object3D {
    const node = new DynamicNode(actor)
    const lod = new LOD()
    const lodl1 = new BlackHole(actor, this.resourceObserver)
    const lodl2 = new BlackHoleImpostor(actor, lodl1.parameters)

    const distanceLod = (pixels: number): number => {
      const radius: number = lodl1.parameters.simulationRadius
      const fov: number = degToRad(config('camera.fov'))

      return toThreeJSUnits((2 * radius * this.renderer.domElement.height) / (Math.tan(fov) * pixels))
    }

    node.name = actor.getAttribute('name', '')
    node.renderable = lodl1

    lod.name = actor.getAttribute('name', '') + 'LOD'

    lod.addLevel(lodl1)
    lod.addLevel(lodl2, distanceLod(config('blackHole.lodPixels')), config('blackHole.lodHysteresis'))

    node.add(lod)

    return node
  }

  private createStar(actor: Actor): Object3D {
    const node = new DynamicNode(actor)
    const lod = new LOD()
    const lodl1 = new Star(actor)
    const lodl2 = new FakeStar(actor, this.renderer)
    const starInnerLayer = new StarInnerLayer(actor)
    const starOuterLayer = new StarOuterLayer(actor)

    const distanceLod = (pixels: number): number => {
      const radius: number = actor.physicalObject!.getAttribute('radius')!
      const fov: number = degToRad(config('camera.fov'))

      return toThreeJSUnits((2 * radius * this.renderer.domElement.height) / (Math.tan(fov) * pixels))
    }

    lod.add(starInnerLayer)
    lodl1.add(starOuterLayer)

    node.name = actor.getAttribute('name', '')
    node.renderable = lodl1

    lod.name = actor.getAttribute('name', '') + 'LOD'

    lod.addLevel(lodl1)
    lod.addLevel(lodl2, distanceLod(3))

    node.add(lod)

    return node
  }

  private createPlanet(actor: Actor): Object3D {
    const node = new DynamicNode(actor)
    const lod = new LOD()
    const lodl1 = new Planet(actor)
    const lodl2 = new FakePlanet(actor)

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
