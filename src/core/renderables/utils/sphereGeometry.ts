import { BufferAttribute, BufferGeometry, Sphere, SphereGeometry, Vector3 } from 'three'

/**
 * Единичная сфера N×N — исходник для копий. Строится один раз на сегментацию и
 * живёт до конца сессии: тригонометрия SphereGeometry на 256×256 стоит ~16 мс,
 * копия с масштабом — ~1,3 мс.
 */
interface SphereTemplate {
  readonly positions: Float32Array
  readonly normals: Float32Array
  readonly uvs: Float32Array
  readonly index: Uint16Array | Uint32Array
}

const templates: Map<number, SphereTemplate> = new Map()

function templateOf(segments: number): SphereTemplate {
  const cached: SphereTemplate | undefined = templates.get(segments)

  if (cached) return cached

  const unit: SphereGeometry = new SphereGeometry(1, segments, segments)
  const template: SphereTemplate = {
    positions: unit.getAttribute('position').array as Float32Array,
    normals: unit.getAttribute('normal').array as Float32Array,
    uvs: unit.getAttribute('uv').array as Float32Array,
    index: unit.index!.array as Uint16Array | Uint32Array
  }

  templates.set(segments, template)

  return template
}

/**
 * Множитель описанной сферы: многогранник N×N на радиусе r·factor не
 * проваливается внутрь истинной сферы радиуса r — ни одна грань не ближе r к
 * центру.
 */
export function circumscribeFactor(segments: number): number {
  return 1 / (Math.cos(Math.PI / segments) * Math.cos(Math.PI / (2 * segments)))
}

/** Строит и кэширует единичную заготовку N×N, если её ещё нет. */
export function warmSphereTemplate(segments: number): void {
  templateOf(segments)
}

/**
 * Сфера N×N радиуса radius (юниты сцены) — то же, что new SphereGeometry(radius, N, N),
 * но копией заготовки.
 *
 * Все массивы — собственные копии: three в dispose() удаляет GPU-буферы всех
 * атрибутов геометрии, и общий атрибут умер бы под соседом. После заливки
 * массивы не освобождаются — восстановление WebGL-контекста перезаливает их из
 * attribute.array.
 *
 * Ограничивающая сфера выставлена аналитически (центр 0, радиус radius — у
 * заготовки он 1 по построению), обход вершин computeBoundingSphere не нужен.
 * Результат — обычная BufferGeometry, без parameters.
 */
export function buildSphereGeometry(radius: number, segments: number): BufferGeometry {
  const template: SphereTemplate = templateOf(segments)
  const positions: Float32Array = new Float32Array(template.positions.length)

  for (let i = 0; i < positions.length; i++) positions[i] = template.positions[i] * radius

  const geometry: BufferGeometry = new BufferGeometry()

  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(template.normals.slice(), 3))
  geometry.setAttribute('uv', new BufferAttribute(template.uvs.slice(), 2))
  geometry.setIndex(new BufferAttribute(template.index.slice(), 1))
  geometry.boundingSphere = new Sphere(new Vector3(), radius)

  return geometry
}
