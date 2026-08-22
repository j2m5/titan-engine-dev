import type { AtmosphereEntry, AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'

/**
 * Материал глазами проводки тинта: юниформы, дефайны и флаг рекомпила. Уже
 * структурного ShaderMaterial — проводка не должна уметь ничего сверх этого,
 * а тесты получают голую цель без сеттера-без-геттера needsUpdate у three.
 */
export interface SunTintTarget {
  uniforms: Record<string, { value: unknown }>
  defines: Record<string, unknown>
  needsUpdate: boolean
}

/**
 * Общая проводка закатного тинта: LUT пропускания и геометрия оболочки берутся
 * из AtmosphereRegistry по actorId дочерней атмосферы КАЖДЫЙ видимый кадр —
 * порядок создания узлов сцены (тело раньше атмосферы или наоборот) тогда не
 * важен, а снятие узла само гасит эффект. Рекомпил программы только при смене
 * записи (сравнение по ссылке) — на кадрах без изменений вызов пустой.
 *
 * Радиусы идут из ПОДОГНАННОГО конфига записи (тот же, из которого считались
 * LUT, см. terrainFloorAdjust) — сырая строка БД дала бы другой bottomRadius и
 * рассинхрон с таблицей. Датум — радиус самого тела в КИЛОМЕТРАХ: LUT
 * параметризована километрами, юниты сцены здесь не при чём.
 *
 * Текстура LUT принадлежит узлу атмосферы — материал держит её по ссылке и
 * никогда не диспозит.
 */
export class SunTintBinding {
  /** Запись реестра, по которой сейчас настроены юниформы; сравнение по ссылке решает, нужен ли рекомпил. */
  private entry: AtmosphereEntry | undefined

  /**
   * `atmosphereActorId` undefined — у тела нет дочерней атмосферы, тинт ему не
   * положен. `datumRadiusKm` ≤ 0 (стаб-актор без physicalObject, битые данные)
   * не несёт LUT ни в km, ни в юнитах — эффект гасится тем же путём, что
   * снятие атмосферы из реестра, а не отдельной веткой.
   */
  public constructor(
    private readonly material: SunTintTarget,
    private readonly registry: AtmosphereRegistry | undefined,
    private readonly atmosphereActorId: number | undefined,
    private readonly datumRadiusKm: number
  ) {}

  /** Запись реестра стоит — материалу нужен дефайн USE_SUN_TINT (в том числе при пересборке набора дефайнов с нуля). */
  public get active(): boolean {
    return this.entry !== undefined
  }

  public sync(): void {
    const rawEntry = this.atmosphereActorId !== undefined ? this.registry?.get(this.atmosphereActorId) : undefined
    const entry = this.datumRadiusKm > 0 ? rawEntry : undefined

    if (entry === this.entry) return

    this.entry = entry

    if (entry) {
      this.material.uniforms.uAtmoTransmittance.value = entry.lut.transmittance
      this.material.uniforms.uAtmoBottomRadius.value = entry.config.bottomRadius
      this.material.uniforms.uAtmoTopRadius.value = entry.config.topRadius
      this.material.uniforms.uAtmoSunAngularRadius.value = entry.config.sunAngularRadius
      this.material.uniforms.uAtmoDatumRadius.value = this.datumRadiusKm
      this.material.defines = { ...this.material.defines, USE_SUN_TINT: '1' }
    } else {
      this.material.uniforms.uAtmoTransmittance.value = null

      // Копия без ключа — прежний объект дефайнов мог уйти в ключ программы,
      // мутировать его на месте нельзя.
      const defines = { ...this.material.defines }

      delete defines.USE_SUN_TINT
      this.material.defines = defines
    }

    this.material.needsUpdate = true
  }

  /**
   * Забывает запись — материал сбрасывает свои дефайны к снимку конструирования
   * сам, а снимок про тинт не знает: ближайший sync увидит смену и вернёт
   * дефайн одним рекомпилом. Сэмплер тоже возвращаем в null — снимок defines не
   * несёт юниформы.
   */
  public reset(): void {
    this.entry = undefined
    this.material.uniforms.uAtmoTransmittance.value = null
  }
}
