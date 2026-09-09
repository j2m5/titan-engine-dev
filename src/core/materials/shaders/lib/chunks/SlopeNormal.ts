/**
 * Нормаль из slope-карты: тела с честным рельефом (height-ресурс) держат
 * геометрию с радиальными вершинными нормалями, а весь наклон поверхности
 * шейдится здесь попиксельно. Уклоны запечены оффлайн (scripts/lib/
 * slopeMapEncode.ts) с честными арками — деление на cos широты уже в данных,
 * и в отличие от вершинной выборки градиента одна текстурная выборка
 * фильтруется мипами: издалека уклоны усредняются, а не алиасят в шум.
 *
 * Декод зеркалит знаковую кодировку slopeMapFormat (байт 128 = 0, крайние
 * 1/255 = ∓диапазон) через юниформ uSlopeRange — диапазон per-map (строка
 * slope-ресурса), дефолт SLOPE_RANGE выставляет CPU (PlanetShader/Material).
 * TBN: T — восток (попиксельный cross(up, dirLocal) хоста), B = cross(N, T) —
 * север; R-канал — уклон на восток, G — на север. bumpScale —
 * художественный множитель, 1 = физически честно.
 *
 * out vec2 slopeOut отдаёт наружу декодированный вектор уклона (до bumpScale
 * и проекции на TBN) — маска зон материала берёт length(slopeOut) без второй
 * выборки. extraSlope — наклон геометрии полосы B (атрибут midTilt, tan в
 * базисе T/B), складывается с декодом ДО наклона нормали: одна нормаль на
 * сумму. У полюса (len < 1e-4) slopeOut = vec2(0.0).
 */
export const slopeNormalUniforms = `uniform float uSlopeRange;`

export const slopeNormalFunctions = `
  vec3 perturbNormalFromSlope(vec3 surfNormal, vec3 east, vec2 uv, vec2 extraSlope, out vec2 slopeOut) {
    float len = length(east);
    if (len < 1e-4) {
      slopeOut = vec2(0.0);
      return surfNormal; // полюс: тангенс вырожден
    }

    vec3 T = east / len;
    vec3 B = cross(surfNormal, T);

    vec2 decoded = (texture2D(bumpMap, uv).xy * 255.0 - 128.0) * (uSlopeRange / 127.0);
    // extraSlope - наклон геометрии полосы B (атрибут midTilt, tan в том же
    // базисе T/B), интерполирован по вершинам - в пикселе шума нет
    vec2 slope = decoded + extraSlope;
    slopeOut = slope;

    return normalize(surfNormal - bumpScale * (slope.x * T + slope.y * B));
  }
`
