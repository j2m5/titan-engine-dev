import { afterEach, describe, expect, it } from 'vitest'
import { Object3D, Vector3 } from 'three'
import '@/core/framework/TitanThree'
import { COLLISION_GAP, collectColliders } from '@/core/services/CameraCollision'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { SpaceScale } from '@/core/constants'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { CLEARANCE_MARGIN_METERS, terrainHeightFieldFor, type TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'
import { makeBody, makeModel, makeCollision } from './cameraCollisionStubs'

const EARTH_RADIUS_KM = 6360
const R = toThreeJSUnits(EARTH_RADIUS_KM) * COLLISION_GAP

const MOON_HEIGHT_PATH = 'planets/moon/moon_height.raw'

function seedHeightMap(
  values: number[],
  width: number,
  height: number,
  minMeters: number,
  maxMeters: number,
  path: string = MOON_HEIGHT_PATH
): void {
  ;(heightFieldStorage as unknown as { maps: Map<string, unknown> }).maps.set(path, {
    width,
    height,
    minMeters,
    maxMeters,
    data: new Uint16Array(values)
  })
}

describe('collectColliders: состав кэша', () => {
  it('строит сферу по физическому радиусу с зазором', () => {
    const colliders = collectColliders([makeBody('planet', EARTH_RADIUS_KM)])

    expect(colliders).toHaveLength(1)
    expect(colliders[0].radius).toBeCloseTo(toThreeJSUnits(EARTH_RADIUS_KM) * COLLISION_GAP, 10)
  })

  it('исключает чёрную дыру', () => {
    // Решение владельца: ЧД — объект уникальный, коллизии для неё отложены
    expect(collectColliders([makeBody('blackHole', 100000)])).toHaveLength(0)
  })

  it('молча пропускает тело без модели и тело без радиуса', () => {
    const withoutModel = new Object3D()
    withoutModel.userData.type = 'planet'

    const objects = [withoutModel, makeBody('planet', null), makeBody('star', EARTH_RADIUS_KM)]

    expect(collectColliders(objects)).toHaveLength(1)
  })

  it('схлопывает LOD-дубли одного актора в одну сферу', () => {
    // Снапшот ищет по userData.type и находит и меш, и импостор-уровень —
    // оба указывают на одну модель
    const shared = makeModel(EARTH_RADIUS_KM)
    const objects = [
      makeBody('planet', EARTH_RADIUS_KM, new Vector3(), shared),
      makeBody('planet', EARTH_RADIUS_KM, new Vector3(), shared)
    ]

    expect(collectColliders(objects)).toHaveLength(1)
  })
})

describe('collectColliders: терраформные тела', () => {
  afterEach(() => heightFieldStorage.clear())

  it('тело с картой в реестре получает heightField и радиус R+maxH+maxClearance без GAP', () => {
    seedHeightMap(new Array(8).fill(65535), 4, 2, 0, 10000)
    const body = makeBody('planet', 1736, new Vector3(), undefined, MOON_HEIGHT_PATH)

    const colliders = collectColliders([body])

    expect(colliders[0].heightField).toBeDefined()
    expect(colliders[0].radius).toBeCloseTo(
      toThreeJSUnits(1736 + 10000 / 1000 + colliders[0].heightField!.maxClearanceMeters / 1000),
      10
    )
  })

  it('height-строка есть, но карта не загрузилась — тело остаётся сферой R×GAP', () => {
    const body = makeBody('planet', 1736, new Vector3(), undefined, MOON_HEIGHT_PATH)

    const colliders = collectColliders([body])

    expect(colliders[0].heightField).toBeUndefined()
    expect(colliders[0].radius).toBeCloseTo(toThreeJSUnits(1736) * COLLISION_GAP, 10)
  })
})

describe('CameraCollision: пуш-аут', () => {
  it('старт внутри сферы — камера на поверхности, по нормали наружу', () => {
    const body = makeBody('planet', EARTH_RADIUS_KM)
    const { collision, camera } = makeCollision([body], new Vector3(R * 0.5, 0, 0))

    collision.resolve()

    expect(camera.position.x).toBeCloseTo(R, 10)
    expect(camera.position.y).toBeCloseTo(0, 10)
    expect(camera.position.z).toBeCloseTo(0, 10)
  })

  it('тело наехало на неподвижную камеру — камеру вытолкнуло', () => {
    // Порядок кадра: тела двигаются по эпохе после движения камеры, при
    // ускоренном времени планета догоняет стоящую камеру
    const body = makeBody('planet', EARTH_RADIUS_KM, new Vector3(R * 10, 0, 0))
    const { collision, camera } = makeCollision([body], new Vector3(R * 3, 0, 0))

    collision.resolve()
    body.position.setX(R * 2.5)
    collision.resolve()

    expect(camera.position.distanceTo(body.position)).toBeCloseTo(R, 10)
  })

  it('камера ровно в центре тела не даёт NaN', () => {
    const body = makeBody('planet', EARTH_RADIUS_KM)
    const { collision, camera } = makeCollision([body], new Vector3(0, 0, 0))

    collision.resolve()

    expect(camera.position.length()).toBeCloseTo(R, 10)
  })

  it('выталкивание из луны не оставляет камеру внутри планеты', () => {
    // Луна лежит на поверхности планеты, камера в пересечении обеих сфер
    const planet = makeBody('planet', EARTH_RADIUS_KM)
    const moonKm = EARTH_RADIUS_KM / 2
    const moon = makeBody('planet', moonKm, new Vector3(R, 0, 0))
    const { collision, camera } = makeCollision([planet, moon], new Vector3(R * 0.9, 0, 0))

    collision.resolve()

    expect(camera.position.length()).toBeGreaterThanOrEqual(R - 1e-9)
    expect(camera.position.distanceTo(moon.position)).toBeGreaterThanOrEqual(
      toThreeJSUnits(moonKm) * COLLISION_GAP - 1e-9
    )
  })

  it('пустой снапшот — no-op без исключений', () => {
    const { collision, camera } = makeCollision([], new Vector3(1, 2, 3))

    expect(() => collision.resolve()).not.toThrow()
    expect(camera.position.toArray()).toEqual([1, 2, 3])
  })
})

describe('CameraCollision: свип и скольжение', () => {
  it('пролёт насквозь за один кадр пойман на входе (туннелирование)', () => {
    const body = makeBody('planet', EARTH_RADIUS_KM)
    const { collision, camera } = makeCollision([body], new Vector3(-R * 1000, 0, 0))

    collision.resolve()
    camera.position.set(R * 1000, 0, 0)
    collision.resolve()

    // Лобовое движение: касательной составляющей нет, камера у точки входа
    expect(camera.position.x).toBeCloseTo(-R, 3)
    expect(camera.position.length()).toBeGreaterThanOrEqual(R - 1e-9)
  })

  it('движение под углом скользит по поверхности: нормаль погашена, касательная жива', () => {
    const body = makeBody('planet', EARTH_RADIUS_KM)
    const { collision, camera } = makeCollision([body], new Vector3(-R * 2, R * 0.5, 0))

    collision.resolve()
    camera.position.set(0, R * 0.5, 0)
    collision.resolve()

    // Не внутри сферы, но и не прилипла к точке контакта: уехала по касательной
    expect(camera.position.length()).toBeGreaterThanOrEqual(R - 1e-9)
    expect(camera.position.y).toBeGreaterThan(R * 0.5)
    expect(camera.position.x).toBeGreaterThan(-R)
  })

  it('серия шагов к центру не пробивает поверхность (инвариант зазора)', () => {
    const body = makeBody('planet', EARTH_RADIUS_KM)
    const { collision, camera } = makeCollision([body], new Vector3(R * 2, R * 2, R * 2))

    collision.resolve()

    for (let step = 0; step < 5; step++) {
      camera.position.multiplyScalar(0.4)
      collision.resolve()

      expect(camera.position.length()).toBeGreaterThanOrEqual(R - 1e-9)
    }
  })

  it('reset() после телепорта не даёт ложного клампа', () => {
    // Смена сценария: EngineStore ставит defaultCameraPosition, тело осталось
    // между старой и новой позициями
    const body = makeBody('planet', EARTH_RADIUS_KM)
    const { collision, camera } = makeCollision([body], new Vector3(-R * 5, 0, 0))

    collision.resolve()
    camera.position.set(R * 5, 0, 0)
    collision.reset()
    collision.resolve()

    expect(camera.position.toArray()).toEqual([R * 5, 0, 0])
  })

  it('перенос системы отсчёта не превращается в свип через сопровождаемое тело', () => {
    const body = makeBody('planet', EARTH_RADIUS_KM)
    const { collision, camera } = makeCollision([body], new Vector3(R * 2, 0, 0))
    const displacement = new Vector3(R * 10, 0, 0)

    collision.resolve()
    body.position.add(displacement)
    camera.position.add(displacement)
    collision.translateReferenceFrame(displacement)
    collision.resolve()

    expect(camera.position.x).toBeCloseTo(R * 12, 10)
    expect(camera.position.distanceTo(body.position)).toBeCloseTo(R * 2, 10)
  })

  it('телепорт без reset() ловится свипом — контраст к предыдущему тесту', () => {
    const body = makeBody('planet', EARTH_RADIUS_KM)
    const { collision, camera } = makeCollision([body], new Vector3(-R * 5, 0, 0))

    collision.resolve()
    camera.position.set(R * 5, 0, 0)
    collision.resolve()

    expect(camera.position.x).toBeCloseTo(-R, 3)
  })
})

// карта 4×2: западное полушарие высокое (20000 м), восточное низкое (0 м).
// maxMeters=20000 — фактический диапазон данных (raw 65535 = максимум
// столбца), а не пассивный 65535: иначе широкая фаза (R+maxH+maxClearance)
// на порядок рыхлее настоящего рельефа и глотает свип-тесты без разбора.
function terrainBody(): { body: Object3D; field: TerrainHeightField } {
  seedHeightMap([65535, 0, 65535, 0, 65535, 0, 65535, 0], 4, 2, 0, 20000)
  const body = makeBody('planet', 1736, new Vector3(), undefined, MOON_HEIGHT_PATH)
  const field = terrainHeightFieldFor(
    (heightFieldStorage as unknown as { maps: Map<string, HeightMapData> }).maps.get(MOON_HEIGHT_PATH)!,
    1736
  )
  return { body, field }
}

// центр низкого столбца (u=0.375): без блендинга бортов текселя, чтобы
// высота под направлением была однозначной (см. терраформный дефолт-фикс)
const LOW_COLUMN_DIR = new Vector3(1, 0, 1).normalize()

describe('CameraCollision: пуш-аут по рельефу', () => {
  afterEach(() => heightFieldStorage.clear())

  it('камера ниже поверхности выносится на R+h+clearance по своему направлению', () => {
    const { body, field } = terrainBody()
    const dir = LOW_COLUMN_DIR
    const target = field.collisionRadiusUnits(dir)
    const { collision, camera } = makeCollision([body], dir.clone().multiplyScalar(target * 0.9))

    collision.resolve()

    expect(camera.position.length()).toBeCloseTo(target, 8)
    expect(camera.position.clone().normalize().dot(dir)).toBeCloseTo(1, 6)
  })

  it('камера над поверхностью, но внутри старой сферы R×GAP — НЕ трогается', () => {
    // над низким полушарием рельефная коллизия пускает камеру ниже сферы
    const { body, field } = terrainBody()
    const dir = LOW_COLUMN_DIR
    const altitude = field.collisionRadiusUnits(dir) * 1.0001
    expect(altitude).toBeLessThan(toThreeJSUnits(1736) * COLLISION_GAP + toThreeJSUnits(20))
    const { collision, camera } = makeCollision([body], dir.clone().multiplyScalar(altitude))

    collision.resolve()

    expect(camera.position.length()).toBeCloseTo(altitude, 10)
  })

  it('вращение тела подставляет под камеру другой рельеф — камеру выталкивает', () => {
    const { body, field } = terrainBody()
    const dir = LOW_COLUMN_DIR
    // высота над низким рельефом, ниже высокого
    const altitude = field.collisionRadiusUnits(dir) * 1.0001
    const { collision, camera } = makeCollision([body], dir.clone().multiplyScalar(altitude))

    collision.resolve() // безобидный кадр
    body.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2) // высокое полушарие — под камеру
    body.updateMatrixWorld(true)
    collision.resolve()

    // локальное направление камеры после поворота
    const localDir = camera.position.clone().applyQuaternion(body.quaternion.clone().invert()).normalize()
    expect(camera.position.length()).toBeCloseTo(field.collisionRadiusUnits(localDir), 6)
    expect(camera.position.length()).toBeGreaterThan(altitude)
  })
})

describe('CameraCollision: свип по рельефу', () => {
  afterEach(() => heightFieldStorage.clear())

  // направление по долготе u на экваторе (v=0.5, y=0) — обратная формула
  // dirToUv: phi=u·2π, x=−cos(phi), z=sin(phi); x²+z²=1, нормализация не нужна
  const dirAtU = (u: number): Vector3 => {
    const phi = u * 2 * Math.PI
    return new Vector3(-Math.cos(phi), 0, Math.sin(phi))
  }

  // соседний высокий столбец (u=0.125, 20000 м) — по другую сторону от
  // границы u=0.25, где низкий (LOW_COLUMN_DIR, u=0.375) сходится с высоким
  const HIGH_COLUMN_DIR = dirAtU(0.125)

  it('низкий пролёт над подножием горы не туннелирует сквозь склон', () => {
    const { body, field } = terrainBody()
    // старт и финиш — на ОДНОЙ и той же малой высоте над низким столбцом:
    // обе точки глубоко внутри старой широкой сферы (R+maxH+maxClearance,
    // ужесточённой п.3 до реального максимума карты) — контейнер для
    // старого бага. Магнитуда тут НЕ дискриминатор: push-out в конце resolve()
    // всегда доводит итоговый радиус до локальной цели В ТОЙ ТОЧКЕ, где
    // осталась камера, независимо от того, сработал ли свип по пути — старый
    // код (containsPoint пропускает терраформное тело целиком) долетает
    // РОВНО до HIGH_COLUMN_DIR и push-out лишь поднимает его на локальную
    // цель В ЭТОМ направлении, ничем не выдавая, что он проехал сквозь гору.
    // Дискриминатор — направление: старый код долетает точно до
    // HIGH_COLUMN_DIR (dot=1), новый марч обязан затормозить на склоне
    // заметно раньше (эмпирически dot≈0.7–0.76 для этой геометрии)
    const altitude = field.collisionRadiusUnits(LOW_COLUMN_DIR) * 1.01
    const { collision, camera } = makeCollision([body], LOW_COLUMN_DIR.clone().multiplyScalar(altitude))

    collision.resolve() // фиксирует lastPosition
    camera.position.copy(HIGH_COLUMN_DIR).multiplyScalar(altitude)
    collision.resolve()

    // базовый инвариант: камера никогда не встроена глубже своей локальной поверхности
    const localDir = camera.position.clone().normalize()
    expect(camera.position.length()).toBeGreaterThanOrEqual(field.collisionRadiusUnits(localDir) * 0.999)
    // не долетела по направлению до полного бокового разворота на высокий
    // столбец — задержана склоном по пути, а не проехала весь отрезок насквозь
    expect(localDir.dot(HIGH_COLUMN_DIR)).toBeLessThan(0.9)
  })

  it('касательное движение над ровным участком не съедается свипом', () => {
    const { body, field } = terrainBody()
    const dir = new Vector3(1, 0, 0)
    const altitude = field.collisionRadiusUnits(dir) * 1.01
    const { collision, camera } = makeCollision([body], dir.clone().multiplyScalar(altitude))

    collision.resolve()
    // шаг по касательной (по y — вдоль меридиана): карта не варьируется по
    // широте, так что высота под направлением не меняется вообще — заведомо
    // безопасный шаг, контраст к следующему тесту, где шаг задевает склон
    const step = altitude * 0.001
    camera.position.add(new Vector3(0, step, 0))
    collision.resolve()

    expect(camera.position.y).toBeGreaterThan(step * 0.5) // касательная составляющая жива
  })

  it('касательный шаг, задевающий гору, клампится — в отличие от чистого шага рядом', () => {
    const { body, field } = terrainBody()
    // тот же старт, что и в «низком пролёте», но шаг короткий — небольшой
    // сдвиг по долготе к границе с высоким столбцом (u=0.375→0.345, 30
    // тысячных вместо полных 0.25 до HIGH_COLUMN_DIR). Остаток после
    // клампа мал — итоговая позиция обязана лечь у своей локальной цели
    // с запасом, тесно (в отличие от «низкого пролёта», где большой остаток
    // скольжения намеренно не проверяется по магнитуде — см. комментарий там)
    const altitude = field.collisionRadiusUnits(LOW_COLUMN_DIR) * 1.01
    const grazeDir = dirAtU(0.345)
    const { collision, camera } = makeCollision([body], LOW_COLUMN_DIR.clone().multiplyScalar(altitude))

    collision.resolve()
    camera.position.copy(grazeDir).multiplyScalar(altitude)
    collision.resolve()

    // клампнута заметно ниже наивной (непроверенной) длины — контраст к
    // предыдущему тесту, где касательный шаг проходит НЕ тронутым
    expect(camera.position.length()).toBeLessThan(altitude * 0.999)
    // и клампнута тесно у своей локальной поверхности — не улетела далеко
    // (маленький боковой шаг — маленький остаток скольжения)
    const localDir = camera.position.clone().normalize()
    const target = field.collisionRadiusUnits(localDir)
    expect(camera.position.length()).toBeGreaterThanOrEqual(target * 0.999)
    expect(camera.position.length()).toBeLessThan(target * 1.01)
  })
})

describe('CameraCollision: жёсткий стоп при исчерпании бюджета марча', () => {
  afterEach(() => heightFieldStorage.clear())

  it('бюджет исчерпан на касательном отрезке — камера не докатывается скольжением до конца', () => {
    // плоская карта: collisionRadiusUnits константа по любому направлению —
    // изотропная сфера-цель, поведение марча предсказуемо аналитически
    seedHeightMap(new Array(8).fill(65535), 4, 2, 0, 1000)
    const body = makeBody('planet', 1736, new Vector3(), undefined, MOON_HEIGHT_PATH)
    const field = terrainHeightFieldFor(
      (heightFieldStorage as unknown as { maps: Map<string, HeightMapData> }).maps.get(MOON_HEIGHT_PATH)!,
      1736
    )

    const target = field.collisionRadiusUnits(new Vector3(1, 0, 0))
    // высота над поверхностью: на 2 порядка больше epsilon контакта
    // (radius·1e-6), на 4 порядка меньше R — вдоль касательной d(p) почти не
    // меняется на масштабе шага
    const h = target * 1e-4
    const from = new Vector3(target + h, 0, 0)
    // отрезок вдоль Z — строго касательный к сфере-цели в точке старта
    // (перпендикулярен радиусу x̂). Длина 100h: шаг марча ~ d/(1+L) ≈ h/3
    // (L=SLOPE_RANGE=2), 64 шага покрывают ~21h — бюджет гарантированно
    // исчерпывается, не дойдя до конца отрезка (100h)
    const segmentLength = h * 100
    const position = from.clone().setZ(segmentLength)

    const { collision, camera } = makeCollision([body], from)

    collision.resolve() // фиксирует lastPosition = from
    camera.position.copy(position)
    collision.resolve()

    // прогресс есть (не no-op)…
    expect(camera.position.z).toBeGreaterThan(h * 5)
    // …но камера остановлена у точки исчерпания, а не докатилась скольжением
    // до конца отрезка (старый код: скольжение почти не гасит касательное
    // движение при радиальной нормали — камера уезжала бы к z≈segmentLength)
    expect(camera.position.z).toBeLessThan(segmentLength * 0.5)
  })
})

describe('CameraCollision: свип — два терраформных тела в кадре', () => {
  afterEach(() => heightFieldStorage.clear())

  it('ближнее тело выигрывает: best-скретчи контакта/нормали не затёрты дальним кандидатом', () => {
    const NEAR_PATH = 'planets/near/near_height.raw'
    const FAR_PATH = 'planets/far/far_height.raw'
    // оба тела плоские (флэт), но разного физического радиуса — контакт по
    // ближнему телу численно отличим от контакта по дальнему
    seedHeightMap(new Array(8).fill(65535), 4, 2, 0, 0, NEAR_PATH)
    seedHeightMap(new Array(8).fill(65535), 4, 2, 0, 0, FAR_PATH)

    const nearRadiusKm = 1000
    const farRadiusKm = 2000
    const near = makeBody('planet', nearRadiusKm, new Vector3(0, 0, 0), undefined, NEAR_PATH)
    const nearField = terrainHeightFieldFor(
      (heightFieldStorage as unknown as { maps: Map<string, HeightMapData> }).maps.get(NEAR_PATH)!,
      nearRadiusKm
    )
    const nearTarget = nearField.collisionRadiusUnits(new Vector3(1, 0, 0))

    // дальнее тело — далеко за ближним по той же оси: тоже валидный
    // кандидат марча (свой настоящий контакт), но camera должна остановиться
    // на ближнем
    const farCenterX = nearTarget * 5
    const far = makeBody('planet', farRadiusKm, new Vector3(farCenterX, 0, 0), undefined, FAR_PATH)
    const farField = terrainHeightFieldFor(
      (heightFieldStorage as unknown as { maps: Map<string, HeightMapData> }).maps.get(FAR_PATH)!,
      farRadiusKm
    )
    const farTarget = farField.collisionRadiusUnits(new Vector3(-1, 0, 0))

    // порядок массива важен: ближнее тело оценивается ПЕРВЫМ и становится
    // best-кандидатом, дальнее — ВТОРЫМ и перезаписывает скретч текущего
    // хита уже после того, как ближнее сохранилось в best — регрессия на
    // затирание скретчей второй проверкой
    const { collision, camera } = makeCollision([near, far], new Vector3(-nearTarget * 2, 0, 0))

    collision.resolve() // фиксирует lastPosition
    camera.position.set(farCenterX + farTarget * 2, 0, 0) // отрезок насквозь через оба тела
    collision.resolve()

    // контакт принадлежит БЛИЖНЕМУ телу: камера остановилась у его
    // поверхности со стороны подлёта (не проехала сквозь него к дальнему,
    // не получила контакт/нормаль дальнего тела)
    expect(camera.position.distanceTo(near.position)).toBeCloseTo(nearTarget, 3)
    expect(camera.position.distanceTo(far.position)).toBeGreaterThan(farTarget)
    expect(camera.position.clone().normalize().dot(new Vector3(-1, 0, 0))).toBeGreaterThan(0.99)
  })
})

describe('CameraCollision: двухфазный контакт — поточечное доуточнение после консервативного марча', () => {
  afterEach(() => heightFieldStorage.clear())

  // 2048×128 (block=2 от CLEARANCE_GRID_BASE_SEGMENTS=1024): яма глубиной
  // 10000 м в одном текселе (col100) на фоне 20000 м, все строки одинаковы
  // (north-south/cross обнуляются, чистая east-west проверка). Сетка провиса
  // (MAX-агрегация по ячейке + дилатация 3×3) размазывает провис ямы на
  // соседние ячейки: у col102 (2 текселя от ямы — вне прямой досягаемости
  // второй разности) clearanceMeters ≈ 10005 м, хотя ЛОКАЛЬНО рельеф там
  // абсолютно гладкий — sagMeters(col102) = 0 (замерено эмпирически,
  // vite-node). Дискриминатор старого (пуш-аут на сетку) и нового
  // (доуточнение по sagMeters) поведения.
  const DISTANT_KINK_PATH = 'planets/distant-kink/height.raw'
  const KINK_WIDTH = 2048
  const KINK_QUERY_COL = 102

  function distantKinkBody(): { body: Object3D; field: TerrainHeightField } {
    const height = 128
    const values = new Array(KINK_WIDTH * height).fill(20000)
    const pitCol = 100
    for (let y = 0; y < height; y++) values[y * KINK_WIDTH + pitCol] = 10000

    ;(heightFieldStorage as unknown as { maps: Map<string, unknown> }).maps.set(DISTANT_KINK_PATH, {
      width: KINK_WIDTH,
      height,
      minMeters: 0,
      maxMeters: 65535,
      data: new Uint16Array(values)
    })
    const body = makeBody('planet', 1736, new Vector3(), undefined, DISTANT_KINK_PATH)
    const field = terrainHeightFieldFor(
      (heightFieldStorage as unknown as { maps: Map<string, HeightMapData> }).maps.get(DISTANT_KINK_PATH)!,
      1736
    )
    return { body, field }
  }

  // направление по долготе (v=0.5, экватор) — та же обратная формула, что и
  // в блоке «свип по рельефу» выше
  const dirAtCol = (col: number): Vector3 => {
    const phi = ((col + 0.5) / KINK_WIDTH) * 2 * Math.PI
    return new Vector3(-Math.cos(phi), 0, Math.sin(phi))
  }

  it('фикстура честно дискриминирует: клиренс сетки завышен, поточечный провис — нет', () => {
    const { field } = distantKinkBody()
    const dir = dirAtCol(KINK_QUERY_COL)

    expect(field.sagMeters(dir)).toBeCloseTo(0, 6)
    expect(field.clearanceMeters(dir)).toBeGreaterThan(1000)
  })

  it('пуш-аут садит камеру на честный поточечный пол (margin), не на завышенный клиренс сетки', () => {
    const { body, field } = distantKinkBody()
    const dir = dirAtCol(KINK_QUERY_COL)

    // камера чуть ниже рельефа — глубоко под ОБЕИМИ поверхностями (сеточной
    // и поточечной), пуш-аут обязан сработать вне зависимости от исхода теста
    const start = dir.clone().multiplyScalar(field.surfaceRadiusUnits(dir) * 0.9999)
    const { collision, camera } = makeCollision([body], start)

    collision.resolve()

    const landedAltitudeMeters = ((camera.position.length() - field.surfaceRadiusUnits(dir)) / SpaceScale) * 1000

    // честный пол: h + margin (запас на билинейный бленд sagMeters между
    // текселями) — старое поведение (пуш-аут на сеточный collisionRadiusUnits)
    // посадило бы камеру на ~10005 м, что этот тест ловит как RED
    expect(landedAltitudeMeters).toBeGreaterThanOrEqual(CLEARANCE_MARGIN_METERS - 1)
    expect(landedAltitudeMeters).toBeLessThan(50)
  })

  it('свип сквозь ту же зону доуточняет контакт до поточечного пола, а не консервативной сетки', () => {
    const { body, field } = distantKinkBody()
    const dir = dirAtCol(KINK_QUERY_COL)

    // старт высоко (вне обеих поверхностей), финиш — глубоко под рельефом на
    // том же направлении: свип обязан поймать контакт по пути и остановить
    // камеру у честного пола, не у сеточного клиренса
    const highAltitude = field.surfaceRadiusUnits(dir) * 1.5
    const belowGround = field.surfaceRadiusUnits(dir) * 0.5
    const { collision, camera } = makeCollision([body], dir.clone().multiplyScalar(highAltitude))

    collision.resolve() // фиксирует lastPosition
    camera.position.copy(dir).multiplyScalar(belowGround)
    collision.resolve()

    const localDir = camera.position.clone().normalize()
    const landedAltitudeMeters = ((camera.position.length() - field.surfaceRadiusUnits(localDir)) / SpaceScale) * 1000

    expect(landedAltitudeMeters).toBeGreaterThanOrEqual(CLEARANCE_MARGIN_METERS - 1)
    expect(landedAltitudeMeters).toBeLessThan(50)
  })

  // «крутая стена по-прежнему тормозит свип, доуточнение не открывает
  // туннель» (design п.4в раунда 3) — уже покрыто существующим блоком
  // «CameraCollision: свип по рельефу» выше (checkerboard-фикстура 20000/0 м,
  // реальный крутой склон): все три его теста прошли без изменений после
  // раунда 3 — сама геометрическая инвариантность march'а (`marchTerrain`) не
  // тронута, доуточнение (`marchPointwise`, короткий довесок после
  // консервативного контакта) включается ТОЛЬКО постфактум и никогда не
  // расширяет область поиска НАЗАД за пройденный маршем путь. Отдельная
  // стена-фикстура здесь избыточна — на карте 2048 текселей/экватор (эта,
  // «дальний излом») одна текселевая яма даёт слишком пологий угловой профиль
  // для самостоятельной проверки того же инварианта, повторять его с той же
  // фикстурой смысла не имеет.
})

describe('CameraCollision: марч не пропускается, когда старт уже внутри консервативной оболочки', () => {
  afterEach(() => heightFieldStorage.clear())

  // 2048×128: фон 20000 м, широкий хребет (не единичная яма — реальная
  // стена) на колонках 60..80 поднят до 60000 м (на 40000 м выше фона).
  // col40 — плоский участок вдали от хребта: clearanceMeters(col40) = margin
  // (5 м, замерено эмпирически) — «оболочка» там означает буквально «в
  // считаных метрах от земли», не какой-то особый крайний случай. Именно
  // такая узкая оболочка и есть штатная посадочная высота после раунда 3
  // (честный пол ~margin на гладких участках) — старт внутри неё теперь
  // обычное дело, не редкость.
  const RIDGE_PATH = 'planets/ridge/height.raw'
  const WIDTH = 2048

  function ridgeBody(): { body: Object3D; field: TerrainHeightField } {
    const height = 128
    const values = new Array(WIDTH * height).fill(20000)
    for (let y = 0; y < height; y++) {
      for (let x = 60; x <= 80; x++) values[y * WIDTH + x] = 60000
    }

    ;(heightFieldStorage as unknown as { maps: Map<string, unknown> }).maps.set(RIDGE_PATH, {
      width: WIDTH,
      height,
      minMeters: 0,
      maxMeters: 65535,
      data: new Uint16Array(values)
    })
    const body = makeBody('planet', 1736, new Vector3(), undefined, RIDGE_PATH)
    const field = terrainHeightFieldFor(
      (heightFieldStorage as unknown as { maps: Map<string, HeightMapData> }).maps.get(RIDGE_PATH)!,
      1736
    )
    return { body, field }
  }

  const dirAtCol = (col: number): Vector3 => {
    const phi = ((col + 0.5) / WIDTH) * 2 * Math.PI
    return new Vector3(-Math.cos(phi), 0, Math.sin(phi))
  }

  it('быстрый тангенциальный пролёт из оболочки сквозь реальный хребет ловится маршем, а не проезжает насквозь', () => {
    const { body, field } = ridgeBody()
    const startDir = dirAtCol(40) // плоско, вдали от хребта
    const endDir = dirAtCol(70) // вершина хребта (h=60000)

    // старт — на 2.5 м над честным полом col40 (внутри margin-оболочки:
    // clearanceMeters(col40)=5 м ⇒ collisionRadiusUnits = surfaceRadiusUnits+5м,
    // старт заведомо НИЖЕ этой границы — distance(from) ≤ 0 в marchTerrain)
    const startAltitudeUnits = toThreeJSUnits(0.0025) // 2.5 м в юнитах three.js (км/1000... toThreeJSUnits ждёт км)
    const start = startDir.clone().multiplyScalar(field.surfaceRadiusUnits(startDir) + startAltitudeUnits)
    // финиш — та же (низкая, ~col40-уровня) высота, но направление col70:
    // если сегмент не поймать, камера окажется на ~40 км НИЖЕ реальной
    // поверхности хребта в этой точке (60000 м рельефа против ~20000 м
    // высоты полёта) — грубый, недвусмысленный туннель
    const end = endDir.clone().multiplyScalar(field.surfaceRadiusUnits(startDir) + startAltitudeUnits)

    const { collision, camera } = makeCollision([body], start)
    collision.resolve() // фиксирует lastPosition
    camera.position.copy(end)
    collision.resolve()

    const localDir = camera.position.clone().normalize()
    // старый код (RED, подтверждено через git stash): march пропускается
    // целиком (старт внутри консервативной оболочки col40), позиция долетает
    // ровно до endDir, push-out лишь поднимает радиус локально в НАПРАВЛЕНИИ
    // endDir (=dirAtCol(70)) — dot(endDir) ≈ 1, ничем не выдавая, что путь
    // прошёл сквозь хребет. Новый код обязан затормозить НА хребте по пути —
    // итоговое направление заметно отличается от endDir
    expect(localDir.dot(endDir)).toBeLessThan(0.999)
    // и не встроена глубже своего честного пола в итоговом направлении
    const target = field.surfaceRadiusUnits(localDir) + toThreeJSUnits((field.sagMeters(localDir) + CLEARANCE_MARGIN_METERS) / 1000)
    expect(camera.position.length()).toBeGreaterThanOrEqual(target * 0.999)
  })
})

// Task 5 (water-foundation): пол контакта становится R + max(h(dir̂), уровень)
// во всех трёх слоях коллизии (пуш-аут/поточечный марч, внешний консервативный
// марч по сетке клиренса, широкая фаза collectColliders). Уровень доставляется
// как ручка тела (renderingObject.data.waterLevelMeters, см. cameraCollisionStubs) —
// поле высот его не хранит (кэш общий по карте+радиусу, см. terrainHeightFieldFor).
describe('collectColliders: широкая фаза учитывает уровень воды', () => {
  afterEach(() => heightFieldStorage.clear())

  it('уровень воды НИЖЕ maxMeters карты — радиус широкой фазы не меняется (бит-в-бит без влияния)', () => {
    seedHeightMap(new Array(8).fill(65535), 4, 2, 0, 10000)
    const withoutWater = makeBody('planet', 1736, new Vector3(), undefined, MOON_HEIGHT_PATH)
    const withWater = makeBody('planet', 1736, new Vector3(), undefined, MOON_HEIGHT_PATH, 500)

    const a = collectColliders([withoutWater])[0]
    const b = collectColliders([withWater])[0]

    expect(b.radius).toBeCloseTo(a.radius, 10)
  })

  it('уровень воды ВЫШЕ maxMeters карты (гипотетическое глобальное море) — широкая фаза расширяется до уровня', () => {
    seedHeightMap(new Array(8).fill(65535), 4, 2, 0, 10000)
    const body = makeBody('planet', 1736, new Vector3(), undefined, MOON_HEIGHT_PATH, 50000)

    const collider = collectColliders([body])[0]

    expect(collider.radius).toBeCloseTo(
      toThreeJSUnits(1736 + 50000 / 1000 + collider.heightField!.maxClearanceMeters / 1000),
      10
    )
  })
})

// 64×2: два ОДНОРОДНЫХ полушария (не чекерборд — у чекерборда из terrainBody()
// соседние текселя различаются на всю амплитуду, и sagMeters там сам по себе
// уже в half-амплитуду, что мешает дискриминатору «пол = уровень воды, не
// рельеф»). Западное полушарие (col 0..31) — океан (−5000 м), восточное
// (col 32..63) — суша (20000 м). Направления берутся вдали от границы (по
// 23-24 текселя запаса на каждую сторону) — sagMeters/clearanceMeters там
// честно ≈0 (однородные соседи), дискриминатор чист.
const WATER_TERRAIN_PATH = 'planets/water-terrain/height.raw'
const WATER_TERRAIN_WIDTH = 64

function waterTerrainBody(waterLevelMeters: number | undefined): { body: Object3D; field: TerrainHeightField } {
  const oceanRaw = 0 // → −5000 м (minMeters)
  const landRaw = 65535 // → 20000 м (maxMeters)
  const row = new Array(WATER_TERRAIN_WIDTH).fill(oceanRaw)
  for (let x = WATER_TERRAIN_WIDTH / 2; x < WATER_TERRAIN_WIDTH; x++) row[x] = landRaw
  seedHeightMap([...row, ...row], WATER_TERRAIN_WIDTH, 2, -5000, 20000, WATER_TERRAIN_PATH)
  const body = makeBody('planet', 1736, new Vector3(), undefined, WATER_TERRAIN_PATH, waterLevelMeters)
  const field = terrainHeightFieldFor(
    (heightFieldStorage as unknown as { maps: Map<string, HeightMapData> }).maps.get(WATER_TERRAIN_PATH)!,
    1736
  )
  return { body, field }
}

// центр текселя вдали от границы полушарий: col=8 (океан) / col=48 (суша) —
// та же обратная формула dirToUv, что и в блоке «свип по рельефу» выше
const dirAtWaterCol = (col: number): Vector3 => {
  const phi = ((col + 0.5) / WATER_TERRAIN_WIDTH) * 2 * Math.PI
  return new Vector3(-Math.cos(phi), 0, Math.sin(phi))
}
const OCEAN_INTERIOR_DIR = dirAtWaterCol(8)
const LAND_INTERIOR_DIR = dirAtWaterCol(48)

describe('CameraCollision: пуш-аут по воде (поточечный sagMeters-пол, Task 5)', () => {
  afterEach(() => heightFieldStorage.clear())

  it('впадина под водой — пуш-аут поднимает камеру до уровня воды, а не до честного пола рельефа', () => {
    const waterLevelMeters = 0
    const { body, field } = waterTerrainBody(waterLevelMeters)
    const dir = OCEAN_INTERIOR_DIR // h=−5000 м, вдали от берега — глубоко под уровнем воды

    const waterFloor = toThreeJSUnits(1736 + waterLevelMeters / 1000)
    // пол воды несёт тот же CLEARANCE_MARGIN_METERS, что и пол суши (ревью
    // Task 5, фикс-раунд 1, находка №5) — камера садится не на аналитическую
    // плоскость воды ровно, а с тем же запасом, что у честного пола рельефа
    const waterFloorWithMargin = waterFloor + toThreeJSUnits(CLEARANCE_MARGIN_METERS / 1000)
    expect(field.surfaceRadiusUnits(dir)).toBeLessThan(waterFloor - toThreeJSUnits(4)) // рельеф честно ниже уровня

    const start = dir.clone().multiplyScalar(field.surfaceRadiusUnits(dir) * 0.9)
    const { collision, camera } = makeCollision([body], start)

    collision.resolve()

    expect(camera.position.length()).toBeCloseTo(waterFloorWithMargin, 6)
    expect(camera.position.clone().normalize().dot(dir)).toBeCloseTo(1, 6)
  })

  it('без ручки waterLevelMeters — пуш-аут по-прежнему садится на честный поточечный пол впадины (бит-в-бит)', () => {
    const { body, field } = waterTerrainBody(undefined)
    const dir = OCEAN_INTERIOR_DIR

    const start = dir.clone().multiplyScalar(field.surfaceRadiusUnits(dir) * 0.9)
    const { collision, camera } = makeCollision([body], start)

    collision.resolve()

    const landedAltitudeMeters = ((camera.position.length() - field.surfaceRadiusUnits(dir)) / SpaceScale) * 1000
    expect(landedAltitudeMeters).toBeGreaterThanOrEqual(CLEARANCE_MARGIN_METERS - 1)
    expect(landedAltitudeMeters).toBeLessThan(50)
  })

  it('суша выше уровня воды — пуш-аут не тронут (вода не поднимает пол там, где рельеф уже выше)', () => {
    const waterLevelMeters = 0
    const { body, field } = waterTerrainBody(waterLevelMeters)
    const dir = LAND_INTERIOR_DIR // h=20000 м, вдали от берега — суша выше уровня воды

    const altitude = field.collisionRadiusUnits(dir) * 1.0001
    const { collision, camera } = makeCollision([body], dir.clone().multiplyScalar(altitude))

    collision.resolve()

    expect(camera.position.length()).toBeCloseTo(altitude, 10)
  })
})

// Ревью Task 5, фикс-раунд 1, находка №2: нормаль контакта над водой обязана
// быть радиальной (p̂), а не взятой с дна (surfaceNormalLocal) — иначе
// скольжение у берега ныряет/подпрыгивает вслед за невидимым под водой
// рельефом. Дискриминатор — СРАВНЕНИЕ: тело A несёт реальный (ненулевой,
// СЕВЕР-ЮГ) склон дна, тело B — плоское дно (то же среднее значение) с той
// же честной точкой контакта; оба на 20+ км ниже уровня воды, вода — везде
// доминирующий пол. Если нормаль контакта радиальна (не берётся с дна),
// склон дна тела A вообще не участвует в вычислении — итог свипа обязан
// СОВПАСТЬ с плоским телом B (плоское дно и само по себе даёт радиальную
// нормаль — стабильный, не зависящий от фикса ориентир). Расхождение между
// A и B означало бы, что нормаль всё ещё частично берётся с дна.
const NORMAL_PATH_SLOPED = 'planets/normal-water-sloped/height.raw'
const NORMAL_PATH_FLAT = 'planets/normal-water-flat/height.raw'
const NORMAL_WIDTH = 8
const NORMAL_HEIGHT = 4
const NORMAL_MIN_M = -40000
const NORMAL_MAX_M = 40000
const normalRawFor = (meters: number): number => Math.round(((meters - NORMAL_MIN_M) / (NORMAL_MAX_M - NORMAL_MIN_M)) * 65535)

function normalTestBody(path: string, sloped: boolean, waterLevelMeters: number): { body: Object3D; field: TerrainHeightField } {
  // sloped: строки −31500,−28500,−25500,−22500 (север-юг рамп, 3000 м/строка,
  // среднее −27000); flat: все строки на среднем значении −27000 —
  // одинаковая ЧЕСТНАЯ высота в интересующей точке (экватор, между строками
  // 1 и 2), разный только градиент вокруг неё
  const values: number[] = []
  for (let row = 0; row < NORMAL_HEIGHT; row++) {
    const meters = sloped ? -31500 + row * 3000 : -27000
    for (let col = 0; col < NORMAL_WIDTH; col++) values.push(normalRawFor(meters))
  }
  seedHeightMap(values, NORMAL_WIDTH, NORMAL_HEIGHT, NORMAL_MIN_M, NORMAL_MAX_M, path)
  const body = makeBody('planet', 1736, new Vector3(), undefined, path, waterLevelMeters)
  const field = terrainHeightFieldFor((heightFieldStorage as unknown as { maps: Map<string, HeightMapData> }).maps.get(path)!, 1736)
  return { body, field }
}

describe('CameraCollision: нормаль контакта над водой радиальна, не с дна (Task 5, фикс-раунд 1, находка №2)', () => {
  afterEach(() => heightFieldStorage.clear())

  it('скольжение над глубокой впадиной со СКЛОНОМ дна не отличается от скольжения над плоским дном — нормаль радиальна, склон не участвует', () => {
    const waterLevelMeters = 0
    const { field: slopedField } = normalTestBody(NORMAL_PATH_SLOPED, true, waterLevelMeters)

    const waterFloorWithMargin = toThreeJSUnits(1736 + waterLevelMeters / 1000) + toThreeJSUnits(CLEARANCE_MARGIN_METERS / 1000)
    const dir0 = new Vector3(1, 0, 0)
    // честный рельеф здесь на 20+ км ниже уровня воды — вода однозначно доминирующий пол
    expect(slopedField.surfaceRadiusUnits(dir0)).toBeLessThan(waterFloorWithMargin - toThreeJSUnits(20))

    // тот же диагональный свип, что и в «движение под углом скользит по
    // поверхности» (плоская сфера) выше — далёкий старт, прицел за центр:
    // надёжно даёт ОДИН чистый контакт+скольжение, без чехарды эпсилон-нюансов
    // прямого старта ровно на границе (там, где начиналась исходная фикстура)
    const runSweep = (path: string, sloped: boolean): Vector3 => {
      const { body } = normalTestBody(path, sloped, waterLevelMeters)
      const { collision, camera } = makeCollision([body], new Vector3(-waterFloorWithMargin * 2, waterFloorWithMargin * 0.5, 0))

      collision.resolve()
      camera.position.set(0, waterFloorWithMargin * 0.5, 0)
      collision.resolve()

      return camera.position.clone()
    }

    const slopedResult = runSweep(NORMAL_PATH_SLOPED, true)
    const flatResult = runSweep(NORMAL_PATH_FLAT, false)

    // не прилипла к контакту (тот же базовый инвариант, что и у плоской сферы)
    expect(slopedResult.length()).toBeGreaterThanOrEqual(waterFloorWithMargin - toThreeJSUnits(0.001))
    expect(slopedResult.y).toBeGreaterThan(waterFloorWithMargin * 0.5 * 0.9)

    // главный дискриминатор: склон дна (недостижимого честного рельефа под
    // водой) не отличим от плоского дна — нормаль контакта не берёт его в расчёт
    expect(slopedResult.x).toBeCloseTo(flatResult.x, 6)
    expect(slopedResult.y).toBeCloseTo(flatResult.y, 6)
    expect(slopedResult.z).toBeCloseTo(flatResult.z, 6)
  })
})

describe('CameraCollision: марч не туннелирует под уровень воды (Task 5, RED-фикстура)', () => {
  afterEach(() => heightFieldStorage.clear())

  // Плоское дно на 40 км ниже уровня воды ВЕЗДЕ (min=max=−40000 м) — та же
  // амплитуда провала, что у фикстуры «хребет 40 км» этапа 4 (см.
  // «CameraCollision: марч не пропускается…» выше), но без ридж-геометрии:
  // дискриминатор здесь — САГИТТА хорды быстрого тангенциального свипа между
  // двумя точками на сфере уровня воды, а не рельеф. Без клампа воды честный
  // террейновый пол (R−40000 м) остаётся так далеко внизу, что старый марч не
  // находит вдоль хорды ни одной обструкции — камера долетает до конца
  // отрезка, провалившись на километры НИЖЕ уровня воды (тоннель).
  const FLAT_DEEP_PATH = 'planets/flat-deep/height.raw'
  const RADIUS_KM = 1736

  function flatDeepBody(waterLevelMeters: number): { body: Object3D; field: TerrainHeightField } {
    seedHeightMap(new Array(8 * 4).fill(0), 8, 4, -40000, 40000, FLAT_DEEP_PATH)
    const body = makeBody('planet', RADIUS_KM, new Vector3(), undefined, FLAT_DEEP_PATH, waterLevelMeters)
    const field = terrainHeightFieldFor(
      (heightFieldStorage as unknown as { maps: Map<string, HeightMapData> }).maps.get(FLAT_DEEP_PATH)!,
      RADIUS_KM
    )
    return { body, field }
  }

  it('быстрый тангенциальный пролёт над глубокой впадиной ПОД водой не туннелирует под уровень', () => {
    const waterLevelMeters = 0
    const { body, field } = flatDeepBody(waterLevelMeters)

    const waterFloor = toThreeJSUnits(RADIUS_KM + waterLevelMeters / 1000)
    // рельеф честно на 40 км ниже уровня воды — без клампа обструкции по пути нет
    expect(field.surfaceRadiusUnits(new Vector3(1, 0, 0))).toBeLessThan(waterFloor - toThreeJSUnits(39))

    const THETA = (10 * Math.PI) / 180 // угловой разнос старт→финиш
    const startDir = new Vector3(1, 0, 0)
    const endDir = new Vector3(Math.cos(THETA), 0, Math.sin(THETA))
    // 5 км над уровнем воды — заведомо вне узкой margin-оболочки (внешняя,
    // консервативная фаза марча, не поточечная): сагитта хорды на этом угле
    // (~1.6 км при R≈1736 км) продавливает её НИЖЕ уровня воды у середины
    // отрезка, оставаясь на десятки км выше честного дна
    const altitudeUnits = toThreeJSUnits(5)
    const start = startDir.clone().multiplyScalar(waterFloor + altitudeUnits)
    const end = endDir.clone().multiplyScalar(waterFloor + altitudeUnits)

    const { collision, camera } = makeCollision([body], start)
    collision.resolve() // фиксирует lastPosition
    camera.position.copy(end)
    collision.resolve()

    // не туннелирует под уровень воды (запас на эпсилон контакта)
    expect(camera.position.length()).toBeGreaterThanOrEqual(waterFloor - toThreeJSUnits(0.01))
    // и реально была остановлена по пути — не долетела до наивного финиша
    // (иначе тест не отличает старое поведение от нового)
    expect(camera.position.clone().normalize().dot(endDir)).toBeLessThan(0.999)
  })

  it('без ручки waterLevelMeters — то же движение не ловится (бит-в-бит): камера долетает до финиша', () => {
    seedHeightMap(new Array(8 * 4).fill(0), 8, 4, -40000, 40000, FLAT_DEEP_PATH)
    const bodyNoWater = makeBody('planet', RADIUS_KM, new Vector3(), undefined, FLAT_DEEP_PATH)

    const surfaceRadius = toThreeJSUnits(RADIUS_KM) // приблизительный ориентир масштаба, не честный пол
    const THETA = (10 * Math.PI) / 180
    const startDir = new Vector3(1, 0, 0)
    const endDir = new Vector3(Math.cos(THETA), 0, Math.sin(THETA))
    const altitudeUnits = toThreeJSUnits(5)
    const start = startDir.clone().multiplyScalar(surfaceRadius + altitudeUnits)
    const end = endDir.clone().multiplyScalar(surfaceRadius + altitudeUnits)

    const { collision, camera } = makeCollision([bodyNoWater], start)
    collision.resolve()
    camera.position.copy(end)
    collision.resolve()

    // без воды честный рельеф на 40 км ниже — обструкции по пути нет вовсе,
    // камера долетает до наивного финиша нетронутой
    expect(camera.position.distanceTo(end)).toBeCloseTo(0, 6)
  })
})
