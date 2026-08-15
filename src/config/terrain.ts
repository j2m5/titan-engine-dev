/**
 * SSE-отбор квадродерева рельефа (selectTerrainNodes): пороги гистерезиса
 * сплита/мержа узла в пикселях экранной ошибки.
 */
export interface TerrainConfig {
  terrain: {
    /** Узел спускается глубже, когда его SSE превышает это число пикселей. */
    sseSplitPixels: number
    /**
     * Доля sseSplitPixels — порог схлопывания уже разбитого узла ниже
     * sseSplitPixels·sseMergeFactor. Меньше 1: гистерезис против дрожания
     * на границе порога кадр к кадру.
     */
    sseMergeFactor: number
  }
}

export const terrain: TerrainConfig = {
  terrain: {
    sseSplitPixels: 6,
    sseMergeFactor: 0.7
  }
}
