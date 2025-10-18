import { Actor } from '@/core/models/Actor'
import { IRenderable } from '@/core/renderables/IRenderable'
import { Galaxy } from '@/core/renderables/Galaxy'
import { StarSystem } from '@/core/renderables/StarSystem'
import { Barycenter } from '@/core/renderables/Barycenter'
import { Star } from '@/core/renderables/Star'
import { Planet } from '@/core/renderables/Planet'
import { Atmosphere } from '@/core/renderables/Atmosphere'
import { Halo } from '@/core/renderables/Halo'
import { Ring } from '@/core/renderables/Ring'
import { BlackHoleV2 } from '@/core/renderables/BlackHoleV2'
import { GalaxyStateStrategy } from '@/core/renderables/galaxy/GalaxyStateStrategy'
import { StarSystemStateStrategy } from '@/core/renderables/galaxy/StarSystemStateStrategy'
import { AppStates } from '@/core/models/types'

class RenderableFactory {
  public static resolveAndCreateActor(actor: Actor, state: AppStates): IRenderable {
    switch (actor.getAttribute('categoryId')) {
      case 2:
        return state === 'galaxy' ? this.createGalaxy(actor) : this.createFakeGalaxy(actor)
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

  private static createGalaxy(actor: Actor): IRenderable {
    return new Galaxy(actor, new GalaxyStateStrategy())
  }

  private static createFakeGalaxy(actor: Actor): IRenderable {
    return new Galaxy(actor, new StarSystemStateStrategy())
  }

  private static createStarSystem(actor: Actor): IRenderable {
    return new StarSystem(actor)
  }

  private static createBarycenter(actor: Actor): IRenderable {
    return new Barycenter(actor)
  }

  private static createBlackHole(actor: Actor): IRenderable {
    return new BlackHoleV2(actor)
  }

  private static createStar(actor: Actor): IRenderable {
    return new Star(actor)
  }

  private static createPlanet(actor: Actor): IRenderable {
    return new Planet(actor)
  }

  private static createAtmosphere(actor: Actor): IRenderable {
    return new Atmosphere(actor)
  }

  private static createHalo(actor: Actor): IRenderable {
    return new Halo(actor)
  }

  private static createRing(actor: Actor): IRenderable {
    return new Ring(actor)
  }
}

export { RenderableFactory }
