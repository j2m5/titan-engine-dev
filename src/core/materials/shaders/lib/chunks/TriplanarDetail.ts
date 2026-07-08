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

  vec3 triplanarAlbedo(vec3 p, vec3 w, vec2 offset) {
    vec3 cx = texture2D(uRockDiffMap, p.zy * uDetailScale + offset).rgb;
    vec3 cy = texture2D(uRockDiffMap, p.xz * uDetailScale + offset).rgb;
    vec3 cz = texture2D(uRockDiffMap, p.xy * uDetailScale + offset).rgb;
    return cx * w.x + cy * w.y + cz * w.z;
  }

  vec3 triplanarArm(vec3 p, vec3 w, vec2 offset) {
    vec3 ax = texture2D(uRockArmMap, p.zy * uDetailScale + offset).rgb;
    vec3 ay = texture2D(uRockArmMap, p.xz * uDetailScale + offset).rgb;
    vec3 az = texture2D(uRockArmMap, p.xy * uDetailScale + offset).rgb;
    return ax * w.x + ay * w.y + az * w.z;
  }

  // Whiteout-бленд нормалей: тангенциальные компоненты суммируются с геом.
  // нормалью по осям проекции, z-компоненты перемножаются — швов между
  // проекциями нет, «плоского» усреднения тоже
  vec3 triplanarNormal(vec3 p, vec3 n, vec3 w, vec2 offset) {
    vec3 tx = texture2D(uRockNorMap, p.zy * uDetailScale + offset).xyz * 2.0 - 1.0;
    vec3 ty = texture2D(uRockNorMap, p.xz * uDetailScale + offset).xyz * 2.0 - 1.0;
    vec3 tz = texture2D(uRockNorMap, p.xy * uDetailScale + offset).xyz * 2.0 - 1.0;
    tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
    ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
    tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
    return normalize(tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z);
  }
`
