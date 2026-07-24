import { BufferAttribute, BufferGeometry, IcosahedronGeometry } from 'three'
import { ArchetypeShape } from './ArchetypeShape'

/**
 * Запекание меша архетипа: направления вершин икосферы → r(d) → позиция.
 * Нормали — из конечных разностей r(d) по касательному базису (нормаль
 * соответствует ФУНКЦИИ формы, не тесселяции — урок проекта «нормаль из
 * аналитического градиента»); скругление кромок несёт smooth-min самой r(d).
 * Выполняется один раз на загрузке — стоимость не рантаймовая.
 */
function buildArchetypeGeometry(
  shape: ArchetypeShape,
  detail: number,
  radius: number
): BufferGeometry {
  const source = new IcosahedronGeometry(1, detail)
  const sourcePos = source.getAttribute('position')
  const count = sourcePos.count

  const positions = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  const EPS = 1e-3

  for (let i = 0; i < count; i++) {
    let dx = sourcePos.getX(i)
    let dy = sourcePos.getY(i)
    let dz = sourcePos.getZ(i)
    const invLen = 1 / Math.hypot(dx, dy, dz)
    dx *= invLen
    dy *= invLen
    dz *= invLen

    const r = shape.radiusAt(dx, dy, dz)
    positions[i * 3] = dx * r * radius
    positions[i * 3 + 1] = dy * r * radius
    positions[i * 3 + 2] = dz * r * radius

    // Касательный базис к сфере в dir (устойчивый выбор опорной оси)
    const useY = Math.abs(dy) < 0.9
    // t1 = normalize(cross(up, dir)), up = Y либо X у полюсов
    let t1x = useY ? -dz : 0
    let t1y = useY ? 0 : dz
    let t1z = useY ? dx : -dy
    const t1n = 1 / Math.hypot(t1x, t1y, t1z)
    t1x *= t1n
    t1y *= t1n
    t1z *= t1n
    // t2 = cross(dir, t1)
    const t2x = dy * t1z - dz * t1y
    const t2y = dz * t1x - dx * t1z
    const t2z = dx * t1y - dy * t1x

    // Точки поверхности в четырёх соседних направлениях (центральные разности)
    const sample = (ox: number, oy: number, oz: number): [number, number, number] => {
      let sx = dx + ox
      let sy = dy + oy
      let sz = dz + oz
      const inv = 1 / Math.hypot(sx, sy, sz)
      sx *= inv
      sy *= inv
      sz *= inv
      const sr = shape.radiusAt(sx, sy, sz)
      return [sx * sr, sy * sr, sz * sr]
    }
    const pa = sample(t1x * EPS, t1y * EPS, t1z * EPS)
    const pb = sample(-t1x * EPS, -t1y * EPS, -t1z * EPS)
    const pc = sample(t2x * EPS, t2y * EPS, t2z * EPS)
    const pd = sample(-t2x * EPS, -t2y * EPS, -t2z * EPS)

    // Нормаль = нормированное векторное произведение касательных производных
    const ux = pa[0] - pb[0]
    const uy = pa[1] - pb[1]
    const uz = pa[2] - pb[2]
    const vx = pc[0] - pd[0]
    const vy = pc[1] - pd[1]
    const vz = pc[2] - pd[2]
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    // Ориентация наружу: вдоль dir
    if (nx * dx + ny * dy + nz * dz < 0) {
      nx = -nx
      ny = -ny
      nz = -nz
    }
    const nInv = 1 / Math.hypot(nx, ny, nz)
    normals[i * 3] = nx * nInv
    normals[i * 3 + 1] = ny * nInv
    normals[i * 3 + 2] = nz * nInv
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  source.dispose()
  return geometry
}

export { buildArchetypeGeometry }
