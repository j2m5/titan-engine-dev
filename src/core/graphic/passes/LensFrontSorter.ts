import { Vector3, type Camera, type Material, type Object3D } from 'three'
import type { LensRegistry } from '@/core/services/LensRegistry'
import type { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import { DynamicNode } from '@/core/renderables/utils/DynamicNode'
import { LENS_FRONT_DEPTH_LAYER, LENS_FRONT_LAYER, isSceneFrameConsumer, type DepthVolume } from '@/core/graphic/passes/DepthVolume'
import { isVisibleInTree } from '@/core/graphic/passes/DepthVolumePass'

/** Маска одного слоя 0 — переносятся только такие объекты, и возвращаются на неё же */
const DEFAULT_LAYER_MASK = 1

const toCenter = new Vector3()
const toLens = new Vector3()

/**
 * Центр стоит перед линзой: ближе к камере, чем точка наибольшего сближения
 * его луча с центром линзы. Объект в самой камере — перед.
 */
export function isInFrontOfLens(center: Vector3, camera: Vector3, lens: Vector3): boolean {
  toCenter.subVectors(center, camera)
  const distance = toCenter.length()
  if (distance === 0) return true
  const closest = toLens.subVectors(lens, camera).dot(toCenter) / distance
  return distance < closest
}

function materialsOf(object: Object3D): readonly Material[] {
  const material = (object as Object3D & { material?: Material | Material[] }).material
  if (material === undefined) return []
  return Array.isArray(material) ? material : [material]
}

/** Прозрачное, без записи глубины или только глубина (препасс прозрачного) */
function isFrontCandidate(object: Object3D): boolean {
  if (object.layers.mask !== DEFAULT_LAYER_MASK) return false
  return materialsOf(object).some((m) => m.transparent || !m.depthWrite || !m.colorWrite)
}

const isDynamicNode = (object: Object3D): boolean => object instanceof DynamicNode

/**
 * Прозрачное перед линзой: каждый кадр, пока активна хоть одна чёрная дыра,
 * переносит прозрачные объекты тел, стоящих перед ней, на LENS_FRONT_LAYER и
 * запоминает передние объёмы. Основной проход и DepthVolumePass их не рисуют
 * (иначе проходы дыры берут их как фон: призрачные дуги, «окна» препассов);
 * LensFrontPass рисует их поверх лензированного кадра и зовёт restore().
 *
 * Тело классифицируется целиком по центру (DynamicNode; вложенное тело — само).
 * Непрозрачное остаётся в основном проходе: пишет глубину и закрывает дыру.
 */
export class LensFrontSorter {
  private readonly moved: Object3D[] = []
  private depthWriters = false
  private readonly volumes: DepthVolume[] = []
  private readonly lensCenters: Vector3[] = []
  private readonly lensBodies = new Set<Object3D>()
  private readonly cameraWorld = new Vector3()
  private readonly position = new Vector3()

  public constructor(
    private readonly scene: Object3D | null,
    private readonly camera: Camera,
    private readonly lenses: LensRegistry,
    private readonly volumeRegistry: DepthVolumeRegistry,
    private readonly isBody: (object: Object3D) => boolean = isDynamicNode
  ) {}

  public split(): void {
    this.restore()
    if (this.scene === null || !this.collectLenses()) return

    this.camera.getWorldPosition(this.cameraWorld)
    this.visit(this.scene, false)

    for (const volume of this.volumeRegistry.volumes()) {
      if (isVisibleInTree(volume) && this.isFront(volume.getWorldPosition(this.position))) this.volumes.push(volume)
    }
  }

  public restore(): void {
    for (const object of this.moved) object.layers.set(0)
    this.moved.length = 0
    this.volumes.length = 0
    this.depthWriters = false
  }

  /** Среди перенесённых есть пишущие глубину (слой LENS_FRONT_DEPTH_LAYER) */
  public hasDepthWriters(): boolean {
    return this.depthWriters
  }

  public frontObjects(): readonly Object3D[] {
    return this.moved
  }

  public frontVolumes(): readonly DepthVolume[] {
    return this.volumes
  }

  public isFrontVolume(volume: DepthVolume): boolean {
    return this.volumes.includes(volume)
  }

  /** Активная линза — меш L0 виден по цепочке предков, как в BlackHolePass */
  private collectLenses(): boolean {
    this.lensCenters.length = 0
    this.lensBodies.clear()
    for (const entry of this.lenses.entries()) {
      const object = entry.object
      if (!isSceneFrameConsumer(object) || !isVisibleInTree(object)) continue
      this.lensCenters.push(object.getWorldPosition(new Vector3()))
      for (let node: Object3D | null = object; node !== null; node = node.parent) {
        if (this.isBody(node)) {
          this.lensBodies.add(node)
          break
        }
      }
    }
    return this.lensCenters.length > 0
  }

  private visit(node: Object3D, front: boolean): void {
    for (const child of node.children) {
      if (this.isBody(child)) {
        const bodyFront = !this.lensBodies.has(child) && this.isFront(child.getWorldPosition(this.position))
        this.visit(child, bodyFront)
        continue
      }
      if (front && isFrontCandidate(child)) {
        child.layers.set(LENS_FRONT_LAYER)
        if (materialsOf(child).some((m) => m.depthWrite)) {
          child.layers.enable(LENS_FRONT_DEPTH_LAYER)
          this.depthWriters = true
        }
        this.moved.push(child)
      }
      this.visit(child, front)
    }
  }

  private isFront(center: Vector3): boolean {
    return this.lensCenters.some((lens) => isInFrontOfLens(center, this.cameraWorld, lens))
  }
}
