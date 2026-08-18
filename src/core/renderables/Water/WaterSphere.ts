import { Mesh, type WebGLRenderer } from 'three'
import { Actor } from '@/core/models/Actor'
import { TerrainPatchGroup } from '@/core/terrain/TerrainPatchGroup'
import { constantHeightField } from '@/core/terrain/constantHeightField'
import { WaterMaterial } from '@/core/renderables/Water/WaterMaterial'

/** Патчи воды рисуются после суши: TerrainSphere/пул оставляют дефолтный renderOrder three.js (0). */
export const WATER_RENDER_ORDER = 10

/**
 * Водная оболочка — кубосфера БЕЗ смещения (константное поле «уровень»),
 * радиуса R+уровень (уровень может быть отрицательным — например, Явин IV
 * −667.2 м, см. измерение Task 2). Квадродерево/пул/юбки — TerrainPatchGroup,
 * общая база с TerrainSphere (см. её докблок про инвариант «без дыр» и
 * владение пулом); здесь только то, что отличает воду: свой временный
 * материал (WaterMaterial, Task 4 заменит на честный шейдер — см. её
 * докблок), renderOrder после суши, патчи некликабельны (вода не должна
 * перехватывать выбор актора у рельефа под ней — resolveCrosshairAnchor и
 * клик-рейкаст собирают кандидатов по userData.clickable===true, патч воды
 * в эту выборку не попадает вовсе, клик проходит сквозь него к рельефу).
 *
 * Дерево у константного поля не растёт вглубь ни на какой дистанции:
 * geometricErrorMeters ≡ 0 у поля без рельефа (см. constantHeightField) держит
 * SSE-отбор на TERRAIN_QUADTREE_MIN_LEVEL всегда — 24 листа (6 граней ×
 * 4^MIN_LEVEL), не растут при приближении камеры (тест «глубина ограничена»).
 * Юбки при этом не лишние: щели уровней у кубосферы дают сами стыки граней
 * куба на MIN_LEVEL (тесселяция соседних патчей не обязана совпадать даже на
 * одном уровне через угол грани) — юбка их закрывает как обычно.
 */
class WaterSphere extends TerrainPatchGroup {
  public model: Actor
  private readonly sharedMaterial: WaterMaterial

  public constructor(model: Actor, waterLevelMeters: number, renderer: WebGLRenderer) {
    const radiusKm: number = model.physicalObject!.getAttribute('radius')!
    const field = constantHeightField(radiusKm, waterLevelMeters)
    const sharedMaterial = new WaterMaterial()

    super(field, sharedMaterial, renderer)
    this.model = model
    this.sharedMaterial = sharedMaterial

    this.name = this.model.getAttribute('name', '') + 'Water'
    this.userData.type = 'water'
    this.userData.clickable = false
  }

  /** Симметрично TerrainSphere.material — не адресуется ResourceObserver напрямую (WaterSphere не .renderable узла). */
  public get material(): WaterMaterial {
    return this.sharedMaterial
  }

  protected configurePatchMesh(mesh: Mesh): void {
    mesh.renderOrder = WATER_RENDER_ORDER
    mesh.userData.clickable = false
  }
}

export { WaterSphere }
