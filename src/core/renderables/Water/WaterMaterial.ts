import { MeshBasicMaterial } from 'three'

/**
 * Материал водной оболочки. Task 3 — плейсхолдер (однотонный полупрозрачный):
 * Task 4 переписывает тело класса на честный шейдер (нормали волн, Френель,
 * отражение) — точка замены единственная, WaterSphere класс материала не
 * трогает.
 *
 * transparent+depthWrite:false — берег даёт буфер глубины сам (пересечение
 * рельефа и оболочки), без масок и швов; вода не должна перекрывать
 * z-порядок того, что уже нарисовано под ней. depthTest остаётся включённым —
 * вода за рельефом (с обратной стороны тела) не рисуется поверх него.
 */
class WaterMaterial extends MeshBasicMaterial {
  public constructor() {
    super({
      color: 0x1f4f6b,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      depthTest: true
    })
  }
}

export { WaterMaterial }
