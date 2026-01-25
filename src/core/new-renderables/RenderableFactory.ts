import { LOD, Object3D } from 'three'
import { Actor } from '@/core/models/Actor'
import { Galaxy } from '@/core/new-renderables/Galaxy'
import { StarSystem } from '@/core/new-renderables/StarSystem'
import { Barycenter } from '@/core/new-renderables/Barycenter'
import { FakeStar } from '@/core/new-renderables/utils/FakeStar'
import { StaticNode } from '@/core/new-renderables/utils/StaticNode'
import { DynamicNode } from '@/core/new-renderables/utils/DynamicNode'
import { Star } from '@/core/new-renderables/Star'
import { Planet } from '@/core/new-renderables/Planet'
import { FakePlanet } from '@/core/new-renderables/utils/FakePlanet'
import { Atmosphere } from '@/core/new-renderables/Atmosphere'
import { Halo } from '@/core/new-renderables/Halo'
import { Ring } from '@/core/new-renderables/Ring'
import { DetailedRing } from '@/core/new-renderables/utils/DetailedRing'
import { degToRad } from 'three/src/math/MathUtils'
import { config } from '@/core/framework/config'
import { toThreeJSUnits } from '@/core/helpers/scaling'

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

    const distanceLod = (pixels: number): number => {
      const radius: number = actor.physicalObject!.getAttribute('radius')
      const fov: number = degToRad(config('camera.fov'))

      return toThreeJSUnits((2 * radius * window.innerHeight) / (fov * pixels))
    }

    node.name = actor.getAttribute('name')

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

      return toThreeJSUnits((2 * radius * window.innerHeight) / (fov * pixels))
    }

    node.name = actor.getAttribute('name')

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
    detailed.add(new DetailedRing(actor))

    const distanceLod = toThreeJSUnits(actor.renderingObject!.getAttribute('data').outerRadius * 2)

    node.name = actor.getAttribute('name') + 'Ring'
    lod.name = actor.getAttribute('name') + 'Ring'

    lod.addLevel(detailed)
    lod.addLevel(base, distanceLod)

    node.add(lod)

    return node
  }
}

export { RenderableFactory }
