/** Пороги LOD в км: l0 (геометрия), l1 (билборд), l0Near (вход в ближний тир), l0NearExit (выход) */
interface LodThresholdsKm {
  l0: number
  l1: number
  l0Near: number
  l0NearExit: number
}

/** Окно Near не должно накрывать окно Geometry целиком — иначе тир Geometry недостижим */
export function assertLodInvariant(cellSizeKm: number, t: LodThresholdsKm): void {
  const halfDiagonal: number = cellSizeKm * Math.SQRT1_2

  if (t.l0 <= t.l0NearExit + halfDiagonal) {
    throw new Error(
      `LOD: l0 (${t.l0}) обязан быть больше l0NearExit + полудиагональ ячейки (${t.l0NearExit} + ${halfDiagonal.toFixed(0)})`
    )
  }
}
