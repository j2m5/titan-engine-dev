import { BoxHelper, LOD, Object3D } from 'three'
import { Actor } from '@/core/models/Actor'
import { Galaxy } from '@/core/renderables/Galaxy'
import { StarSystem } from '@/core/renderables/StarSystem'
import { Barycenter } from '@/core/renderables/Barycenter'
import { StaticNode } from '@/core/renderables/utils/StaticNode'
import { DynamicNode } from '@/core/renderables/utils/DynamicNode'
import { Star } from '@/core/renderables/Star'
import { StarInnerLayer } from '@/core/renderables/utils/StarInnerLayer'
import { StarOuterLayer } from '@/core/renderables/utils/StarOuterLayer'
import { FakeStar } from '@/core/renderables/utils/FakeStar'
import { Planet } from '@/core/renderables/Planet'
import { FakePlanet } from '@/core/renderables/utils/FakePlanet'
import { Atmosphere } from '@/core/renderables/Atmosphere'
import { Halo } from '@/core/renderables/Halo'
import { Ring } from '@/core/renderables/Ring'
import { DetailedRing } from '@/core/renderables/utils/DetailedRing'
import { threeJS } from '@/core/graphic/ThreeJS'
import { degToRad } from 'three/src/math/MathUtils'
import { config } from '@/core/framework/config'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { AsteroidCluster } from '@/core/renderables/utils/AsteroidCluster'
import { DetailedRingV2 } from '@/core/renderables/utils/DetailedRingV2'

class RenderableFactory {
  public static make(actor: Actor): Object3D {
    switch (actor.getAttribute('categoryId')) {
      case 2:
        return this.createFakeGalaxy(actor)
      case 3:
        return this.createStarSystem(actor)
      case 4:
        return this.createBarycenter(actor)
      case 5:
        return this.createBlackHole(actor)
      case 6:
        return this.createStar(actor)
      case 7:
        return this.createPlanet(actor)
      case 8:
        return this.createAtmosphere(actor)
      case 9:
        return this.createHalo(actor)
      case 10:
        return this.createRing(actor)
      default:
        throw new Error("Couldn't resolve actor")
    }
  }

  private static createFakeGalaxy(actor: Actor): Object3D {
    return new Galaxy(actor)
  }

  private static createStarSystem(actor: Actor): Object3D {
    return new StarSystem(actor)
  }

  private static createBarycenter(actor: Actor): Object3D {
    return new Barycenter(actor)
  }

  private static createBlackHole(actor: Actor): Object3D {
    // в данный момент отсутствует стабильная реализация объекта BlackHole
    // поэтому пока заглушка
    return new DynamicNode(actor)
  }

  private static createStar(actor: Actor): Object3D {
    const node = new DynamicNode(actor)
    const lod = new LOD()
    const lodl1 = new Star(actor)
    const lodl2 = new FakeStar(actor)
    const starInnerLayer = new StarInnerLayer(actor)
    const starOuterLayer = new StarOuterLayer(actor)
    const test = new AsteroidCluster(1500, toThreeJSUnits(500), 0.25)
    const box = new BoxHelper(test)
    lodl1.add(test)
    lodl1.add(box)

    const distanceLod = (pixels: number): number => {
      const radius: number = actor.physicalObject!.getAttribute('radius')
      const fov: number = degToRad(config('camera.fov'))

      return toThreeJSUnits((2 * radius * threeJS.renderer.domElement.height) / (Math.tan(fov) * pixels))
    }

    lod.add(starInnerLayer)
    lodl1.add(starOuterLayer)

    node.name = actor.getAttribute('name')
    node.renderable = lodl1

    lod.name = actor.getAttribute('name') + 'LOD'

    lod.addLevel(lodl1)
    lod.addLevel(lodl2, distanceLod(3))

    node.add(lod)

    return node
  }

  private static createPlanet(actor: Actor): Object3D {
    const node = new DynamicNode(actor)
    const lod = new LOD()
    const lodl1 = new Planet(actor)
    const lodl2 = new FakePlanet(actor)

    const distanceLod = (pixels: number): number => {
      const radius: number = actor.physicalObject!.getAttribute('radius')
      const fov: number = degToRad(config('camera.fov'))

      return toThreeJSUnits((2 * radius * threeJS.renderer.domElement.height) / (Math.tan(fov) * pixels))
    }

    node.name = actor.getAttribute('name')
    node.renderable = lodl1

    lod.name = actor.getAttribute('name') + 'LOD'

    lod.addLevel(lodl1)
    lod.addLevel(lodl2, distanceLod(3))

    node.add(lod)

    return node
  }

  private static createAtmosphere(actor: Actor): Object3D {
    return new Atmosphere(actor)
  }

  private static createHalo(actor: Actor): Object3D {
    return new Halo(actor)
  }

  private static createRing(actor: Actor): Object3D {
    const node = new StaticNode(actor)
    const lod = new LOD()
    const base = new Ring(actor)
    const detailed = new Ring(actor)
    //detailed.add(new DetailedRing(actor))
    detailed.add(new DetailedRingV2(actor))

    const distanceLod = toThreeJSUnits(actor.renderingObject!.getAttribute('data').outerRadius * 2)

    node.name = actor.getAttribute('name') + 'Ring'
    lod.name = actor.getAttribute('name') + 'Ring'
    node.renderable = base

    lod.addLevel(detailed)
    lod.addLevel(base, distanceLod)

    node.add(lod)

    return node
  }
}

export { RenderableFactory }
