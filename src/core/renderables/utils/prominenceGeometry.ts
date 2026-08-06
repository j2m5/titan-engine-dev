import { BufferAttribute, BufferGeometry, Vector3 } from 'three'

/**
 * Геометрия петлевых протуберанцев звезды (см. StarOuterLayer).
 *
 * Одна лента — дуга между ДВУМЯ основаниями петли на единичной сфере: шейдер
 * соединяет основания и выгибает середину наружу. Ленты идут группами: с
 * вероятностью GROUP_RESTART_CHANCE очередная лента перевыбирает якоря, так
 * что подряд идущие ленты растут из одного места и вспыхивают вместе — это и
 * есть одна видимая вспышка.
 *
 * Радиус звезды сюда не входит: всё строится на единичной сфере, масштаб даёт
 * scale меша.
 */

/** Лент в слое — сколько петель строится на звезду */
export const PROMINENCE_RIBBON_COUNT: number = 2048
/** Сегментов вдоль дуги одной ленты */
export const PROMINENCE_SEGMENTS_PER_RIBBON: number = 16

/**
 * Вероятность, с которой очередная лента начинает НОВУЮ группу. При 0.025
 * группа живёт в среднем сорок лент — примерно полсотни вспышек на звезду
 */
const GROUP_RESTART_CHANCE: number = 0.025
/** Разлёт оснований петли внутри группы: чем больше, тем шире арка */
const GROUP_FOOT_SPREAD: number = 0.4
/** Дрожание оснований ленты вокруг якорей группы — ленты не сливаются в одну */
const FOOT_A_JITTER: number = 0.02
const FOOT_B_JITTER: number = 0.075

export interface ProminenceGeometryOptions {
  ribbonCount?: number
  segmentsPerRibbon?: number
}

/** Случайное направление на единичной сфере (грубая выборка из куба) */
function randomUnitVector(target: Vector3): Vector3 {
  return target.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize()
}

export function buildProminenceGeometry(options?: ProminenceGeometryOptions): BufferGeometry {
  const {
    ribbonCount = PROMINENCE_RIBBON_COUNT,
    segmentsPerRibbon = PROMINENCE_SEGMENTS_PER_RIBBON
  } = { ...options }

  const vertexCount: number = ribbonCount * segmentsPerRibbon * 2

  const ribbon = new Float32Array(vertexCount * 2)
  const footA = new Float32Array(vertexCount * 3)
  const footB = new Float32Array(vertexCount * 3)
  const ribbonRandom = new Float32Array(vertexCount * 3)
  // Uint32, а не Uint16: на дефолтах вершин ровно 65536, то есть последний
  // индекс — последнее представимое в 16 битах число. Любая правка плотности
  // заворачивала бы хвост индексов в начало буфера молча
  const indices = new Uint32Array(ribbonCount * (segmentsPerRibbon - 1) * 6)

  const groupFootA = new Vector3()
  const groupFootB = new Vector3()
  const currentFootA = new Vector3()
  const currentFootB = new Vector3()
  const jitter = new Vector3()

  let ribbonCursor = 0
  let footACursor = 0
  let footBCursor = 0
  let randomCursor = 0
  let indexCursor = 0

  // Фаза и скорость вспышки общие на группу: ленты одной вспышки растут разом
  let groupEruptionOffset = 0
  let groupEruptionSpeed = 0

  for (let r = 0; r < ribbonCount; r++) {
    if (r === 0 || Math.random() < GROUP_RESTART_CHANCE) {
      randomUnitVector(groupFootA)
      groupFootB
        .copy(groupFootA)
        .add(randomUnitVector(jitter).multiplyScalar(GROUP_FOOT_SPREAD))
        .normalize()
      groupEruptionOffset = Math.random()
      groupEruptionSpeed = Math.random()
    }

    currentFootA
      .copy(groupFootA)
      .add(randomUnitVector(jitter).multiplyScalar(FOOT_A_JITTER))
      .normalize()
    currentFootB
      .copy(groupFootB)
      .add(randomUnitVector(jitter).multiplyScalar(FOOT_B_JITTER))
      .normalize()

    const colorMix: number = Math.random()

    for (let segment = 0; segment < segmentsPerRibbon; segment++) {
      // Середина сегмента, а не его край: фаза никогда не равна 0 или 1, и
      // выгиб дуги sin(phase * PI) не вырождается в ноль на концах ленты
      const phase: number = (segment + 0.5) / segmentsPerRibbon
      const base: number = 2 * (r * segmentsPerRibbon + segment)

      for (let side = 0; side <= 1; side++) {
        ribbon[ribbonCursor++] = phase
        ribbon[ribbonCursor++] = 2 * side - 1

        footA[footACursor++] = currentFootA.x
        footA[footACursor++] = currentFootA.y
        footA[footACursor++] = currentFootA.z

        footB[footBCursor++] = currentFootB.x
        footB[footBCursor++] = currentFootB.y
        footB[footBCursor++] = currentFootB.z

        ribbonRandom[randomCursor++] = groupEruptionOffset
        ribbonRandom[randomCursor++] = groupEruptionSpeed
        ribbonRandom[randomCursor++] = colorMix
      }

      // Два треугольника на СТЫК соседних сегментов: у последнего сегмента
      // ленты следующего нет, поэтому стыков на один меньше
      if (segment < segmentsPerRibbon - 1) {
        indices[indexCursor++] = base
        indices[indexCursor++] = base + 1
        indices[indexCursor++] = base + 2
        indices[indexCursor++] = base + 2
        indices[indexCursor++] = base + 1
        indices[indexCursor++] = base + 3
      }
    }
  }

  const geometry = new BufferGeometry()

  geometry.setAttribute('aRibbon', new BufferAttribute(ribbon, 2))
  geometry.setAttribute('aFootA', new BufferAttribute(footA, 3))
  geometry.setAttribute('aFootB', new BufferAttribute(footB, 3))
  geometry.setAttribute('aRibbonRandom', new BufferAttribute(ribbonRandom, 3))
  geometry.setIndex(new BufferAttribute(indices, 1))

  return geometry
}
