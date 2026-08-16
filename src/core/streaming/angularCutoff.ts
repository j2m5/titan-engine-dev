/**
 * Номинальные fov/высота вьюпорта для перевода `minBodyPixels` в порог
 * `actorPriority`. `ResourceObserver` не хранит камеру и не знает фактический
 * размер окна — по прецеденту `PlanetShader.ts` (fade-дистанции детального
 * слоя калиброваны на «1080p, fov ~50°») порог считается по фиксированным
 * номинальным значениям, а не по живым: субпиксельная отсечка — грубая
 * защита бюджета, а не точная величина, зависящая от факта окна пользователя.
 */
const NOMINAL_FOV_Y_DEGREES: number = 50
const NOMINAL_SCREEN_HEIGHT_PX: number = 1080

/**
 * Порог `actorPriority` (радиус тела / дистанция до камеры — см.
 * `ResourceObserver.collectCandidates`), ниже которого диаметр тела на
 * экране меньше `minBodyPixels` пикселей.
 *
 * Вывод формулы. `actorPriority = radiusUnits/distance` — при малых углах это
 * приближённо угловой РАДИУС тела в радианах (`prio ≈ tan(prio) ≈ sin(prio)`
 * для малых `prio`, что здесь всегда так — субпиксельные тела по определению
 * угловой мелочи). Угловой ДИАМЕТР тела тогда `θ = 2·prio` рад.
 *
 * Вертикальный fov камеры `fovRad` (рад) охватывает по вертикали экран
 * высотой `screenH` пикселей — то есть один пиксель соответствует углу
 * `fovRad/screenH` рад, и обратно: угол `θ` соответствует
 * `pixels = θ / (fovRad/screenH) = θ·screenH/fovRad` пикселям. Подставляя
 * `θ = 2·prio`:
 *
 * ```
 * pixels = 2·prio·screenH / fovRad
 * ```
 *
 * Порог по пикселям (`pixels ≥ minBodyPixels`, тело всё ещё стоит стримить)
 * разрешается относительно `prio`:
 *
 * ```
 * prio ≥ minBodyPixels · fovRad / (2·screenH)
 * ```
 *
 * Функция возвращает именно эту нижнюю границу — `collectCandidates`
 * отбрасывает актора, если его `actorPriority` строго меньше неё.
 */
export function minBodyPixelsToPriorityThreshold(minBodyPixels: number): number {
  const fovRad: number = (NOMINAL_FOV_Y_DEGREES * Math.PI) / 180

  return (minBodyPixels * fovRad) / (2 * NOMINAL_SCREEN_HEIGHT_PX)
}
