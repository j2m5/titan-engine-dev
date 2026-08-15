export const heightNormalUniforms = `
  uniform vec2 uBumpTexelSize;
`

/**
 * Нормаль из карты высот аналитическим градиентом: четыре выборки соседних
 * текселей вместо экранной производной (`dFdx`). Экранная производная на
 * статичной геометрии даёт шум при движении камеры и привязывает силу рельефа
 * к зуму — тот же урок, что в астероидной арке.
 *
 * TBN строится из РАДИАЛЬНОЙ НОРМАЛИ, не из position: у патчей кубосферы
 * position — смещение от центра патча (RTC), не от центра тела, и не
 * годится для касательной. Восток (`vEast`, приходит вью-пространственным
 * варьирующим) и север (`cross(N, T)`) выводятся аналитически из нормали,
 * вершинные атрибуты не нужны.
 *
 * Градиент считается НА ТЕКСЕЛЬ, без деления на длину дуги: честный пересчёт
 * (деление на cos широты) взрывает рельеф у полюсов равноискривлённой карты.
 * Плата — сила рельефа зависит от разрешения карты; выбивающиеся тела
 * калибруются через `bumpScale` в данных.
 */
export const heightNormalFunctions = `
  vec3 perturbNormalFromHeight(vec3 surfNormal, vec3 east, vec2 uv) {
    float len = length(east);
    if (len < 1e-4) return surfNormal; // полюс: тангенс вырожден

    vec3 T = east / len;
    vec3 B = cross(surfNormal, T);

    // Шов по нулевому меридиану заворачиваем сами: wrapS в строках ресурсов
    // не задан, действует ClampToEdge — иначе на шве встаёт плоская полоса.
    // Оговорка: у самого шва (u=0/1) fract() рвёт неявную производную,
    // и квад, накрывающий разрыв, читает наименьший мип — на 8K картах при
    // реальных дистанциях это суб-пиксельно; чистого фикса в GLSL ES 1.00 нет
    // (нужен texture2DLodEXT).
    float uL = fract(uv.x - uBumpTexelSize.x);
    float uR = fract(uv.x + uBumpTexelSize.x);
    float vD = clamp(uv.y - uBumpTexelSize.y, 0.0, 1.0);
    float vU = clamp(uv.y + uBumpTexelSize.y, 0.0, 1.0);

    float hL = texture2D(bumpMap, vec2(uL, uv.y)).x;
    float hR = texture2D(bumpMap, vec2(uR, uv.y)).x;
    float hD = texture2D(bumpMap, vec2(uv.x, vD)).x;
    float hU = texture2D(bumpMap, vec2(uv.x, vU)).x;

    vec2 grad = vec2(hR - hL, hU - hD) * 0.5;

    return normalize(surfNormal - bumpScale * (grad.x * T + grad.y * B));
  }
`
