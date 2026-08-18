import { Mesh, type WebGLRenderer } from 'three'
import { Actor } from '@/core/models/Actor'
import { TerrainPatchGroup } from '@/core/terrain/TerrainPatchGroup'
import { constantHeightField } from '@/core/terrain/constantHeightField'
import { WaterMaterial } from '@/core/renderables/Water/WaterMaterial'

/**
 * Патчи воды рисуются ДО атмосферных проходов, не после: BrunetonAtmosphere
 * кладёт пропускание на renderOrder=0 и in-scatter на 1 (умножение на
 * пропускание обязано лечь до сложения in-scatter — см. её докблок).
 * Положительный renderOrder (было 10 — находка ревью Task 3, фикс-раунд 1)
 * рисовал воду ПОСЛЕ обоих проходов атмосферы: océan закрашивал ореол лимба,
 * не домножаясь на пропускание. Суша (TerrainSphere) непрозрачна и рисуется
 * раньше воды в любом случае — opaque/transparent разделение three.js само
 * разводит очереди, renderOrder здесь упорядочивает только ВНУТРИ
 * прозрачной очереди, где иначе оказались бы вода и атмосфера.
 */
export const WATER_RENDER_ORDER = -1

/**
 * Потолок живых патчей у водного пула — свой, МЕНЬШЕ террейнового
 * MAX_LIVE_PATCHES (1024): дерево воды делится по кривизне сферы (см.
 * constantHeightField), а не по амплитуде рельефа, и упирается в
 * TERRAIN_QUADTREE_MAX_LEVEL=6 гораздо быстрее настоящего рельефа — там,
 * где террейн на изрезанной карте может уйти вглубь на многих участках сразу,
 * у воды глубина одна и та же везде (кривизна сферы не выделяет «сложных»
 * зон). Замер (юнит `WaterSphere.spec.ts`, полный цикл орбита→посадка,
 * актёр Земли/Луны из БД, реальный пул+updateObject, не голая
 * selectTerrainNodes; фикс-раунд 2 — диагональная ε, см. `constantHeightField`):
 * пик живых патчей 84 (Земля, H=1080 И H=2160 — оба упираются в
 * TERRAIN_QUADTREE_MAX_LEVEL=6, разница в экране больше не даёт разного
 * пика), 72 (Луна, H=1080, до L5) — везде патчи упираются в потолок глубины
 * раньше, чем успевают набрать сотни (в отличие от рельефа, потолок глубины
 * у воды достигается почти сразу у поверхности и дальше не растёт с
 * приближением). 256 — операционный запас (>3× пика при 84) при этом на
 * порядок меньше террейнового потолка.
 */
export const WATER_MAX_LIVE_PATCHES = 256

/**
 * Водная оболочка — кубосфера БЕЗ смещения (константное поле «уровень»),
 * радиуса R+уровень (уровень может быть отрицательным — например, Явин IV
 * −667.2 м, см. измерение Task 2). Квадродерево/пул/юбки — TerrainPatchGroup,
 * общая база с TerrainSphere (см. её докблок про инвариант «без дыр» и
 * владение пулом); здесь только то, что отличает воду: свой временный
 * материал (WaterMaterial, Task 4 заменит на честный шейдер — см. её
 * докблок), renderOrder до атмосферы (см. WATER_RENDER_ORDER), свой
 * (меньший) потолок пула (см. WATER_MAX_LIVE_PATCHES), патчи некликабельны
 * (вода не должна перехватывать выбор актора у рельефа под ней —
 * resolveCrosshairAnchor и клик-рейкаст собирают кандидатов по
 * userData.clickable===true, патч воды в эту выборку не попадает вовсе,
 * клик проходит сквозь него к рельефу).
 *
 * Дерево у константного поля делится ПО КРИВИЗНЕ СФЕРЫ, не по амплитуде
 * рельефа (которой у воды нет): `constantHeightField` возвращает провис
 * хорды ДИАГОНАЛИ мешевой ячейки уровня (не осевого шага — см. её докблок,
 * фикс-раунд 2) вместо честного p99 размаха высот — числитель SSE ненулевой
 * и убывает с глубиной уровня, отбор самотерминируется в фактической
 * SSE-метрике selectTerrainNodes БЕЗ отдельной ручки (крупное тело делит
 * глубже, мелкое — мельче, из космоса везде 24 листа — SSE MIN_LEVEL уже
 * ниже порога). До фикс-раунда 1 ε константного поля был тождественно 0 —
 * SSE не пробивал порог НИКОГДА, дерево оставалось на MIN_LEVEL везде:
 * посадка на воду видела гранёную поверхность в сотни метров провиса вместо
 * аналитического пола коллизии. Фикс-раунд 1 брал только осевой шаг ячейки,
 * что занижало провис вдвое против фактического худшего ребра (диагонали,
 * по которой триангулируется квад) — фикс-раунд 2 это закрыл.
 *
 * Юбки при этом не лишние: щели уровней у кубосферы дают сами стыки граней
 * куба даже на одном уровне (тесселяция соседних патчей не обязана совпадать
 * через угол грани), плюс теперь и реальные split/merge переходы между
 * уровнями (см. выше) — юбка закрывает и то, и другое как обычно.
 */
class WaterSphere extends TerrainPatchGroup {
  public model: Actor
  private readonly sharedMaterial: WaterMaterial

  public constructor(model: Actor, waterLevelMeters: number, renderer: WebGLRenderer) {
    const radiusKm: number = model.physicalObject!.getAttribute('radius')!
    const field = constantHeightField(radiusKm, waterLevelMeters)
    const sharedMaterial = new WaterMaterial()

    super(field, sharedMaterial, renderer, WATER_MAX_LIVE_PATCHES)
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
