import { Color, Vector3 } from 'three'

export interface NebulaParametersInit {
  /** Детерминированный seed генерации (уходит в 4-ю координату snoise) */
  seed?: number
  /** Центр объёма в мировых координатах Three.js */
  center?: Vector3
  /** Радиус bounding-объёма в объектных единицах Three.js (полу-сторона куба) */
  radius?: number
  /** Базовый цвет эмиссии газа */
  emissionColor?: Color
  /** HDR-усиление эмиссии (> 1 → bloom) */
  intensity?: number
  /**
   * Сила эмиссии относительно поглощения. Для оптически-ТОНКОЙ туманности
   * держим высокой при низком sigma: газ ярко светится, но почти не
   * загораживает сам себя — луч копит свет по всей длине.
   */
  emissionStrength?: number
  /**
   * Порог bloom: яркость тела газа поджимается примерно к этому уровню, и
   * только плотные ядра пробивают порог luminance композера (=1.0). Держим
   * чуть ниже 1.0, чтобы основной объём светился мягко, без тотального bloom.
   */
  bloomThreshold?: number
  /**
   * Степень сжатия плотности в канале ПОГЛОЩЕНИЯ (0..1). Значение < 1 не даёт
   * плотным ядрам уходить в непрозрачность: сквозь них продолжают просвечивать
   * звёзды. 1.0 — поглощение линейно по плотности (плотные зоны кроют фон);
   * 0.5 — корень (плотные зоны заметно прозрачнее); 0.3 — очень прозрачные.
   */
  absorptionPower?: number

  // ── Поле плотности (FBM) ──
  /** Базовая частота шума: больше → мельче структура */
  noiseFrequency?: number
  /** Число октав FBM */
  octaves?: number
  /** Порог плотности: ниже него газа нет (вырезает полости) */
  densityThreshold?: number
  /** Множитель плотности после порога (общая «толщина» газа) */
  densityScale?: number

  // ── Интегрирование марша ──
  /** Число шагов марша вдоль луча (качество vs производительность) */
  marchSteps?: number
  /** Коэффициент поглощения на единицу плотности·длины */
  sigma?: number
}

class NebulaParameters {
  public readonly seed: number
  public readonly center: Vector3
  public readonly radius: number
  public readonly emissionColor: Color
  public readonly intensity: number
  public readonly emissionStrength: number
  public readonly bloomThreshold: number
  public readonly absorptionPower: number

  public readonly noiseFrequency: number
  public readonly octaves: number
  public readonly densityThreshold: number
  public readonly densityScale: number

  public readonly marchSteps: number
  public readonly sigma: number

  public constructor(init: NebulaParametersInit = {}) {
    this.seed = init.seed ?? 1337
    this.center = init.center?.clone() ?? new Vector3(0, 0, 0)
    this.radius = init.radius ?? 100
    this.emissionColor = init.emissionColor?.clone() ?? new Color(0.75, 0.15, 0.15)
    this.intensity = init.intensity ?? 1.0
    this.emissionStrength = init.emissionStrength ?? 1
    this.bloomThreshold = init.bloomThreshold ?? 0.7
    this.absorptionPower = init.absorptionPower ?? 1

    this.noiseFrequency = init.noiseFrequency ?? 1.6
    this.octaves = init.octaves ?? 4
    this.densityThreshold = init.densityThreshold ?? 0.5
    this.densityScale = init.densityScale ?? 1.0

    this.marchSteps = init.marchSteps ?? 15
    this.sigma = init.sigma ?? 0.01
  }
}

export { NebulaParameters }
