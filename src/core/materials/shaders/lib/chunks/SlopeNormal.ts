import { SLOPE_RANGE } from '@/core/terrain/slopeMapFormat'

/**
 * Нормаль из slope-карты: тела с честным рельефом (height-ресурс) держат
 * геометрию с радиальными вершинными нормалями, а весь наклон поверхности
 * шейдится здесь попиксельно. Уклоны запечены оффлайн (scripts/lib/
 * slopeMapEncode.ts) с честными арками — деление на cos широты уже в данных,
 * и в отличие от вершинной выборки градиента одна текстурная выборка
 * фильтруется мипами: издалека уклоны усредняются, а не алиасят в шум.
 *
 * Декод зеркалит знаковую кодировку slopeMapFormat (байт 128 = 0, крайние
 * 1/255 = ∓SLOPE_RANGE) через интерполяцию общей константы. TBN тот же, что
 * у perturbNormalFromHeight: T — восток из vEast, B = cross(N, T) — север;
 * R-канал — уклон на восток, G — на север. bumpScale — художественный
 * множитель, 1 = физически честно.
 */
export const slopeNormalFunctions = `
  vec3 perturbNormalFromSlope(vec3 surfNormal, vec3 east, vec2 uv) {
    float len = length(east);
    if (len < 1e-4) return surfNormal; // полюс: тангенс вырожден

    vec3 T = east / len;
    vec3 B = cross(surfNormal, T);

    vec2 slope = (texture2D(bumpMap, uv).xy * 255.0 - 128.0) * (${SLOPE_RANGE.toFixed(1)} / 127.0);

    return normalize(surfNormal - bumpScale * (slope.x * T + slope.y * B));
  }
`
