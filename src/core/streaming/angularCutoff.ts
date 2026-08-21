/**
 * Номинальные fov/высота вьюпорта для перевода `minBodyPixels` в порог
 * `actorPriority` — ДЕФОЛТЫ, а не единственный режим.
 *
 * Ими пользуется `ResourceObserver`: он не хранит камеру и не знает
 * фактический размер окна, а его отсечка (4 px) — грубая защита бюджета, где
 * фактор 2 по высоте вьюпорта ничего не решает. По тому же прецеденту, что
 * fade-дистанции детального слоя в `PlanetShader.ts` («1080p, fov ~50°»).
 *
 * Гейт карт высот (`HeightFieldGate`) передаёт ЖИВЫЕ значения и обязан это
 * делать: его пороги (32/16 px) — не отсечка мелочи, а обещание «карта
 * приедет к моменту, когда тело такого-то размера на экране», и рядом,
 * в SSE-отборе того же террейна, размер уже меряется живым
 * `renderer.domElement.height`. На 4K номинал давал фактические 64 px вместо
 * 32 — карта запрашивалась вдвое позже обещанного (ревью 2026-08-20,
 * находка №9).
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
export function minBodyPixelsToPriorityThreshold(
  minBodyPixels: number,
  fovDegrees: number = NOMINAL_FOV_Y_DEGREES,
  viewportHeight: number = NOMINAL_SCREEN_HEIGHT_PX
): number {
  const fovRad: number = (fovDegrees * Math.PI) / 180

  return (minBodyPixels * fovRad) / (2 * viewportHeight)
}
