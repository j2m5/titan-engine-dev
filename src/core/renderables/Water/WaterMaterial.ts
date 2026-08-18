import { ShaderMaterialParameters } from 'three/src/materials/ShaderMaterial'
import { Texture } from 'three'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { Actor } from '@/core/models/Actor'
import { WaterShader } from '@/core/materials/shaders/WaterShader'
import { resourceStorage } from '@/core/services/ResourceStorage'

/**
 * Материал водной оболочки — честный шейдер (Task 4): цвет глубокой/мелкой
 * воды, аналитический Френель (нормаль = dir̂, геометрия патча радиальна
 * везде, см. terrainPatchGeometry), мелководье из канала A slope-карты суши
 * ТОГО ЖЕ актора (Task 1 — глубина воды запечена туда отдельно от R/G
 * уклона и B cavity, декод напрямую [0,1]).
 *
 * transparent+depthWrite:false — берег даёт буфер глубины сам (пересечение
 * рельефа и оболочки), без масок и швов; вода не должна перекрывать
 * z-порядок того, что уже нарисовано под ней. depthTest остаётся включённым —
 * вода за рельефом (с обратной стороны тела) не рисуется поверх него.
 */
class WaterMaterial extends AbstractShaderMaterial {
  public model: Actor

  /** Снимок дефайнов конструирования — см. PlanetMaterial.baseDefines, тот же приём. */
  private readonly baseDefines: Record<string, unknown>

  /**
   * Последний известный гейт USE_WATER_DEPTH — updateMaterial зовётся КАЖДЫЙ
   * кадр (WaterSphere.onVisibleUpdate, slope стримится асинхронно и может
   * догрузиться в любой момент жизни оболочки, не только при конструировании
   * — ResourceObserver её не видит, см. докблок WaterSphere/task-3-report).
   * needsUpdate=true пересобирает шейдерную программу — дорого; без этого
   * флага каждый кадр триггерил бы перекомпиляцию ВНЕ зависимости от того,
   * поменялось ли вообще что-то. Флаг переключается только на фактической
   * смене гейта, не на каждом попадании текстуры в хранилище.
   */
  private hasWaterDepth = false

  public constructor(model: Actor, parameters?: ShaderMaterialParameters) {
    super({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      ...parameters
    })
    this.model = model

    const { uniforms, defines, vertexShader, fragmentShader } = new WaterShader(this.model)

    this.uniforms = uniforms
    this.vertexShader = vertexShader
    this.fragmentShader = fragmentShader
    this.defines = defines
    this.baseDefines = { ...defines }
  }

  /**
   * Перечитывает slope-текстуру актора из resourceStorage по тому же пути,
   * что PlanetMaterial берёт под bumpMap (см. её updateMaterial) — общий
   * реестр, WaterMaterial не грузит ничего сам. Текстура может быть ещё не
   * догружена (streamable) — тогда сэмплер остаётся null и USE_WATER_DEPTH
   * не ставится (константный режим шаблона, см. WaterShaderTemplate).
   */
  public updateMaterial(): void {
    const slopePath = this.model.resources.where('resourceType', 'slope').first()?.getAttribute('path')
    const slopeMap: Texture | undefined = typeof slopePath === 'string' ? resourceStorage.getTexture(slopePath) : undefined

    this.uniforms.uSlopeMap.value = slopeMap ?? null

    const useWaterDepth = Boolean(slopeMap)
    if (useWaterDepth === this.hasWaterDepth) return // гейт не изменился — перекомпиляция не нужна

    this.hasWaterDepth = useWaterDepth
    this.defines = {
      ...this.baseDefines,
      ...(useWaterDepth && { USE_WATER_DEPTH: '1' })
    }
    this.needsUpdate = true
  }

  public resetMaterial(): void {
    this.uniforms.uSlopeMap.value = null
    this.hasWaterDepth = false
    this.defines = { ...this.baseDefines }
    this.needsUpdate = true
  }
}

export { WaterMaterial }
