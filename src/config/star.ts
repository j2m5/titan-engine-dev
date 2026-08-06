/**
 * Звезда: билборд-импостор (LOD-уровень 2) и переключение LOD.
 *
 * Видимый размер импостора в пикселях (STAR_IMPOSTOR_PIXELS = 12) живёт в
 * core/helpers/apparentSize.ts и в конфиг не выносится намеренно: по нему
 * сведён стык LOD, вызывающей стороне нечем его подменить.
 */
export interface StarConfig {
  star: {
    /**
     * HDR-множитель яркости билборда — прежний emissiveIntensity
     * MeshStandardMaterial, перенесён как есть. Цвет билборда =
     * buildStarPalette(T).base × этот множитель; порог bloom (1.0)
     * перекрывается с запасом — дальняя звезда продолжает светиться.
     */
    impostorIntensity: number
    /**
     * Гистерезис LOD — доля дистанции переключения (LOD.addLevel, third arg).
     * Диск → билборд на дистанции d, обратно — на d·(1−h): при возврате диск
     * появляется на 12/(1−h) px вместо 12. При 0.05 это ~12.6px
     * (неразличимо). У чёрной дыры 0.3 — там стык не сведён по размеру;
     * здесь крупное значение дало бы видимый скачок (~17px).
     */
    lodHysteresis: number
  }
}

export const star: StarConfig = {
  star: {
    impostorIntensity: 40,
    lodHysteresis: 0.05
  }
}
