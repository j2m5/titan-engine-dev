/**
 * TriplanarDetail — фотограмметрический PBR-микрослой камней (L0, фрагмент).
 *
 * Тайлящийся сет (diffuse + normal(GL) + ARM) проецируется трипланарно в
 * ОБЪЕКТНОМ пространстве — UV-развёртка не нужна. Диффуз используется как
 * яркостно-структурная карта: цвет породы задаёт профиль (грейдинг), поэтому
 * один сет обслуживает несколько профилей. Нормали смешиваются whiteout-блендом
 * (Ben Golus, «Normal Mapping for a Triplanar Shader»). ARM: r=AO, g=rough, b=metal.
 * uDetailMapsEnabled = 0 → слой выключен (текстуры не загрузились) — весь
 * вызов за uniform-веткой, поведение эквивалентно прежнему.
 *
 * Бленд трёх проекций вынесен в ядро triplanarBlendRgb/triplanarBlendNormal —
 * функции принимают уже выбранные значения проекций (компоновка параметром),
 * а не сэмплер. triplanarAlbedo/Arm/Normal ниже — тонкие обёртки «3 выборки +
 * вызов ядра»: единственные потребители классического (недетайленного) пути —
 * астероиды (см. InstancedAsteroidShaderTemplate). Тот же бленд без копирования
 * зовёт и стохастический путь террейна (см. chunks/TerrainDetail) — ядро общее.
 */
export const triplanarDetailUniforms = `
  uniform sampler2D uRockDiffMap;
  uniform sampler2D uRockNorMap;
  uniform sampler2D uRockArmMap;
  uniform float uDetailMapsEnabled;
  uniform float uDetailScale;
  uniform float uDetailSaturation;
  uniform float uDetailBrightness;
  uniform float uDetailNormalScale;
  uniform float uDetailAoInfluence;
  uniform float uDetailRoughInfluence;
`

export const triplanarDetailFunctions = `
  // Веса проекций: степень 4 прижимает бленд к доминирующей оси — меньше
  // «двоения» текстуры на диагональных нормалях
  vec3 triplanarWeights(vec3 objNormal) {
    vec3 w = pow(abs(objNormal), vec3(4.0));
    return w / (w.x + w.y + w.z);
  }

  // Ядро бленда albedo/ARM: одинаковая математика для обеих карт (взвешенная
  // сумма трёх проекций), поэтому одна функция на двоих — вызывающая сторона
  // сама решает, что читать (albedo или ARM).
  vec3 triplanarBlendRgb(vec3 cx, vec3 cy, vec3 cz, vec3 w) {
    return cx * w.x + cy * w.y + cz * w.z;
  }

  // Whiteout-бленд нормалей: тангенциальные компоненты суммируются с геом.
  // нормалью по осям проекции, z-компоненты перемножаются — швов между
  // проекциями нет, «плоского» усреднения тоже. tx/ty/tz — уже распакованные
  // ([-1,1]) значения проекций, выбор способа их получить (обычная выборка
  // или стохастическая) — забота вызывающей стороны.
  vec3 triplanarBlendNormal(vec3 tx, vec3 ty, vec3 tz, vec3 n, vec3 w) {
    tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
    ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
    tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
    return normalize(tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z);
  }

  vec3 triplanarAlbedo(sampler2D map, vec3 p, vec3 w, vec2 offset) {
    vec3 cx = texture2D(map, p.zy * uDetailScale + offset).rgb;
    vec3 cy = texture2D(map, p.xz * uDetailScale + offset).rgb;
    vec3 cz = texture2D(map, p.xy * uDetailScale + offset).rgb;
    return triplanarBlendRgb(cx, cy, cz, w);
  }

  vec3 triplanarArm(sampler2D map, vec3 p, vec3 w, vec2 offset) {
    vec3 ax = texture2D(map, p.zy * uDetailScale + offset).rgb;
    vec3 ay = texture2D(map, p.xz * uDetailScale + offset).rgb;
    vec3 az = texture2D(map, p.xy * uDetailScale + offset).rgb;
    return triplanarBlendRgb(ax, ay, az, w);
  }

  vec3 triplanarNormal(sampler2D map, vec3 p, vec3 n, vec3 w, vec2 offset) {
    vec3 tx = texture2D(map, p.zy * uDetailScale + offset).xyz * 2.0 - 1.0;
    vec3 ty = texture2D(map, p.xz * uDetailScale + offset).xyz * 2.0 - 1.0;
    vec3 tz = texture2D(map, p.xy * uDetailScale + offset).xyz * 2.0 - 1.0;
    return triplanarBlendNormal(tx, ty, tz, n, w);
  }
`
