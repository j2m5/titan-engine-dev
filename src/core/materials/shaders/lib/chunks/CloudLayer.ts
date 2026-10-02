/**
 * Облачный слой на высоте h над датумом — общий для суши (PlanetShaderTemplate, обе ветки)
 * и воды (WaterShaderTemplate). CPU-зеркало — cloudLayerMath.ts.
 *
 * Хост до include обязан: объявить sampler2D cloudMap, float uCloudOpacity,
 * float uBodyRadiusUnits; подключить terrainUvFunctions; под USE_SUN_TINT —
 * sunTransmittanceUniforms + sunTransmittanceFunctions (uAtmoDatumRadius, uSunTintStrength, sunTintAt); под USE_LIGHT_TINT — uniform vec3 uLightColor.
 * Все векторы — тело-локальные единичные; длины — юниты сцены.
 */
export const cloudLayerUniforms = /* glsl */ `
  uniform float uCloudHeightUnits;
  uniform float uCloudHeightKm;
  uniform float uCloudLightSoftness;
  uniform float uCloudShadowStrength;
`

export const cloudLayerFunctions = /* glsl */ `
  #define CLOUD_SLANT_MIN_MU 0.1
  #define CLOUD_SLANT_GATE_LO 0.05
  #define CLOUD_SLANT_GATE_HI 0.15
  #define CLOUD_SHADOW_MIN_COS 0.15

  // Точка слоя на луче взгляда: от P = R·d назад к камере до сферы R + h.
  // Камера ниже слоя не обрабатывается: там слой погашен высотным fade (uCloudOpacity).
  vec3 cloudLayerPoint(vec3 dirLocal, vec3 viewLocal) {
    if (uCloudHeightUnits <= 0.0) return dirLocal;
    float R = uBodyRadiusUnits;
    float h = uCloudHeightUnits;
    vec3 P = dirLocal * R;
    float b = dot(P, viewLocal);
    // разность квадратов радиусов — h·(2R + h): (R + h)² − R² в float32 теряет точность при h ≪ R
    float t = b + sqrt(max(b * b + h * (2.0 * R + h), 0.0));
    return normalize(P - t * viewLocal);
  }

  // Утолщение у края: путь сквозь слой ∝ 1/μ; 0 и 1 — неподвижные точки (пусто — прозрачно)
  float cloudSlantAlpha(float alpha, float muV) {
    return 1.0 - pow(max(1.0 - alpha, 0.0), 1.0 / max(muV, CLOUD_SLANT_MIN_MU));
  }

  // Свет в точке слоя: облако на высоте видит солнце дольше земли (dip), плюс мягкость рассеяния
  float cloudSunLight(vec3 cloudDir, vec3 sunLocal) {
    float R = uBodyRadiusUnits;
    float h = max(uCloudHeightUnits, 0.0);
    float dip = sqrt(h * (2.0 * R + h)) / (R + h);
    float k = dip + uCloudLightSoftness;
    return clamp((dot(cloudDir, sunLocal) + k) / (1.0 + k), 0.0, 1.0);
  }

  // Слой в пикселе: премультиплированный альбедо и покрытие с утолщением — оба уже с высотным fade
  void cloudLayerSample(vec3 dirLocal, vec3 viewLocal, out vec3 cloudPremul, out float cloudAlphaSlant, out vec3 cloudDir) {
    cloudDir = cloudLayerPoint(dirLocal, viewLocal);
    vec3 cloudTex = texture2D(cloudMap, terrainUv(cloudDir)).rgb;
    // покрытие — свойство текстуры, не освещения
    float alpha = pow(dot(cloudTex, vec3(1.0)) / 3.0, 0.5);
    vec3 albedo = min(cloudTex / max(alpha, 1e-4), vec3(1.0));
    float muV = abs(dot(cloudDir, -viewLocal));
    // утолщение только у настоящих облаков: шум JPEG в пустом небе (α ≲ 0.05) у лимба дал бы тёмное кольцо
    float slantGate = smoothstep(CLOUD_SLANT_GATE_LO, CLOUD_SLANT_GATE_HI, alpha);
    cloudAlphaSlant = mix(alpha, cloudSlantAlpha(alpha, muV), slantGate) * uCloudOpacity;
    cloudPremul = albedo * cloudAlphaSlant;
  }

  // Радиация облака: альбедо × свет слоя × солнце на высоте облака × цвет звезды.
  // Под USE_SUN_TINT световой хвост за геометрическим горизонтом (−dip) срезается горизонтом пропускания,
  // поэтому cloudLightSoftness виден полностью только на телах без солнечного тинта.
  vec3 cloudLitRadiance(vec3 cloudPremul, vec3 cloudDir, vec3 sunLocal) {
    vec3 radiance = cloudPremul * cloudSunLight(cloudDir, sunLocal);
    #ifdef USE_SUN_TINT
      radiance *= mix(vec3(1.0), sunTintAt(uAtmoDatumRadius + uCloudHeightKm, dot(cloudDir, sunLocal)), uSunTintStrength);
    #endif
    #ifdef USE_LIGHT_TINT
      radiance *= uLightColor;
    #endif
    return radiance;
  }

  // Тень облаков на поверхности: облако, затеняющее точку, стоит по направлению к солнцу
  // на h·tan θ (θ — зенитный угол); только прямой свет. muS = dot(dirLocal, sunLocal)
  float cloudShadowAt(vec3 dirLocal, vec3 sunLocal, float muS) {
    vec3 eastLocal = cross(vec3(0.0, 1.0, 0.0), dirLocal);
    vec2 uv = terrainUv(dirLocal);
    vec3 sunTangent = sunLocal - dirLocal * muS;
    float cosZ = max(muS, CLOUD_SHADOW_MIN_COS);
    vec3 offsetUnits = sunTangent / cosZ * uCloudHeightUnits;
    // eastLocal = cross(up, dir): длина = cos φ; north = cross(dir, east)
    float cosLat = max(length(eastLocal), 1e-3);
    vec3 eastUnit = eastLocal / cosLat;
    vec3 northUnit = normalize(cross(dirLocal, eastUnit));
    vec2 uvShadow = uv + vec2(dot(offsetUnits, eastUnit) / (6.2831853 * uBodyRadiusUnits * cosLat),
                              dot(offsetUnits, northUnit) / (3.1415927 * uBodyRadiusUnits));
    vec3 cloudAtShadow = texture2D(cloudMap, uvShadow).rgb;
    // × uCloudOpacity: тень гаснет с высотой камеры вместе с самим слоем — не баг
    float alphaShadow = pow(dot(cloudAtShadow, vec3(1.0)) / 3.0, 0.5) * uCloudOpacity;
    // ровно в полюсе eastLocal = 0 → базис вырожден: тень гасится, NaN не рождается
    return 1.0 - uCloudShadowStrength * alphaShadow * smoothstep(0.0, 0.2, muS) * step(1e-4, length(eastLocal));
  }
`
