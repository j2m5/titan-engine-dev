import { Frustum, Matrix4, Sphere, Vector3 } from 'three'
import { SectorGrid, SectorInfo, SectorBounds } from './SectorGrid'
import { AsteroidGenerator, archetypeForInstance } from './AsteroidGenerator'
import { InstancePool, LODLevel, Allocation } from './InstancePool'

/**
 * Конфигурация LOD-порогов
 */
interface LODThresholds {
  /** Максимальное расстояние для L0 (реальная геометрия, обычный detail) */
  l0MaxDistance: number
  /** Максимальное расстояние для L1 (billboards) — дальше ничего не грузим */
  l1MaxDistance: number
  /**
   * Порог ВХОДА в Near (ближний тир повышенной детализации), по distClosest
   * (расстояние до БЛИЖАЙШЕЙ точки сектора, см. update()). Сектор входит в
   * Near, когда ещё не был в нём и distClosest опустился до этого порога.
   */
  nearEnterDistance: number
  /**
   * Порог ВЫХОДА из Near, по distClosest. ОБЯЗАН быть > nearEnterDistance —
   * гистерезис (зазор между порогами) не даёт сектору, чья дистанция
   * колеблется у границы, флипать LOD каждый кадр (стейтлес-порог осциллирует
   * → вечные кросс-фейды, см. update()).
   */
  nearExitDistance: number
}

/**
 * Уходящий LOD-тир во время кросс-фейда: гаснет к 0 параллельно с проявлением
 * нового, затем его аллокация освобождается.
 */
interface OutgoingLOD {
  lodLevel: LODLevel
  /** Geometry: до K суб-аллокаций (по одной на непустой архетип-стрим); Billboard: одна. */
  allocations: Allocation[]
  fade: number
}

/**
 * Состояние активного сектора
 */
interface SectorState {
  key: string
  info: SectorInfo
  lodLevel: LODLevel
  /** Geometry: до K суб-аллокаций (по одной на непустой архетип-стрим); Billboard: одна. */
  allocations: Allocation[]
  /** Текущее значение fade (0 = невидим, 1 = полностью виден) */
  fade: number
  /** Целевое значение fade */
  fadeTarget: number
  /** Помечен для удаления после завершения fade-out */
  pendingRemoval: boolean
  /** Уходящий тир во время кросс-фейда смены LOD (null вне перехода) */
  outgoing: OutgoingLOD | null
}

/**
 * SectorManager — управляет жизненным циклом активных секторов.
 *
 * Каждый кадр:
 * 1. Определяет какие секторы должны быть видны (на основе позиции камеры + frustum)
 * 2. Рассчитывает LOD-уровень для каждого (L0 Geometry / L1 Billboard)
 * 3. Активирует новые секторы (с бюджетом — не более N за кадр)
 * 4. Деактивирует ушедшие за пределы видимости
 * 5. Обрабатывает fade-переходы
 * 6. При смене LOD — переключает сектор между буферами
 */
class SectorManager {
  private grid: SectorGrid
  private generator: AsteroidGenerator
  private pool: InstancePool
  private thresholds: LODThresholds

  /** Активные секторы: key → state */
  private activeSectors: Map<string, SectorState> = new Map()

  /** Максимальное количество секторов, активируемых за один кадр */
  private readonly activationBudget: number = 4

  /** Скорость fade (доля за секунду, 1.0 = полный fade за 1 секунду) */
  private readonly fadeSpeed: number = 4.0

  /**
   * Множитель плотности instances per sector для каждого LOD. GeometryNear
   * зеркалит Geometry (тот же реальный меш, другой detail, без изменения
   * количества камней сектора — только detail апгрейдится).
   *
   * Множители ОБЯЗАНЫ совпадать, и это не стилистика. Генератор потребляет
   * rng строго последовательно по индексу инстанса, поэтому камни 0..N-1 при
   * любом count выходят байт-в-байт одинаковыми. Если у билборда множитель
   * больше, лишний хвост N..M-1 существует ТОЛЬКО как импостор: геометрического
   * двойника у него нет, и на переходе L1 → L0 он гаснет вместе с уходящим
   * тиром и не возвращается. Так и выглядел баг «камень исчезает при
   * приближении» — при 1.5 у билборда пропадала треть камней сектора.
   *
   * Если захочется набить плотность вдали дешёвыми билбордами — надбавку
   * придётся гасить по расстоянию ДО переключения тира, а не в его момент;
   * простым поднятием множителя это не делается.
   */
  private readonly lodDensityMultiplier = {
    [LODLevel.Geometry]: 1.0,
    [LODLevel.GeometryNear]: 1.0,
    [LODLevel.Billboard]: 1.0
  }

  // Reusable objects
  private readonly _frustum = new Frustum()
  private readonly _sphere = new Sphere()
  private readonly _worldCenter = new Vector3()

  public constructor(grid: SectorGrid, generator: AsteroidGenerator, pool: InstancePool, thresholds: LODThresholds) {
    if (thresholds.nearEnterDistance >= thresholds.nearExitDistance) {
      throw new Error(
        `SectorManager: nearEnterDistance (${thresholds.nearEnterDistance}) обязан быть < nearExitDistance ` +
          `(${thresholds.nearExitDistance}) — без зазора между порогами вход/выход осциллировали бы на границе.`
      )
    }

    this.grid = grid
    this.generator = generator
    this.pool = pool
    this.thresholds = thresholds
  }

  /**
   * Аллоцировать и заполнить суб-аллокации Geometry-пути (обычный detail ИЛИ
   * Near, повышенный detail — обе раскладки по K архетипам идентичны,
   * различается только базовый индекс стрима).
   *
   * Счётчики групп по архетипам считаются через archetypeForInstance ДО каких-
   * либо аллокаций (независимо от rng-потока генератора — см. комментарий над
   * archetypeForInstance) — иначе смена K сдвигала бы позиции камней. Затем по
   * каждому НЕПУСТОМУ стриму k вызывается pool.allocate(streamBase + k,
   * groupCount[k]) — streamBase = 0 для Geometry, pool.nearStreamBase для
   * Near: камень СОХРАНЯЕТ архетип (тот же k) при смене detail-тира, меняется
   * только то, в какую половину стримов (Geometry/Near) он попадает.
   *
   * ЛЮБОЙ отказ (нехватка места в одном из стримов) → откатываем (release) уже
   * выделенные суб-аллокации этой попытки и возвращаем null — сектор/переход
   * целиком не активируется (прежняя семантика молчаливого отказа, видимая
   * через getPressureInfo().failures).
   */
  private allocateGeometryGroups(
    streamBase: number,
    seed: number,
    count: number,
    bounds: SectorBounds
  ): Allocation[] | null {
    const archetypeCount = this.pool.geometryStreamCount
    const groupCounts = new Array<number>(archetypeCount).fill(0)
    for (let i = 0; i < count; i++) {
      groupCounts[archetypeForInstance(seed, i, archetypeCount)]++
    }

    const allocations: Allocation[] = []
    for (let k = 0; k < archetypeCount; k++) {
      if (groupCounts[k] === 0) continue

      const allocation = this.pool.allocate(streamBase + k, groupCounts[k])
      if (!allocation) {
        for (const a of allocations) this.pool.release(a)
        return null
      }
      allocations.push(allocation)
    }

    const groups = this.generator.generateMatricesGrouped(seed, count, bounds, archetypeCount)
    for (const allocation of allocations) {
      const k = allocation.stream - streamBase
      this.pool.writeMatrices(allocation.stream, allocation.offset, groups[k])
      // Стартуем невидимым — updateFades плавно поднимет fade к 1.
      this.pool.writeFade(allocation.stream, allocation.offset, allocation.count, 0.0)
    }

    return allocations
  }

  /**
   * Аллоцировать суб-аллокации для заданного LOD-уровня. Billboard — как
   * раньше, один стрим (pool.billboardStream), generateMatrices (не
   * группированный); Geometry/GeometryNear — раскладка по K архетипам (см.
   * allocateGeometryGroups), различается только базовый индекс стрима.
   */
  private allocateForLOD(lodLevel: LODLevel, seed: number, count: number, bounds: SectorBounds): Allocation[] | null {
    if (lodLevel === LODLevel.Geometry) {
      return this.allocateGeometryGroups(0, seed, count, bounds)
    }
    if (lodLevel === LODLevel.GeometryNear) {
      return this.allocateGeometryGroups(this.pool.nearStreamBase, seed, count, bounds)
    }

    const stream = this.pool.billboardStream
    const allocation = this.pool.allocate(stream, count)
    if (!allocation) return null

    const data = this.generator.generateMatrices(seed, count, bounds)
    this.pool.writeMatrices(stream, allocation.offset, data)
    this.pool.writeFade(stream, allocation.offset, allocation.count, 0.0)

    return [allocation]
  }

  /**
   * Основной метод обновления. Вызывается каждый кадр.
   *
   * @param cameraAngle — угол камеры в полярных координатах (radians) в local space кольца
   * @param cameraRadius — расстояние камеры от центра кольца в local space
   * @param viewProjectionMatrix — camera.projectionMatrix * camera.matrixWorldInverse
   * @param localToWorldMatrix — матрица трансформации системы (local → world)
   * @param delta — время с прошлого кадра (секунды)
   */
  public update(
    cameraAngle: number,
    cameraRadius: number,
    viewProjectionMatrix: Matrix4,
    localToWorldMatrix: Matrix4,
    delta: number
  ): void {
    // 1. Подготовить frustum
    this._frustum.setFromProjectionMatrix(viewProjectionMatrix)

    // 2. Получить кандидатов из сетки
    const maxRange = this.thresholds.l1MaxDistance
    const candidates = this.grid.getSectorsInRange(cameraAngle, cameraRadius, maxRange)

    // 3. Определить LOD и отфильтровать по frustum
    const desiredSectors = new Map<string, { info: SectorInfo; lod: LODLevel }>()

    const camX = Math.cos(cameraAngle) * cameraRadius
    const camZ = Math.sin(cameraAngle) * cameraRadius

    for (const info of candidates) {
      // A-lite: пустотные сектора (радиальный профиль дал вес ~0 → instanceCount 0)
      // не генерируем вовсе. Уже активный сектор, ставший пустотным (профиль
      // подгрузился), выпадет из desired → плавно погаснет.
      if (info.instanceCount <= 0) continue

      const dx = info.centerX - camX
      const dz = info.centerZ - camZ
      const dist = Math.sqrt(dx * dx + dz * dz)
      // Расстояние до БЛИЖАЙШЕЙ точки сектора, не до центра: info.boundingRadius
      // (полудиагональ ячейки) обычно уже сравним с разумным порогом входа в
      // Near — порог по dist-до-центра в такой геометрии никогда бы не
      // сработал (подтверждено подкраской в дебаге). distClosest — грубая, но
      // достаточная оценка (сектор не сфера, но boundingRadius её описывает).
      const distClosest = Math.max(0, dist - info.boundingRadius)

      // Гистерезис входа/выхода в Near: сектор, УЖЕ находящийся в Near, остаётся
      // в нём пока distClosest <= nearExitDistance; иначе входит в Near только
      // при distClosest <= nearEnterDistance (порог входа < порог выхода —
      // проверено в конструкторе). Без зазора между порогами стейтлес-порог у
      // границы осциллировал бы каждый кадр → вечные кросс-фейды Near↔Geometry.
      const existingForLod = this.activeSectors.get(info.key)
      const alreadyNear = existingForLod?.lodLevel === LODLevel.GeometryNear && !existingForLod.pendingRemoval

      // Определить LOD (по возрастанию расстояния: Near → L0 → billboard)
      let lod: LODLevel
      if (alreadyNear && distClosest <= this.thresholds.nearExitDistance) {
        lod = LODLevel.GeometryNear
      } else if (!alreadyNear && distClosest <= this.thresholds.nearEnterDistance) {
        lod = LODLevel.GeometryNear
      } else if (dist <= this.thresholds.l0MaxDistance) {
        lod = LODLevel.Geometry
      } else if (dist <= this.thresholds.l1MaxDistance) {
        lod = LODLevel.Billboard
      } else {
        continue
      }

      // Frustum culling
      this._worldCenter.set(info.centerX, 0, info.centerZ)
      this._worldCenter.applyMatrix4(localToWorldMatrix)
      this._sphere.set(this._worldCenter, info.boundingRadius)

      if (!this._frustum.intersectsSphere(this._sphere)) {
        continue
      }

      desiredSectors.set(info.key, { info, lod })
    }

    // 4. Diff: определить что активировать/деактивировать/переключить LOD
    const toActivate: { info: SectorInfo; lod: LODLevel }[] = []
    const toChangeLOD: { state: SectorState; newLOD: LODLevel; info: SectorInfo }[] = []

    for (const [key, desired] of desiredSectors) {
      const existing = this.activeSectors.get(key)
      if (!existing) {
        toActivate.push(desired)
      } else if (existing.lodLevel !== desired.lod && !existing.pendingRemoval) {
        toChangeLOD.push({ state: existing, newLOD: desired.lod, info: desired.info })
      } else if (existing.pendingRemoval) {
        existing.pendingRemoval = false
        existing.fadeTarget = 1.0
      }
    }

    // Секторы, которые больше не нужны → пометить для fade-out
    for (const [key, state] of this.activeSectors) {
      if (!desiredSectors.has(key) && !state.pendingRemoval) {
        state.pendingRemoval = true
        state.fadeTarget = 0.0
      }
    }

    // 5. Активация новых секторов (с бюджетом)
    toActivate.sort((a, b) => {
      const distA = (a.info.centerX - camX) ** 2 + (a.info.centerZ - camZ) ** 2
      const distB = (b.info.centerX - camX) ** 2 + (b.info.centerZ - camZ) ** 2
      return distA - distB
    })

    let activated = 0
    for (const { info, lod } of toActivate) {
      if (activated >= this.activationBudget) break
      if (this.activateSector(info, lod)) {
        activated++
      }
    }

    // 6. Смена LOD для существующих секторов
    for (const { state, newLOD, info } of toChangeLOD) {
      this.changeSectorLOD(state, newLOD, info)
    }

    // 7. Обновить fade и удалить завершённые fade-out
    this.updateFades(delta)
  }

  /**
   * Активировать новый сектор.
   */
  private activateSector(info: SectorInfo, lodLevel: LODLevel): boolean {
    const instanceCount = Math.max(1, Math.round(info.instanceCount * this.lodDensityMultiplier[lodLevel]))

    const allocations = this.allocateForLOD(lodLevel, info.seed, instanceCount, info.bounds)
    if (!allocations) {
      return false
    }

    const state: SectorState = {
      key: info.key,
      info,
      lodLevel,
      allocations,
      fade: 0.0,
      fadeTarget: 1.0,
      pendingRemoval: false,
      outgoing: null
    }

    this.activeSectors.set(info.key, state)
    return true
  }

  /**
   * Переключить сектор на другой LOD-уровень через кросс-фейд.
   *
   * Старый тир не освобождается сразу: он уходит в state.outgoing и гаснет к 0
   * параллельно с проявлением нового (с нуля) — оба рендерятся через дизер
   * одновременно, давая встречный кросс-фейд без резкого «щелчка».
   */
  private changeSectorLOD(state: SectorState, newLOD: LODLevel, info: SectorInfo): void {
    const instanceCount = Math.max(1, Math.round(info.instanceCount * this.lodDensityMultiplier[newLOD]))
    const allocations = this.allocateForLOD(newLOD, info.seed, instanceCount, info.bounds)

    if (!allocations) {
      // Нет места под новый тир — оставляем текущий как есть (сектор не теряем).
      return
    }

    // Текущий тир уводим в кросс-фейд-аут. Если предыдущий outgoing ещё жив
    // (быстрый повторный свитч) — освобождаем его целиком: держим максимум 2 тира.
    if (state.outgoing) {
      for (const a of state.outgoing.allocations) this.pool.release(a)
    }
    state.outgoing = {
      lodLevel: state.lodLevel,
      allocations: state.allocations,
      fade: state.fade
    }

    state.lodLevel = newLOD
    state.allocations = allocations
    // Новый тир проявляется с нуля — встречно уходящему (сумма покрытия ≈ 1).
    // fade=0 уже записан в буфер внутри allocateForLOD — повторной записи не требуется.
    state.fade = 0.0
    state.fadeTarget = 1.0
  }

  /**
   * Обновить fade-анимации и удалить полностью погасшие секторы.
   */
  private updateFades(delta: number): void {
    const step = this.fadeSpeed * delta
    const toRemove: string[] = []

    for (const [key, state] of this.activeSectors) {
      if (state.fade !== state.fadeTarget) {
        if (state.fade < state.fadeTarget) {
          state.fade = Math.min(state.fade + step, state.fadeTarget)
        } else {
          state.fade = Math.max(state.fade - step, state.fadeTarget)
        }
        // fade изменился — залить новое значение в per-instance атрибут КАЖДОЙ
        // суб-аллокации сектора. Осевшие секторы (fade == fadeTarget) не трогаем.
        for (const a of state.allocations) {
          this.pool.writeFade(a.stream, a.offset, a.count, state.fade)
        }
      }

      // Кросс-фейд: уходящий тир гаснет к 0, затем освобождается. Пишем fade со
      // ЗНАКОМ МИНУС → шейдер берёт инвертированный дизер, покрытие комплементарно
      // входящему тиру (без «дыр» на середине перехода).
      if (state.outgoing) {
        const out = state.outgoing
        out.fade = Math.max(out.fade - step, 0.0)
        for (const a of out.allocations) {
          this.pool.writeFade(a.stream, a.offset, a.count, -out.fade)
        }
        if (out.fade <= 0.001) {
          for (const a of out.allocations) this.pool.release(a)
          state.outgoing = null
        }
      }

      if (state.pendingRemoval && state.fade <= 0.001) {
        for (const a of state.allocations) this.pool.release(a)
        if (state.outgoing) {
          for (const a of state.outgoing.allocations) this.pool.release(a)
        }
        toRemove.push(key)
      }
    }

    for (const key of toRemove) {
      this.activeSectors.delete(key)
    }
  }

  /**
   * Принудительно деактивировать все секторы.
   */
  public deactivateAll(): void {
    for (const [, state] of this.activeSectors) {
      for (const a of state.allocations) this.pool.release(a)
      if (state.outgoing) {
        for (const a of state.outgoing.allocations) this.pool.release(a)
      }
    }
    this.activeSectors.clear()
  }

  /**
   * Количество активных секторов.
   */
  public get activeCount(): number {
    return this.activeSectors.size
  }

  /**
   * Диагностическая информация.
   */
  public getDebugInfo(): {
    activeSectors: number
    byLod: { l0: number; near: number; l1: number }
    pendingRemoval: number
  } {
    let l0 = 0,
      near = 0,
      l1 = 0,
      pending = 0
    for (const [, state] of this.activeSectors) {
      switch (state.lodLevel) {
        case LODLevel.Geometry:
          l0++
          break
        case LODLevel.GeometryNear:
          near++
          break
        case LODLevel.Billboard:
          l1++
          break
      }
      if (state.pendingRemoval) pending++
    }
    return { activeSectors: this.activeSectors.size, byLod: { l0, near, l1 }, pendingRemoval: pending }
  }
}

export { SectorManager }
export type { LODThresholds, SectorState }
