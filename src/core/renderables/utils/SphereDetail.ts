import type { BufferGeometry, Camera, Mesh, PerspectiveCamera } from 'three'
import { Vector3 } from 'three'
import { config } from '@/core/framework/config'
import { frameCoverage } from '@/core/helpers/apparentSize'
import { buildSphereGeometry, circumscribeFactor, warmSphereTemplate } from '@/core/renderables/utils/sphereGeometry'

export type SphereLevel = 'coarse' | 'dense'

/**
 * Правило гистерезиса: плотная с доли denseCoverage включительно, грубая ниже
 * coarseCoverage, между порогами уровень держится — на границе не дрожит.
 */
export function nextSphereLevel(
  current: SphereLevel,
  coverage: number,
  denseCoverage: number,
  coarseCoverage: number
): SphereLevel {
  if (coverage >= denseCoverage) return 'dense'
  if (coverage < coarseCoverage) return 'coarse'

  return current
}

export interface SphereDetailOptions {
  /** Сегментация плотного уровня — та, что стояла у тела до детализации (256 или 128) */
  denseSegments: number
  /**
   * Описанная сфера только у плотного уровня (сегодня только Planet). Грубый
   * уровень всегда вписан: проход атмосферы обрывает луч на глубине меша и
   * прижимает его к аналитическому дну, только если меш ниже дна, — описанная
   * грубая сфера срезала бы дымку гигантов сеткой 64×64 (до ~20% у вершин).
   */
  circumscribeDense: boolean
}

/**
 * Детализация сферы тела по доле кадра (config sphereDetail): грубая
 * сегментация по умолчанию, плотная — пока тело крупно в кадре. Плотность нужна
 * только силуэту: освещение считается во фрагментах, вершины не смещаются.
 *
 * Конструктор забирает меш себе: геометрия, что была у него, диспозится —
 * владелец передаёт свежий Mesh. Меш всегда владеет ровно одной геометрией:
 * свап ставит новую и диспозит прежнюю, грубая в запасе не держится. Поэтому
 * разборка (disposeSceneTree, dispose() тел) освобождает текущую и ничего не теряет.
 *
 * Свап — ТОЛЬКО в update из updateObject владельца, никогда из onBeforeRender:
 * к onBeforeRender список рендера уже держит прежнюю геометрию, и dispose()
 * посреди прохода отдал бы three удалённые буферы. SceneManager обходит
 * traverse'ом все объекты, в том числе скрытые уровни LOD, — плотная сфера
 * освобождается и после телепорта, и когда тело ушло в импостор.
 *
 * observe — из onBeforeRender владельца: только записывает число. Причина:
 * SceneManager.update (а с ним update) идёт ДО того, как контроллер камеры
 * применит смещение слежения; при большом ускорении времени тело за кадр уходит
 * на миллионы км, и update видит камеру, ещё не доехавшую до тела. В
 * onBeforeRender камера и матрицы финальные — это то, что реально нарисовано.
 */
export class SphereDetail {
  private current: SphereLevel = 'coarse'
  private readonly coarseSegments: number = config('sphereDetail.coarseSegments')
  private readonly denseCoverage: number = config('sphereDetail.denseCoverage')
  private readonly coarseCoverage: number = config('sphereDetail.coarseCoverage')
  private readonly meshWorld: Vector3 = new Vector3()
  private readonly cameraWorld: Vector3 = new Vector3()
  /** Наибольшая доля кадра, замеченная рендером с прошлого update (одноразово) */
  private renderedCoverage: number = 0

  public constructor(
    private readonly mesh: Mesh,
    private readonly radius: number,
    private readonly options: SphereDetailOptions
  ) {
    // Заготовки греются при постройке сцены: первый подлёт сессии платит
    // только копию (~1,3 мс), а не тригонометрию 256×256 (~16 мс)
    warmSphereTemplate(this.coarseSegments)
    warmSphereTemplate(options.denseSegments)
    this.install('coarse')
  }

  public get level(): SphereLevel {
    return this.current
  }

  /**
   * Запись нарисованного кадра — из onBeforeRender, матрицы там свежие
   * (setFromMatrixPosition, а не getWorldPosition). Геометрию не трогает.
   * Неперспективные камеры (тени, отражения) игнорируются.
   */
  public observe(camera: Camera): void {
    const perspective = camera as PerspectiveCamera

    if (!perspective.isPerspectiveCamera) return

    const distance: number = this.meshWorld
      .setFromMatrixPosition(this.mesh.matrixWorld)
      .distanceTo(this.cameraWorld.setFromMatrixPosition(camera.matrixWorld))

    this.renderedCoverage = Math.max(this.renderedCoverage, frameCoverage(this.radius, distance, perspective.fov))
  }

  /**
   * Позиции — через getWorldPosition: он обновляет цепочку матриц, и первый кадр
   * не видит единичную matrixWorld (иначе все тела «стояли бы» в начале
   * координат). Доля считается по истинному радиусу, без описанного множителя.
   * Берётся большая из своего замера и записи рендера; запись одноразовая: тело,
   * не рисовавшееся с прошлого update (скрытый LOD, телепорт), опирается на свой замер.
   */
  public update(camera: PerspectiveCamera): void {
    const distance: number = this.mesh
      .getWorldPosition(this.meshWorld)
      .distanceTo(camera.getWorldPosition(this.cameraWorld))
    const coverage: number = Math.max(frameCoverage(this.radius, distance, camera.fov), this.renderedCoverage)

    this.renderedCoverage = 0

    const next: SphereLevel = nextSphereLevel(this.current, coverage, this.denseCoverage, this.coarseCoverage)

    if (next !== this.current) this.install(next)
  }

  private install(level: SphereLevel): void {
    const segments: number = level === 'dense' ? this.options.denseSegments : this.coarseSegments
    const scale: number = level === 'dense' && this.options.circumscribeDense ? circumscribeFactor(segments) : 1
    const previous: BufferGeometry = this.mesh.geometry

    this.mesh.geometry = buildSphereGeometry(this.radius * scale, segments)
    this.current = level
    previous.dispose()
  }
}
