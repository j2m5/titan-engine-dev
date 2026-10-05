import { Color, LOD, Object3D, Quaternion, Vector3 } from 'three'
import type { Actor } from '@/core/models/Actor'
import type { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { ATMOSPHERE_CATEGORY_ID, SpaceScale } from '@/core/constants'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { readRenderingData } from '@/core/helpers/renderingData'
import { resolveStarRadiusKm } from '@/core/terrain/starRadius'
import type { AtmosphereConfig } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import type { IPlanetRenderingObject } from '@/core/models/types'
import { eclipseLightCpu, selectOccluders, type Candidate, type Occluder, type Vec3 } from '@/core/eclipse/eclipseMath'
import { umbraTintFromAtmosphere } from '@/core/eclipse/umbraTint'
import { resolveUmbraGlow } from '@/core/eclipse/umbraGlow'
import { emptyEclipseData, type EclipseUniformData } from '@/core/eclipse/eclipseUniforms'

/** Узел тела: DynamicNode (модель + поверхность); в тестах — любой Object3D с этими полями. */
export type EclipseBodyNode = Object3D & { model: Actor; renderable: Object3D | null }

interface Body {
  node: EclipseBodyNode
  actorId: number
  radiusUnits: number
  starRadiusUnits: number | undefined
  umbra?: { tint: Vec3; glow: number }
  center: Vector3
}

/**
 * Затмения: раз в кадр (SceneManager.update после обхода сцены) выбирает для каждого тела
 * до четырёх затеняющих соседей и раздаёт данные материалам поверхности и воды (система тела,
 * юниты), точке-импостору (CPU-свет в центре) и записи атмосферы (мировые оси, км). Звезда — в нуле.
 */
export class EclipseSystem {
  private readonly bodies: Body[] = []
  private readonly local = emptyEclipseData()
  private readonly rotation = new Quaternion()
  private readonly scratch = new Vector3()

  public constructor(
    private readonly atmosphereRegistry?: AtmosphereRegistry,
    private readonly starRadiusKmOf: (model: Actor) => number | undefined = resolveStarRadiusKm
  ) {}

  public register(node: EclipseBodyNode): void {
    const model = node.model
    const name = String(model.getAttribute?.('name', '?') ?? '?')
    const radiusKm = Number(model.physicalObject?.getAttribute('radius') ?? 0)
    const starKm = this.starRadiusKmOf(model)
    const atmActor = model.children.where('categoryId', ATMOSPHERE_CATEGORY_ID).first() as Actor | undefined
    const atmConfig = atmActor ? readRenderingData<AtmosphereConfig>(atmActor) : undefined
    const umbra = atmConfig
      ? { tint: umbraTintFromAtmosphere(atmConfig), glow: resolveUmbraGlow(readRenderingData<IPlanetRenderingObject>(model), name) }
      : undefined
    this.bodies.push({
      node,
      actorId: Number(model.getAttribute('id', -1)),
      radiusUnits: toThreeJSUnits(radiusKm),
      starRadiusUnits: starKm === undefined ? undefined : toThreeJSUnits(starKm),
      umbra,
      center: new Vector3()
    })
  }

  public clear(): void {
    this.bodies.length = 0
  }

  public update(): void {
    for (const b of this.bodies) {
      b.node.updateWorldMatrix(true, false)
      b.node.getWorldPosition(b.center)
    }
    const candidates: Candidate[] = this.bodies.map((b) => ({ center: b.center.toArray() as Vec3, radius: b.radiusUnits, actorId: b.actorId }))

    for (const b of this.bodies) {
      const picked =
        b.starRadiusUnits === undefined
          ? []
          : selectOccluders(b.center.toArray() as Vec3, b.radiusUnits, b.starRadiusUnits, candidates, b.actorId)
      this.applyTo(b, picked)
    }
  }

  private applyTo(b: Body, picked: number[]): void {
    const occluders: Occluder[] = picked.map((i) => ({
      center: this.bodies[i].center.clone().sub(b.center).toArray() as Vec3,
      radius: this.bodies[i].radiusUnits,
      umbra: this.bodies[i].umbra
    }))
    const starRel = b.center.clone().negate()
    const starRadius = b.starRadiusUnits ?? 0

    // Поверхность и вода: система тела (обратный мировой поворот поверхности), юниты
    const surface = b.node.renderable
    if (surface) {
      surface.getWorldQuaternion(this.rotation).invert()
      this.fill(this.local, occluders, starRel, starRadius, (v) => v.applyQuaternion(this.rotation))
      ;(surface as unknown as { material?: { setEclipse?: (d: EclipseUniformData) => void } }).material?.setEclipse?.(this.local)
      for (const child of surface.children) {
        ;(child as unknown as { material?: { setEclipse?: (d: EclipseUniformData) => void } }).material?.setEclipse?.(this.local)
      }
    }

    // Атмосфера тела: мировые оси, км
    if (this.atmosphereRegistry) {
      for (const entry of this.atmosphereRegistry.entries()) {
        if (entry.bodyActorId !== b.actorId) continue
        entry.eclipse ??= emptyEclipseData()
        this.fill(entry.eclipse, occluders, starRel, starRadius, (v) => v.multiplyScalar(1 / SpaceScale), 1 / SpaceScale)
      }
    }

    // Точка-импостор: CPU-свет в центре тела
    const lod = b.node.children.find((c): c is LOD => c instanceof LOD)
    const fake = lod?.levels.map((l) => l.object).find((o) => (o as { isFakePlanet?: boolean }).isFakePlanet) as
      | (Object3D & { eclipseLight: Color })
      | undefined
    if (fake) {
      const light = starRadius > 0 ? eclipseLightCpu([0, 0, 0], starRel.toArray() as Vec3, starRadius, occluders) : [1, 1, 1]
      fake.eclipseLight.setRGB(light[0], light[1], light[2])
    }
  }

  // Центры и радиусы в данные шейдера; transform переводит вектор в целевую систему, scale — радиусы
  private fill(
    out: EclipseUniformData,
    occluders: Occluder[],
    starRel: Vector3,
    starRadius: number,
    transform: (v: Vector3) => Vector3,
    scale = 1
  ): void {
    out.count = starRadius > 0 ? occluders.length : 0
    for (let i = 0; i < out.occluders.length; i++) {
      const o = occluders[i]
      if (o) {
        transform(this.scratch.fromArray(o.center))
        out.occluders[i].set(this.scratch.x, this.scratch.y, this.scratch.z, o.radius * scale)
        out.umbra[i].set(o.umbra?.tint[0] ?? 0, o.umbra?.tint[1] ?? 0, o.umbra?.tint[2] ?? 0, o.umbra?.glow ?? 0)
      } else {
        out.occluders[i].set(0, 0, 0, 0)
        out.umbra[i].set(0, 0, 0, 0)
      }
    }
    out.star.copy(transform(this.scratch.copy(starRel)))
    out.starRadius = starRadius * scale
  }
}
