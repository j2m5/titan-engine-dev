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
 * Перегрузка (GLSL ES поддерживает overloading по сигнатуре параметров) с
 * out vec2 slopeOut — отдаёт наружу уже декодированный вектор уклона (до
 * умножения на bumpScale/проекции на TBN), чтобы вызывающая сторона (см.
 * PlanetShaderTemplate — маска зон материала TerrainDetail) могла взять
 * length(slopeOut) без ВТОРОЙ выборки той же текстуры под тем же uv. У
 * полюса (len < 1e-4, тангенс вырожден) slopeOut = vec2(0.0) - согласовано
 * с семантикой «нет уклона», ничего не декодировано и не должно быть.
 *
 * Перегрузка с vec2 extraSlope (арка "средняя полоса B") складывает наклон
 * геометрии полосы (атрибут midTilt, интерполирован по вершинам - в пикселе
 * шума нет) с декодированным вектором ДО наклона нормали - одна нормаль на
 * сумму, а не два независимых наклона. out-перегрузка (без extraSlope) и
 * 3-аргументная - тонкие обёртки над ней (vec2(0.0), одно тело).
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

  vec3 perturbNormalFromSlope(vec3 surfNormal, vec3 east, vec2 uv, out vec2 slopeOut) {
    return perturbNormalFromSlope(surfNormal, east, uv, vec2(0.0), slopeOut);
  }

  vec3 perturbNormalFromSlope(vec3 surfNormal, vec3 east, vec2 uv) {
    vec2 slopeUnused;
    return perturbNormalFromSlope(surfNormal, east, uv, slopeUnused);
  }
`
