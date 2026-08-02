import { IUniform, Uniform } from 'three'
import { config } from '@/core/framework/config'

export const skyboxSampleUniforms = `
  uniform float uSkyHighlightThreshold;
  uniform float uSkyHighlightBoost;
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
 */
export const skyboxSampleFunctions = `
  vec3 sampleSkyboxHdr(samplerCube tex, vec3 direction, float flipX) {
    vec3 raw = texture(tex, vec3(flipX * direction.x, direction.yz)).rgb;
    vec3 excess = max(raw - uSkyHighlightThreshold, vec3(0.0));

    return raw + excess * (uSkyHighlightBoost - 1.0);
  }
`

/**
 * Фабрика uniforms общей выборки фона. Оба потребителя (собственный фоновый
 * проход и линзирование чёрной дыры) берут отсюда весь набор из трёх ручек
 * вместо независимых ручных объявлений — так расхождение порога, силы или
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
    uSkyFlipX: new Uniform(-1)
  }
}
