import { Color, Vector3 } from 'three'

export interface NebulaParametersInit {
  /** Детерминированный seed генерации (уходит в 4-ю координату snoise) */
  seed?: number
  /** Центр объёма в мировых координатах Three.js */
  center?: Vector3
  /** Радиус bounding-объёма в объектных единицах Three.js (полу-сторона куба) */
  radius?: number
  shapeType?: number
  shapeStrength?: number
  shapeThickness?: number
  /** Базовый цвет эмиссии газа */
  emissionColor?: Color
  /**
   * Цветовая палитра объёма. Если заданы, переопределяют одноцветный
   * emissionColor: цвет интерполируется по плотности (тело → ядра) с
   * радиальной модуляцией к краям. Газ перестаёт быть однотонным.
   */
  colorLow?: Color // разреженный газ (основное тело туманности)
  colorHigh?: Color // плотные ядра (самые яркие сгустки)
  colorEdge?: Color // внешние края (радиальная модуляция к границе)
  /** Кривая перехода плотность→цвет: 1 — линейно, >1 — ядра выделены резче */
  colorMixPower?: number
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

  // ── Вариативность формы ──
  /**
   * Сила domain warping: искажение координат перед сэмплом плотности.
   * 0 — выкл (круглые комки одного FBM); 0.3–0.6 — филаменты и волокна;
   * > 0.8 — сильно турбулентные, рваные структуры.
   */
  warpStrength?: number
  /**
   * Анизотропия формы: множители масштаба по осям X/Y/Z. Неравные значения
   * растягивают туманность (например, (1, 0.5, 1) — приплюснутый диск,
   * (2, 1, 1) — вытянутая). (1,1,1) — изотропная (шарообразная).
   */
  anisotropy?: Vector3
  /**
   * Жёсткость граничной маски (0..1). 0 — маска почти не режет (рваные края,
   * газ доходит до граней куба); 1 — жёсткая сферическая обрезка (круглый
   * силуэт). Низкие значения дают неправильную, природную форму.
   */
  edgeHardness?: number

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
  /** Доля разрешения half-res рендера (0.5 = ¼ фрагментов). Рендер-настройка, не физика газа. */
  resolutionScale?: number
}

class NebulaParameters {
  public readonly seed: number
  public readonly center: Vector3
  public readonly radius: number
  public readonly shapeType: number
  public readonly shapeStrength: number
  public readonly shapeThickness: number
  public readonly emissionColor: Color
  public readonly colorLow: Color
  public readonly colorHigh: Color
  public readonly colorEdge: Color
  public readonly colorMixPower: number
  public readonly intensity: number
  public readonly emissionStrength: number
  public readonly bloomThreshold: number
  public readonly absorptionPower: number
  public readonly warpStrength: number
  public readonly anisotropy: Vector3
  public readonly edgeHardness: number

  public readonly noiseFrequency: number
  public readonly octaves: number
  public readonly densityThreshold: number
  public readonly densityScale: number

  public readonly marchSteps: number
  public readonly sigma: number
  public readonly resolutionScale: number

  public constructor(init: NebulaParametersInit = {}) {
    this.seed = init.seed ?? 1337
    this.center = init.center?.clone() ?? new Vector3(0, 0, 0)
    this.radius = init.radius ?? 100
    this.shapeType = init.shapeType ?? 0
    this.shapeStrength = init.shapeStrength ?? 0.8
    this.shapeThickness = init.shapeThickness ?? 0.25
    this.emissionColor = init.emissionColor?.clone() ?? new Color(0.4, 0.6, 0.55)
    this.colorLow = init.colorLow?.clone() ?? this.emissionColor.clone()
    this.colorHigh = init.colorHigh?.clone() ?? this.emissionColor.clone().multiplyScalar(1.3)
    this.colorEdge = init.colorEdge?.clone() ?? this.colorLow.clone()
    this.colorMixPower = init.colorMixPower ?? 1
    this.intensity = init.intensity ?? 1
    this.emissionStrength = init.emissionStrength ?? 1
    this.bloomThreshold = init.bloomThreshold ?? 0.7
    this.absorptionPower = init.absorptionPower ?? 1
    this.warpStrength = init.warpStrength ?? 0.5
    this.anisotropy = init.anisotropy?.clone() ?? new Vector3(1, 1, 1)
    this.edgeHardness = init.edgeHardness ?? 0.4

    this.noiseFrequency = init.noiseFrequency ?? 3.6
    this.octaves = init.octaves ?? 5
    this.densityThreshold = init.densityThreshold ?? 0.5
    this.densityScale = init.densityScale ?? 5

    this.marchSteps = init.marchSteps ?? 100
    this.sigma = init.sigma ?? 0.01
    this.resolutionScale = init.resolutionScale ?? 0.25
  }
}

export { NebulaParameters }
