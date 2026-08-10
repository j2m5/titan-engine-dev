import type { Camera, PerspectiveCamera, Scene, WebGLRenderer } from 'three'
import { BufferGeometry, Mesh, SphereGeometry, Vector3 } from 'three'
import { Actor } from '@/core/models/Actor'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { config } from '@/core/framework/config'
import { WhiteDwarfMaterial } from '@/core/renderables/WhiteDwarf/WhiteDwarfMaterial'
import { whiteDwarfParameters, WhiteDwarfParameters } from '@/core/renderables/WhiteDwarf/WhiteDwarfParameters'
import { frameCoverage, proximityExposure } from '@/core/renderables/WhiteDwarf/proximityExposure'

/**
 * Диск белого карлика.
 *
 * updateObject НЕ переопределён намеренно, и это не упущение: у поверхности нет
 * ничего зависящего от времени. Времени нет, потому что нечему эволюционировать —
 * грануляции у карлика не бывает (у горячих нет конвекции вовсе, у холодных
 * гранула порядка 1/6000 радиуса). Шейдер живёт в ВИДОВОМ пространстве, где
 * камера в начале координат по построению: коричневому карлику uCameraObject
 * нужен ради домена шума, прибитого к телу, а здесь домена нет.
 *
 * Экспозиция (uProximityExposure) — исключение из этой статики, но не поверхности:
 * это пер-кадровое свойство КАМЕРЫ (доля кадра, занятая диском), а не тела, и
 * живёт в onBeforeRender — см. причину там же. Если на поверхности появится
 * изменяемое состояние (грануляция, пятна), это по-прежнему было бы ошибкой.
 *
 * Число сегментов сферы взято звёздное (256): деталей на поверхности нет, но
 * весь вид объекта держится на СИЛУЭТЕ — шкала высот атмосферы составляет 3e-5
 * радиуса, то есть кромка обрывается в чёрное мгновенно, и гранёный силуэт был
 * бы виден сразу.
 */
class WhiteDwarf extends Mesh {
  public model: Actor
  declare public geometry: BufferGeometry
  declare public material: WhiteDwarfMaterial

  private readonly radius: number
  private readonly cameraWorld: Vector3 = new Vector3()
  private readonly bodyWorld: Vector3 = new Vector3()

  public constructor(model: Actor) {
    super()
    this.model = model
    this.radius = toThreeJSUnits(this.model.physicalObject?.getAttribute('radius') ?? 0)

    const params: WhiteDwarfParameters = whiteDwarfParameters(model)

    this.geometry = new SphereGeometry(this.radius, 256, 256)
    this.material = new WhiteDwarfMaterial(params)

    this.name = this.model.getAttribute('name', '') + 'WhiteDwarf'
    this.userData.type = 'whiteDwarf'
    this.userData.clickable = true

    const floor: number = config('whiteDwarf.proximityExposureFloor')
    const start: number = config('whiteDwarf.proximityExposureStart')
    const end: number = config('whiteDwarf.proximityExposureEnd')

    // onBeforeRender, а не updateObject: SceneManager.update отрабатывает до
    // scene.updateMatrixWorld(), и matrixWorld тела там отстаёт на кадр; three
    // зовёт onBeforeRender с актуальными матрицами и камерой ТЕКУЩЕГО прохода
    // (прецедент — BrownDwarf). Не-перспективные проходы юниформ не трогают.
    this.onBeforeRender = (_renderer: WebGLRenderer, _scene: Scene, camera: Camera): void => {
      const perspective = camera as PerspectiveCamera

      if (!perspective.isPerspectiveCamera) return

      camera.getWorldPosition(this.cameraWorld)
      this.bodyWorld.setFromMatrixPosition(this.matrixWorld)

      const coverage: number = frameCoverage(
        this.radius,
        this.bodyWorld.distanceTo(this.cameraWorld),
        perspective.fov
      )

      this.material.uniforms.uProximityExposure.value = proximityExposure(coverage, floor, start, end)
    }
  }

  public dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}

export { WhiteDwarf }
