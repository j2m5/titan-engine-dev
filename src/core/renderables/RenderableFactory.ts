import { LOD, Object3D, Vector3 } from 'three'
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
import { threeJS } from '@/core/graphic/ThreeJS'
import { degToRad } from 'three/src/math/MathUtils'
import { config } from '@/core/framework/config'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { Nebula } from '@/core/renderables/Nebula'

class RenderableFactory {
  public static make(actor: Actor): Object3D {
    switch (actor.getAttribute('categoryId')) {
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
      default:
        throw new Error("Couldn't resolve actor")
    }
  }

  private static createBarycenter(actor: Actor): Object3D {
    return new Barycenter(actor)
  }

  private static createBlackHole(actor: Actor): Object3D {
    const node = new DynamicNode(actor)
    const lod = new LOD()
    const lodl1 = new BlackHole(actor)
    const lodl2 = new BlackHoleImpostor(actor, lodl1.parameters)

    const distanceLod = (pixels: number): number => {
      const radius: number = lodl1.parameters.simulationRadius
      const fov: number = degToRad(config('camera.fov'))

      return toThreeJSUnits((2 * radius * threeJS.renderer.domElement.height) / (Math.tan(fov) * pixels))
    }

    node.name = actor.getAttribute('name')
    node.renderable = lodl1

    lod.name = actor.getAttribute('name') + 'LOD'

    lod.addLevel(lodl1)
    lod.addLevel(lodl2, distanceLod(config('blackHole.lodPixels')), config('blackHole.lodHysteresis'))

    node.add(lod)

    return node
  }

  private static createStar(actor: Actor): Object3D {
    const node = new DynamicNode(actor)
    const lod = new LOD()
    const lodl1 = new Star(actor)
    const lodl2 = new FakeStar(actor)
    const starInnerLayer = new StarInnerLayer(actor)
    const starOuterLayer = new StarOuterLayer(actor)

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

    if (actor.attributes.id === 87) {
      node.add(
        new Nebula({
          size: 27000000,
          seed: 5120,
          shape: 'disk',
          axisRatios: new Vector3(1, 0.5, 1),
          edgeFalloff: 0.6,
          density: 0.5,
          noise: { contrast: 2, worleyStrength: 0.35, ridged: 1 },
          cavities: [{ center: new Vector3(0.1, 0, 0), radius: 0.4, strength: 0.3 }]
        })
      )
    }

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
    return new BrunetonAtmosphere(actor)
  }

  private static createRing(actor: Actor): Object3D {
    const node = new StaticNode(actor)
    const lod = new LOD()
    const base = new Ring(actor)
    const detailed = new Ring(actor)
    detailed.add(new AsteroidRingSystem(actor))

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
