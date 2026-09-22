import { Frustum, Matrix4, Sphere, Vector3 } from 'three'
import { SectorGrid, SectorInfo, SectorBounds, sectorCenter } from './SectorGrid'
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
  /** Число инстансов тира — снимок state.instanceCount на момент ухода в fade-out, для вычитания из used */
  instanceCount: number
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
  /** Число инстансов ТЕКУЩЕГО тира (state.allocations) — снимок для точного вычитания из used */
  instanceCount: number
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
  private readonly activationBudget: number

  /** Максимум живых экземпляров каскада; Infinity — без ограничения (кольца) */
  private readonly capacityShare: number
  /** Сумма занятых экземпляров по активным секторам каскада (включая уходящий тир кросс-фейда) */
  private used: number = 0
  /** Счётчик отказов активации/смены LOD из-за упора в capacityShare */
  private capacityFailures: number = 0

  /** Скорость fade (доля за секунду, 1.0 = полный fade за 1 секунду) */
  private readonly fadeSpeed: number = 4.0

  /**
   * Множитель плотности инстансов на сектор для каждого LOD.
   *
   * Множители ОБЯЗАНЫ совпадать. Генератор потребляет rng последовательно по
   * индексу инстанса, поэтому камни 0..N-1 при любом count одинаковы; лишний
   * хвост у билборда существовал бы только как импостор и на переходе в
   * геометрию исчезал бы без замены. Набивать плотность вдали дешёвыми
   * билбордами можно только гася надбавку по расстоянию ДО переключения тира.
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
  private readonly _origin = new Vector3()

  /**
   * Плавающее начало системы (ССЫЛКА на FloatingOrigin.origin — обновляется
   * снаружи, мы читаем текущее значение). null — относительных координат нет:
   * матрицы абсолютны, атрибут instanceOrigin остаётся нулевым (кольца).
   */
  private readonly origin: Vector3 | null

  public constructor(
    grid: SectorGrid,
    generator: AsteroidGenerator,
    pool: InstancePool,
    thresholds: LODThresholds,
    origin: Vector3 | null = null,
    capacityShare: number = Infinity,
    activationBudget: number = 4
  ) {
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
    this.origin = origin
    this.capacityShare = capacityShare
    this.activationBudget = activationBudget
  }

  /** Сумма занятых экземпляров активных секторов каскада (для capacityShare) */
  public get usedInstances(): number {
    return this.used
  }

  /**
   * Записать во все инстансы аллокаций смещение сектора от плавающего начала
   * И порог полного затухания билборда СВОЕГО каскада (см.
   * InstancePool.writeMaxDistance) — оба атрибута общие для сектора, второй
   * пишется независимо от наличия плавающего начала (кольца/одиночный каскад
   * тоже получают его, но без USE_CASCADE_FADE_RADIUS шейдер его не читает).
   * Без плавающего начала (кольца) origin остаётся no-op: атрибут нулевой.
   */
  private writeSectorOrigins(allocations: Allocation[], bounds: SectorBounds): void {
    for (const a of allocations) {
      this.pool.writeMaxDistance(a.stream, a.offset, a.count, this.thresholds.l1MaxDistance)
    }

    const origin = this.origin
    if (!origin) return

    const center = sectorCenter(bounds)
    // Вычитание — в double, до float32-записи атрибута: и центр сектора, и
    // начало могут быть десятками а.е., а их разность мала. Y тоже участвует:
    // у объёмной сетки центр ячейки не в средней плоскости, а генератор
    // вычитает его из высоты камня (relativeToSector) — без origin.y камни
    // осели бы к нулю независимо от реальной высоты ячейки.
    this._origin.set(center.x - origin.x, center.y - origin.y, center.z - origin.z)
    for (const a of allocations) {
      this.pool.writeOrigins(a.stream, a.offset, a.count, this._origin)
    }
  }

  /**
   * Переезд плавающего начала: у КАЖДОЙ активной аллокации (включая уходящий
   * тир кросс-фейда — он ещё рисуется) origin пересчитывается от центра её
   * сектора. К моменту вызова FloatingOrigin.origin уже новый, поэтому счёт
   * идёт от абсолютного центра в double — ошибка не накапливается от переезда
   * к переезду, в отличие от вычитания сдвига из хранимого float32.
   *
   * @param shift — сдвиг начала; нулевой означает, что переезда не было
   */
  public rebaseOrigins(shift: Vector3): void {
    if (!this.origin || (shift.x === 0 && shift.z === 0)) return

    for (const [, state] of this.activeSectors) {
      this.writeSectorOrigins(state.allocations, state.info.bounds)
      if (state.outgoing) {
        this.writeSectorOrigins(state.outgoing.allocations, state.info.bounds)
      }
    }
  }

  /**
   * Аллоцировать и заполнить суб-аллокации Geometry-пути (обычный detail ИЛИ
   * Near, повышенный detail — обе раскладки по K архетипам идентичны,
   * различается только базовый индекс стрима).
   *
   * Счётчики групп считаются до аллокаций и без обращения к rng — иначе смена
   * K сдвигала бы позиции камней. Камень сохраняет свой архетип при смене
   * detail-тира, меняется только база стрима.
   *
   * Любой отказ откатывает уже выделенные суб-аллокации и возвращает null:
   * сектор не активируется, отказ виден через getPressureInfo().failures.
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

    this.writeSectorOrigins(allocations, bounds)

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
    this.writeSectorOrigins([allocation], bounds)

    return [allocation]
  }

  /**
   * Основной метод обновления. Вызывается каждый кадр.
   *
   * @param cameraAngle — угол камеры в полярных координатах (radians) в local space кольца
   * @param cameraRadius — расстояние камеры от центра кольца в local space
   * @param cameraY — высота камеры, ring-local Y. Обязательна: у плоской сетки
   * (volumetric false) не влияет на результат, но неявный ноль у объёмной молча
   * подставил бы среднюю плоскость вместо реальной высоты камеры.
   * @param viewProjectionMatrix — camera.projectionMatrix * camera.matrixWorldInverse
   * @param localToWorldMatrix — матрица трансформации системы (local → world)
   * @param delta — время с прошлого кадра (секунды)
   */
  public update(
    cameraAngle: number,
    cameraRadius: number,
    cameraY: number,
    viewProjectionMatrix: Matrix4,
    localToWorldMatrix: Matrix4,
    delta: number
  ): void {
    // 1. Подготовить frustum
    this._frustum.setFromProjectionMatrix(viewProjectionMatrix)

    // 2. Получить кандидатов из сетки
    const maxRange = this.thresholds.l1MaxDistance
    const candidates = this.grid.getSectorsInRange(cameraAngle, cameraRadius, cameraY, maxRange)

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
      // Высота входит только у объёмной сетки: у колец метрика двумерная, как была
      const dy = this.grid.volumetric ? info.centerY - cameraY : 0
      const dist = Math.sqrt(dx * dx + dz * dz + dy * dy)
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
      this._worldCenter.set(info.centerX, info.centerY, info.centerZ)
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

    // 5. Активация новых секторов (с бюджетом). Высота входит только у
    // объёмной сетки — та же оговорка, что и у метрики тира выше.
    toActivate.sort((a, b) => {
      const dyA = this.grid.volumetric ? a.info.centerY - cameraY : 0
      const dyB = this.grid.volumetric ? b.info.centerY - cameraY : 0
      const distA = (a.info.centerX - camX) ** 2 + (a.info.centerZ - camZ) ** 2 + dyA * dyA
      const distB = (b.info.centerX - camX) ** 2 + (b.info.centerZ - camZ) ** 2 + dyB * dyB
      return distA - distB
    })

    let activated = 0
    for (const { info, lod } of toActivate) {
      if (activated >= this.activationBudget) break
      // Упор в долю пула — дальше по списку сектора только дальше от камеры,
      // пробовать их бессмысленно, а счётчик отказов иначе считал бы кандидатов
      if (this.used >= this.capacityShare) {
        this.capacityFailures++
        break
      }
      if (this.activateSector(info, lod)) {
        activated++
      }
    }

    // 6. Смена LOD для существующих секторов — тем же бюджетом, что активация.
    // Каждый переход держит ОБА тира до конца кросс-фейда, поэтому массовый
    // свитч на проходе камеры вынес бы каскад далеко за его долю пула
    toChangeLOD.sort((a, b) => {
      const dyA = this.grid.volumetric ? a.info.centerY - cameraY : 0
      const dyB = this.grid.volumetric ? b.info.centerY - cameraY : 0
      const distA = (a.info.centerX - camX) ** 2 + (a.info.centerZ - camZ) ** 2 + dyA * dyA
      const distB = (b.info.centerX - camX) ** 2 + (b.info.centerZ - camZ) ** 2 + dyB * dyB
      return distA - distB
    })

    let switched = 0
    for (const { state, newLOD, info } of toChangeLOD) {
      if (switched >= this.activationBudget) break
      if (this.changeSectorLOD(state, newLOD, info)) {
        switched++
      }
    }

    // 7. Обновить fade и удалить завершённые fade-out
    this.updateFades(delta)
  }

  /**
   * Активировать новый сектор.
   */
  private activateSector(info: SectorInfo, lodLevel: LODLevel): boolean {
    const instanceCount = Math.max(1, Math.round(info.instanceCount * this.lodDensityMultiplier[lodLevel]))

    // Доля пула каскада — проверка ДО выделения, чтобы не трогать пул зря.
    if (this.used + instanceCount > this.capacityShare) {
      this.capacityFailures++
      return false
    }

    const allocations = this.allocateForLOD(lodLevel, info.seed, instanceCount, info.bounds)
    if (!allocations) {
      return false
    }
    this.used += instanceCount

    const state: SectorState = {
      key: info.key,
      info,
      lodLevel,
      allocations,
      instanceCount,
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
  private changeSectorLOD(state: SectorState, newLOD: LODLevel, info: SectorInfo): boolean {
    const instanceCount = Math.max(1, Math.round(info.instanceCount * this.lodDensityMultiplier[newLOD]))

    // Доля пула по УСТАНОВИВШЕЙСЯ стоимости: на время кросс-фейда сектор держит
    // оба тира, но проверять сумму нельзя — понижение тира, которое ёмкость
    // освобождает, само себя бы и запретило
    if (this.used - state.instanceCount + instanceCount > this.capacityShare) {
      this.capacityFailures++
      return false
    }

    const allocations = this.allocateForLOD(newLOD, info.seed, instanceCount, info.bounds)

    if (!allocations) {
      // Нет места под новый тир — оставляем текущий как есть (сектор не теряем).
      return false
    }

    // Текущий тир уводим в кросс-фейд-аут. Если предыдущий outgoing ещё жив
    // (быстрый повторный свитч) — освобождаем его целиком: держим максимум 2 тира.
    if (state.outgoing) {
      for (const a of state.outgoing.allocations) this.pool.release(a)
      this.used -= state.outgoing.instanceCount
    }
    state.outgoing = {
      lodLevel: state.lodLevel,
      allocations: state.allocations,
      instanceCount: state.instanceCount,
      fade: state.fade
    }

    // used держит ОБА тира на время кросс-фейда: старый (перешёл в outgoing,
    // уже учтён) не вычитается, новый прибавляется — снимется при release() outgoing.
    this.used += instanceCount
    state.lodLevel = newLOD
    state.allocations = allocations
    state.instanceCount = instanceCount
    // Новый тир проявляется с нуля — встречно уходящему (сумма покрытия ≈ 1).
    // fade=0 уже записан в буфер внутри allocateForLOD — повторной записи не требуется.
    state.fade = 0.0
    state.fadeTarget = 1.0

    return true
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
          this.used -= out.instanceCount
          state.outgoing = null
        }
      }

      if (state.pendingRemoval && state.fade <= 0.001) {
        for (const a of state.allocations) this.pool.release(a)
        this.used -= state.instanceCount
        if (state.outgoing) {
          for (const a of state.outgoing.allocations) this.pool.release(a)
          this.used -= state.outgoing.instanceCount
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
    // Живых секторов не осталось — счётчик обнуляется, а не сводится вычитанием:
    // так расхождение, если оно где-то возникнет, не переживёт сброс
    this.used = 0
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
    usedInstances: number
    capacityFailures: number
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
    return {
      activeSectors: this.activeSectors.size,
      byLod: { l0, near, l1 },
      pendingRemoval: pending,
      usedInstances: this.used,
      capacityFailures: this.capacityFailures
    }
  }
}

export { SectorManager }
export type { LODThresholds, SectorState }
