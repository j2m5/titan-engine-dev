/**
 * SSE-отбор квадродерева рельефа (selectTerrainNodes): пороги гистерезиса
 * сплита/мержа узла в пикселях экранной ошибки.
 */
export interface TerrainConfig {
  terrain: {
    /**
     * Узел спускается глубже, когда его SSE превышает это число пикселей
     * (обозначается τ в замерах). Рабочий диапазон: τ=6 (дефолт) — быстрый
     * профиль, на орбите грубее статической кубосферы 3а (втрое по ε),
     * максимум FPS; τ≈2 — визуальный паритет с 3а на орбите; ниже 1.5 не
     * рекомендуется — на 4K желаемый набор упирается в потолок пула
     * (MAX_LIVE_PATCHES, см. TerrainPatchPool).
     */
    sseSplitPixels: number
    /**
     * Доля sseSplitPixels — порог схлопывания уже разбитого узла ниже
     * sseSplitPixels·sseMergeFactor. Меньше 1: гистерезис против дрожания
     * на границе порога кадр к кадру.
     */
    sseMergeFactor: number
    /**
     * Видимый диаметр тела в пикселях, при котором запрашивается его карта
     * высот. Много выше порога, на котором LOD меняет билборд на настоящий
     * меш (distanceLod(3) в RenderableFactory, ~3–4 px): карта успевает
     * доехать до того, как тело станет мешем.
     */
    heightMapLoadPixels: number
    /**
     * Видимый диаметр, ниже которого карта освобождается. Разрыв с
     * heightMapLoadPixels — гистерезис против качания 64 МиБ на границе.
     */
    heightMapReleasePixels: number
  }
}

export const terrain: TerrainConfig = {
  terrain: {
    sseSplitPixels: 6,
    sseMergeFactor: 0.7,
    heightMapLoadPixels: 32,
    heightMapReleasePixels: 16
  }
}
