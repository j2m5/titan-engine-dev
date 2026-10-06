import type { BufferGeometry, Mesh, PerspectiveCamera } from 'three'
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
  /** Описанная сфера под сегментацию уровня (сегодня только Planet) */
  circumscribe: boolean
}

/**
 * Детализация сферы тела по доле кадра (config sphereDetail): грубая
 * сегментация по умолчанию, плотная — пока тело крупно в кадре. Плотность нужна
 * только силуэту: освещение считается во фрагментах, вершины не смещаются.
 *
 * Меш всегда владеет ровно одной геометрией: свап ставит новую и диспозит
 * прежнюю, грубая в запасе не держится. Поэтому разборка (disposeSceneTree,
 * dispose() тел) освобождает текущую и ничего не теряет.
 *
 * update зовётся ТОЛЬКО из updateObject владельца, никогда из onBeforeRender:
 * к onBeforeRender список рендера уже держит прежнюю геометрию, и dispose()
 * посреди прохода отдал бы three удалённые буферы. SceneManager обходит
 * traverse'ом все объекты, в том числе скрытые уровни LOD, — плотная сфера
 * освобождается и после телепорта, и когда тело ушло в импостор.
 */
export class SphereDetail {
  private current: SphereLevel = 'coarse'
  private readonly coarseSegments: number = config('sphereDetail.coarseSegments')
  private readonly denseCoverage: number = config('sphereDetail.denseCoverage')
  private readonly coarseCoverage: number = config('sphereDetail.coarseCoverage')
  private readonly meshWorld: Vector3 = new Vector3()
  private readonly cameraWorld: Vector3 = new Vector3()

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
   * Позиции — через getWorldPosition: он обновляет цепочку матриц, и первый кадр
   * не видит единичную matrixWorld (иначе все тела «стояли бы» в начале
   * координат). Доля считается по истинному радиусу, без описанного множителя.
   */
  public update(camera: PerspectiveCamera): void {
    const distance: number = this.mesh
      .getWorldPosition(this.meshWorld)
      .distanceTo(camera.getWorldPosition(this.cameraWorld))
    const next: SphereLevel = nextSphereLevel(
      this.current,
      frameCoverage(this.radius, distance, camera.fov),
      this.denseCoverage,
      this.coarseCoverage
    )

    if (next !== this.current) this.install(next)
  }

  private install(level: SphereLevel): void {
    const segments: number = level === 'dense' ? this.options.denseSegments : this.coarseSegments
    const scale: number = this.options.circumscribe ? circumscribeFactor(segments) : 1
    const previous: BufferGeometry = this.mesh.geometry

    this.mesh.geometry = buildSphereGeometry(this.radius * scale, segments)
    this.current = level
    previous.dispose()
  }
}
