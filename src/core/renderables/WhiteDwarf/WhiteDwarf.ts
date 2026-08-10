import { BufferGeometry, Mesh, SphereGeometry } from 'three'
import { Actor } from '@/core/models/Actor'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { WhiteDwarfMaterial } from '@/core/renderables/WhiteDwarf/WhiteDwarfMaterial'
import { whiteDwarfParameters, WhiteDwarfParameters } from '@/core/renderables/WhiteDwarf/WhiteDwarfParameters'

/**
 * Диск белого карлика.
 *
 * updateObject НЕ переопределён намеренно, и это не упущение: у тела нет ничего
 * зависящего от времени или от камеры. Времени нет, потому что нечему
 * эволюционировать — грануляции у карлика не бывает (у горячих нет конвекции
 * вовсе, у холодных гранула порядка 1/6000 радиуса). Позиции камеры с CPU нет,
 * потому что шейдер живёт в ВИДОВОМ пространстве, где камера в начале координат
 * по построению: коричневому карлику uCameraObject нужен ради домена шума,
 * прибитого к телу, а здесь домена нет.
 *
 * Следствие: материал статичен от конструктора до dispose. Если здесь появится
 * updateObject, значит на поверхность добавили то, чего у неё физически нет.
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
  }

  public dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}

export { WhiteDwarf }
