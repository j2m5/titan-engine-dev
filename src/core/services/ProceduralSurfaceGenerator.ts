import {
  Color,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RepeatWrapping,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Uniform,
  Vector3,
  WebGLRenderTarget,
  type WebGLRenderer
} from 'three'
import { Actor } from '@/core/models/Actor'
import { requireRenderingData } from '@/core/helpers/renderingData'
import { resourceStorage } from '@/core/services/ResourceStorage'
import {
  proceduralDiffuseFragment,
  proceduralDiffuseVertex
} from '@/core/materials/shaders/lib/chunks/ProceduralSurface'
import { seedOffset, validateProceduralSurface } from '@/core/terrain/proceduralSurfaceParams'
import type { IPlanetRenderingObject } from '@/core/models/types'

/**
 * Синтетический ключ текстуры рантайм-диффуза процедурного тела —
 * файловые пути ресурсов всегда без схемы (`planets/...`), поэтому
 * `procedural://` не пересекается ни с одним реальным путём.
 */
export function proceduralDiffuseKey(actorId: number): string {
  return `procedural://${actorId}/diffuse`
}

/**
 * Лестница разрешения рантайм-диффуза по радиусу тела (км). Дублирует
 * `scripts/lib/batchBodyRules.ts::resolutionCeiling` — импорт из scripts в
 * src запрещён (граница пакетов скрипт/движок), а сама лестница здесь
 * своя, под размер полноэкранного диффуза, а не потолок исходной карты
 * батча: три ступени вместо потолка. Менять синхронно с ревью лестницы
 * батча, если она пересматривается.
 */
function resolutionFor(radiusKm: number): [width: number, height: number] {
  if (radiusKm >= 1000) return [4096, 2048]
  if (radiusKm >= 200) return [2048, 1024]

  return [1024, 512]
}

/**
 * Рантайм-генератор диффуза процедурных тел: одно сидированное fBM-поле
 * (см. proceduralSurfaceParams.ts / ProceduralSurface.ts) рендерится
 * полноэкранным проходом в WebGLRenderTarget, результат регистрируется в
 * `resourceStorage` под синтетическим ключом `proceduralDiffuseKey`.
 *
 * Рендерит один раз на актора: повторный `ensureDiffuse` — no-op по факту
 * присутствия ключа в `resourceStorage`. Владение рендерером — по
 * прецеденту `BrunetonAtmosphere`: конструктор принимает `WebGLRenderer`
 * снаружи (DI), сам его не создаёт и не диспоузит.
 *
 * Палитра пишется в `uPalette` как есть (`new Color(hex)` — линейное
 * значение из sRGB-строки), а таргет помечен `SRGBColorSpace`: тонкая
 * цветопередача палитры — ручка приёмки, не механики генератора.
 */
class ProceduralSurfaceGenerator {
  private readonly targets: Map<number, WebGLRenderTarget> = new Map()

  public constructor(private readonly renderer: WebGLRenderer) {}

  public ensureDiffuse(actor: Actor): string {
    const actorId = actor.getAttribute('id', -1) as number
    const key = proceduralDiffuseKey(actorId)

    if (resourceStorage.isExistsTexture(key)) return key

    const name = actor.getAttribute('name', String(actorId)) as string
    const data = requireRenderingData<IPlanetRenderingObject>(actor, 'ProceduralSurfaceGenerator', name)
    const params = validateProceduralSurface(data.proceduralSurface, name)

    const radiusKm = (actor.physicalObject?.getAttribute('radius') as number | undefined) ?? 0
    const [width, height] = resolutionFor(radiusKm)

    const target = new WebGLRenderTarget(width, height, {
      format: RGBAFormat,
      generateMipmaps: true,
      minFilter: LinearMipmapLinearFilter,
      magFilter: LinearFilter
    })
    target.texture.wrapS = RepeatWrapping
    target.texture.colorSpace = SRGBColorSpace
    target.texture.name = key

    this.render(target, params)

    this.targets.set(actorId, target)
    resourceStorage.addTexture(target.texture)

    return key
  }

  /**
   * Снимает зарегистрированные текстуры и render target'ы всех обслуженных
   * акторов. Инвариант владения teardown-арки: кто создал — тот и чистит;
   * `deleteTexture` уже диспоузит саму текстуру, `target.dispose()` — её
   * GPU-буфер.
   */
  public dispose(): void {
    for (const target of this.targets.values()) {
      resourceStorage.deleteTexture(target.texture.name)
      target.dispose()
    }

    this.targets.clear()
  }

  private render(target: WebGLRenderTarget, params: ReturnType<typeof validateProceduralSurface>): void {
    const offset = seedOffset(params.seed)

    const scene = new Scene()
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const geometry = new PlaneGeometry(2, 2)
    const material = new ShaderMaterial({
      vertexShader: proceduralDiffuseVertex,
      fragmentShader: proceduralDiffuseFragment,
      uniforms: {
        uFieldOffset: new Uniform(new Vector3(offset.x, offset.y, offset.z)),
        uFieldFrequency: new Uniform(params.frequencyPerRadius),
        uFieldOctaves: new Uniform(params.octaves),
        uFieldGain: new Uniform(params.gain),
        uFieldLacunarity: new Uniform(params.lacunarity),
        uFieldContrast: new Uniform(params.contrast),
        uPalette: new Uniform(params.palette.map((hex) => new Color(hex))),
        uAlbedoNoise: new Uniform(params.albedoNoise)
      }
    })
    scene.add(new Mesh(geometry, material))

    const previous = this.renderer.getRenderTarget()
    this.renderer.setRenderTarget(target)
    this.renderer.render(scene, camera)
    this.renderer.setRenderTarget(previous)

    // Квад/материал этого прохода больше не нужны — таргет уже содержит
    // результат, держать их живыми до dispose() генератора незачем.
    material.dispose()
    geometry.dispose()
  }
}

export { ProceduralSurfaceGenerator }
