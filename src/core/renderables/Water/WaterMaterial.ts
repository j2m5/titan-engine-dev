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

  /**
   * slope-путь актора — резолвится ОДИН раз (конструктор, освежается в
   * resetMaterial), не на каждый кадр. `resources.where(...).first()` —
   * ORM-джойн belongsToMany (actorResource × resources, фильтр по сотням
   * строк + аллокации моделей/коллекций на каждый вызов), а updateMaterial
   * зовётся КАЖДЫЙ активный кадр (WaterSphere.onVisibleUpdate) — гонять
   * полный джойн ради значения, которое для одного актора не меняется
   * (строки БД статичны), было бы платить его за каждое видимое водное тело
   * каждый кадр впустую (находка ревью Task 4, фикс-раунд 1, №1). resetMaterial
   * — редкий путь (ResourceObserver.evictPath зовёт его только при вытеснении
   * диффуза, не каждый кадр) — там передержка джойна безвредна и держит
   * инвариант «путь в памяти = путь в БД» на случай будущей смены набора
   * ресурсов актора в рантайме (сейчас такого не бывает).
   */
  private slopePath: string | undefined

  /**
   * Путь waterNormal-текстуры актора — резолвится ОДИН раз в конструкторе,
   * та же экономия ORM-джойна, что и slopePath (см. её докблок): гейт
   * USE_WATER_WAVES проверяется каждый активный кадр (updateMaterial),
   * повторный `resources.where(...)` на каждый кадр был бы тем же найденным
   * находкой ревью Task 4 расходом, только для второго ресурса.
   */
  private waterNormalPath: string | undefined

  /** Последний известный гейт USE_WATER_WAVES — тот же приём, что hasWaterDepth (needsUpdate только на фактической смене). */
  private hasWaterWaves = false

  public constructor(model: Actor, parameters?: ShaderMaterialParameters) {
    super({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      ...parameters
    })
    this.model = model
    this.slopePath = WaterMaterial.resolveSlopePath(model)
    this.waterNormalPath = WaterMaterial.resolveWaterNormalPath(model)

    const { uniforms, defines, vertexShader, fragmentShader } = new WaterShader(this.model)

    this.uniforms = uniforms
    this.vertexShader = vertexShader
    this.fragmentShader = fragmentShader
    this.defines = defines
    this.baseDefines = { ...defines }
  }

  private static resolveSlopePath(model: Actor): string | undefined {
    const path = model.resources.where('resourceType', 'slope').first()?.getAttribute('path')

    return typeof path === 'string' ? path : undefined
  }

  private static resolveWaterNormalPath(model: Actor): string | undefined {
    const path = model.resources.where('resourceType', 'waterNormal').first()?.getAttribute('path')

    return typeof path === 'string' ? path : undefined
  }

  /**
   * Перечитывает slope-текстуру актора из resourceStorage по закешированному
   * пути (см. slopePath) — тот же реестр, что PlanetMaterial берёт под
   * bumpMap, но без повторного ORM-джойна на каждый кадр. Текстура может
   * быть ещё не догружена (streamable) — тогда сэмплер остаётся null и
   * USE_WATER_DEPTH не ставится (константный режим шаблона, см.
   * WaterShaderTemplate). Гейт не переспрашивает hasHeightField (в отличие
   * от PlanetMaterial.useSlope) — WaterSphere существует только когда
   * RenderableFactory.createPlanet уже проверил обе ручки разом (высота И
   * waterLevelMeters, см. её докблок), дублировать проверку тут незачем.
   *
   * Диагностика для Task 6: тело с waterLevelMeters, чья slope-карта ещё НЕ
   * пересобрана с флагом --water-level-meters (Task 1), несёт 3-канальную
   * (RGB) текстуру — GPU-сэмплер `.a` такой текстуры отдаёт 1.0 по спеке
   * WebGL (нет альфа-плейна = непрозрачно), а не «канала нет». Гейт по факту
   * ставится (текстура ЕСТЬ в реестре), но depthA≡1.0 везде — визуально это
   * совпадает с константным режимом (mix(shallow,deep,1)=deep), однако кодовый
   * путь другой (USE_WATER_DEPTH=1, не #else) — если понадобится отличать
   * «карты нет» от «карта старого формата», нужен отдельный маркер не отсюда.
   *
   * `elapsed` — секунды с запуска часов рендера (`UpdateContext.elapsed`,
   * см. WaterSphere.onVisibleUpdate), не `performance.now()` напрямую
   * (фикс-раунд 1, №3 ревью: докблок `UpdateContext` прямо запрещает
   * материалам брать время в обход контекста — тот же приём, что
   * `NebulaRaymarchMaterial.updateMaterial(elapsed)`). Дефолт 0 — вызовы без
   * аргумента (существующие тесты гейтов) остаются валидны, `uTime` просто
   * не продвигается.
   *
   * Без сворачивания (`epoch - floor(epoch/wrap)*wrap`, как у
   * BlackHoleMaterial): там wrap кратен РЕАЛЬНОМУ периоду вращения диска —
   * физически осмысленная граница. Здесь делители времени — авторские
   * художественные константы (см. WaterShaderTemplate.getNoise), их НОК на
   * порядки больше любой разумной длины сессии, и общий делитель нашёлся бы
   * только у 3 из 8 — сворачивание на такой границе давало бы фазовый скачок
   * у 5 октав из 8, а не «честную» точку. Float32 на реальных длинах сессий
   * (часы, не годы) даёт суб-миллисекундную ошибку — незаметно для волн.
   */
  public updateMaterial(elapsed: number = 0): void {
    const slopeMap: Texture | undefined = this.slopePath ? resourceStorage.getTexture(this.slopePath) : undefined

    this.uniforms.uSlopeMap.value = slopeMap ?? null

    const useWaterDepth = Boolean(slopeMap)

    // waterNormal — независимый гейт (USE_WATER_WAVES), тот же ленивый
    // стрим-паттерн, что slope: путь закеширован конструктором, текстура
    // может догрузиться в resourceStorage в любой момент жизни оболочки.
    const waterNormalMap: Texture | undefined = this.waterNormalPath
      ? resourceStorage.getTexture(this.waterNormalPath)
      : undefined

    this.uniforms.uWaterNormalMap.value = waterNormalMap ?? null

    const useWaterWaves = Boolean(waterNormalMap)

    // uTime — КАЖДЫЙ активный кадр, независимо от того, поменялся ли
    // какой-либо гейт (иначе волны замирали бы всякий раз, когда
    // updateMaterial рано выходит по неизменным гейтам ниже). Дешёвая
    // uniform-запись, needsUpdate/перекомпиляцию не трогает.
    this.uniforms.uTime.value = elapsed

    if (useWaterDepth === this.hasWaterDepth && useWaterWaves === this.hasWaterWaves) return // ни один гейт не изменился — перекомпиляция не нужна

    this.hasWaterDepth = useWaterDepth
    this.hasWaterWaves = useWaterWaves
    this.defines = {
      ...this.baseDefines,
      ...(useWaterDepth && { USE_WATER_DEPTH: '1' }),
      ...(useWaterWaves && { USE_WATER_WAVES: '1' })
    }
    this.needsUpdate = true
  }

  public resetMaterial(): void {
    this.slopePath = WaterMaterial.resolveSlopePath(this.model)
    this.waterNormalPath = WaterMaterial.resolveWaterNormalPath(this.model)
    this.uniforms.uSlopeMap.value = null
    this.uniforms.uWaterNormalMap.value = null
    this.hasWaterDepth = false
    this.hasWaterWaves = false
    this.defines = { ...this.baseDefines }
    this.needsUpdate = true
  }
}

export { WaterMaterial }
