import {
  BufferGeometry, DoubleSide, MathUtils, Mesh, NormalBlending,
  PerspectiveCamera, ShaderMaterial, UniformsUtils, Vector3, WebGLRenderer
} from 'three'
import { starActivityFor } from '@/core/renderables/utils/starActivity'
import { Actor } from '@/core/models/Actor'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { StarOuterLayerShaderTemplate } from '@/core/materials/shaders/lib/StarOuterLayerShaderTemplate'
import { UpdateContext } from '@/core/UpdateContext'
import { buildStarPalette, DEFAULT_STAR_TEMPERATURE_K, StarPalette } from '@/core/materials/shaders/lib/helpers'
import { buildProminenceGeometry, PROMINENCE_RIBBON_COUNT } from '@/core/renderables/utils/prominenceGeometry'
import { apparentSizeAtDistance } from '@/core/helpers/apparentSize'

// Полностью погасить задолго до стыка импостора (~12.6 px с гистерезисом).
const FADE_START_PIXELS = 32
const FULL_DETAIL_PIXELS = 256

/**
 * Петлевые протуберанцы звезды: ленты-дуги, растущие из поверхности группами
 * и гаснущие по мере роста. Геометрию строит buildProminenceGeometry, вид —
 * StarOuterLayerShaderTemplate. Плотность растёт с экранным размером,
 * активность непрерывно управляет яркостью.
 */
class StarOuterLayer extends Mesh {
  public model: Actor
  declare public geometry: BufferGeometry
  declare public material: ShaderMaterial

  private readonly radius: number
  private readonly activity: number
  private readonly worldPosition = new Vector3()
  private readonly cameraPosition = new Vector3()

  public constructor(model: Actor, private readonly renderer: WebGLRenderer) {
    super()
    this.model = model

    this.radius = toThreeJSUnits(this.model.physicalObject?.getAttribute('radius') ?? 0)
    this.activity = starActivityFor(this.model)

    this.__setup()
  }

  __setup(): void {
    // Протуберанцы — конвективная активность: у горячих звёзд (лучистая
    // оболочка) слоя нет — ни лент, ни рисования
    if (this.activity <= 0) {
      this.geometry = new BufferGeometry()
      // Юниформы шаблона на месте: включение слоя извне не уронит кадр
      this.material = new ShaderMaterial({ uniforms: UniformsUtils.clone(StarOuterLayerShaderTemplate.uniforms) })
      this.visible = false
      return
    }

    // Ленты строятся на единичной сфере — мировой размер даёт scale ниже
    this.geometry = buildProminenceGeometry()

    // Юниформы клонируются: шаблонные объекты общие на модуль, а палитра
    // пер-звёздная (двойная система с разными температурами)
    this.material = new ShaderMaterial({
      vertexShader: StarOuterLayerShaderTemplate.vertexShader,
      fragmentShader: StarOuterLayerShaderTemplate.fragmentShader,
      uniforms: UniformsUtils.clone(StarOuterLayerShaderTemplate.uniforms),
      transparent: true,
      premultipliedAlpha: true,
      depthTest: true,
      depthWrite: false,
      side: DoubleSide,
      blending: NormalBlending
    })

    // Дефолт общий с диском и билбордом: свой (3000K) красил бы протуберанцы
    // звезды без температуры в красный при солнечном диске
    const temperature: number =
      this.model.physicalObject?.getAttribute('temperature', DEFAULT_STAR_TEMPERATURE_K) ?? DEFAULT_STAR_TEMPERATURE_K
    const palette: StarPalette = buildStarPalette(temperature, 1500)
    this.material.uniforms.uColorCool.value.setRGB(palette.cool.r, palette.cool.g, palette.cool.b)
    this.material.uniforms.uColorBase.value.setRGB(palette.base.r, palette.base.g, palette.base.b)
    this.material.uniforms.uOpacity.value *= this.activity
    this.material.uniforms.uVisibleRibbons.value = PROMINENCE_RIBBON_COUNT

    // Атрибута position у лент нет — three нечем посчитать bounding sphere,
    // поэтому отсечение по фрустуму выключено
    this.frustumCulled = false
    this.scale.multiplyScalar(this.radius)
  }

  public updateObject(ctx: UpdateContext): void {
    // Вдали слой скрыт, но его фаза должна быть свежей в первом кадре подлёта.
    if (this.activity <= 0) return
    this.material.uniforms.uTime.value = ctx.elapsed * 0.009
  }

  public updateView(camera: PerspectiveCamera): void {
    if (this.activity <= 0) return

    const distance = this.getWorldPosition(this.worldPosition).distanceTo(camera.getWorldPosition(this.cameraPosition))
    const pixels = apparentSizeAtDistance(2 * this.radius, distance, camera.fov, this.renderer.domElement.height)
    const ribbons = PROMINENCE_RIBBON_COUNT * MathUtils.smoothstep(pixels, FADE_START_PIXELS, FULL_DETAIL_PIXELS)
    const indicesPerRibbon = this.geometry.index!.count / PROMINENCE_RIBBON_COUNT

    // Порядок индексов распределяет первые N лент по всему набору арок.
    // Дробная последняя лента гасится шейдером; ceil не даёт скачка при её
    // добавлении/удалении. Буферы и основания петель остаются прежними.
    this.material.uniforms.uVisibleRibbons.value = ribbons
    this.geometry.setDrawRange(0, Math.ceil(ribbons) * indicesPerRibbon)
    this.visible = ribbons > 0
  }
}

export { StarOuterLayer }
