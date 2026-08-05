import { IUniform, Uniform } from 'three'
import { config } from '@/core/framework/config'

export const skyboxSampleUniforms = `
  uniform float uSkyHighlightThreshold;
  uniform float uSkyHighlightBoost;
  uniform float uSkyFloor;
  uniform float uSkyGain;
  uniform float uSkyFlipX;
`

/**
 * Единственная точка выборки фоновой кубмапы. Её зовут ОБА потребителя —
 * собственный фоновый проход и линзирование чёрной дыры, — потому что любое
 * расхождение между ними даёт ступеньку яркости на границе сферы симуляции.
 * Копия этой функции во втором месте воспроизведёт ровно тот баг, ради
 * которого чанк и заведён.
 *
 * `flipX` подаётся аргументом, но оба вызывающих обязаны передавать один и
 * тот же юниформ `uSkyFlipX` (см. `createSkyboxSampleUniforms` в этом же
 * файле): прямой фон и линзированный путь смотрят на одну кубмапу из
 * МИРОВЫХ направлений (меш чёрной дыры никогда не вращается, см. докблок
 * класса `BlackHole`), поэтому разный знак флипа зеркалит одно изображение
 * относительно другого.
 *
 * Расширение тождественно ниже порога: подтягивается только превышение, иначе
 * посветлело бы всё небо разом вместо ярчайших точек.
 *
 * Порог хайлайтов меряется по ИСХОДНОЙ выборке, а не по поднятой: иначе
 * множитель сдвигает его смысл, под расширение попадает втрое больше пикселей
 * и замеренное значение приходится искать заново.
 *
 * Насколько подъём делает кадр ярче по сравнению с одним расширением —
 * НЕ постоянно, а падает от 3× у порога к 1.34× у верхней границы диапазона:
 * 3× на raw = 0.4 (сам порог, слагаемое расширения там ещё в нуле — это
 * чистый gain), 1.93× на 0.4667 (прежняя точка пересечения единицы), 1.77×
 * на 0.5, 1.40× на 0.8, 1.34× на 1.0 (самая яркая звезда) — с ростом raw
 * основной вклад перехватывает слагаемое расширения. «В полтора раза» верно
 * только у самого верха диапазона, для полосы у порога — заниженная оценка
 * вдвое.
 */
export const skyboxSampleFunctions = `
  vec3 sampleSkyboxHdr(samplerCube tex, vec3 direction, float flipX) {
    vec3 raw = texture(tex, vec3(flipX * direction.x, direction.yz)).rgb;
    vec3 lifted = max(raw - uSkyFloor, vec3(0.0)) * uSkyGain;
    vec3 excess = max(raw - uSkyHighlightThreshold, vec3(0.0));

    return lifted + excess * (uSkyHighlightBoost - 1.0);
  }
`

/**
 * Фабрика uniforms общей выборки фона. Оба потребителя (собственный фоновый
 * проход и линзирование чёрной дыры) берут отсюда весь набор ручек вместо
 * независимых ручных объявлений — так расхождение порога, силы, подъёма или
 * флипа между ними становится невозможным по построению, а не по соглашению.
 *
 * Каждый вызов возвращает свежие экземпляры `Uniform` (как и
 * `createBlackHoleUniforms` рядом) — общих ссылок между материалами нет.
 *
 * `uSkyFlipX` ОБЯЗАН быть одним и тем же значением у обоих потребителей: они
 * подают в одну кубмапу мировые направления, а three.js рендерит фоновую
 * `CubeTexture` «изнутри», с инверсией X. Если объектное пространство чёрной
 * дыры когда-нибудь начнёт вращаться, скалярного флипа станет недостаточно —
 * понадобится матрица ориентации, а не Uniform<number>.
 */
export function createSkyboxSampleUniforms(): Record<string, IUniform> {
  return {
    uSkyHighlightThreshold: new Uniform(config('background.highlightThreshold')),
    uSkyHighlightBoost: new Uniform(config('background.highlightBoost')),
    uSkyFloor: new Uniform(config('background.floor')),
    uSkyGain: new Uniform(config('background.gain')),
    uSkyFlipX: new Uniform(-1)
  }
}
