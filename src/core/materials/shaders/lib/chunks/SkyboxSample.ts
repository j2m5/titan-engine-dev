export const skyboxSampleUniforms = `
  uniform float uSkyHighlightThreshold;
  uniform float uSkyHighlightBoost;
`

/**
 * Единственная точка выборки фоновой кубмапы. Её зовут ОБА потребителя —
 * собственный фоновый проход и линзирование чёрной дыры, — потому что любое
 * расхождение между ними даёт ступеньку яркости на границе сферы симуляции.
 * Копия этой функции во втором месте воспроизведёт ровно тот баг, ради
 * которого чанк и заведён.
 *
 * `flipX` задаёт ориентацию граней и принадлежит вызывающей стороне: прямой
 * фон и линзированный смотрят на кубмапу из разных систем координат.
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
