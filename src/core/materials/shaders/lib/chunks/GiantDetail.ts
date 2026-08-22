/**
 * Процедурная деталь облаков газового гиганта под текселем диффуза.
 * Домен (cos lon, sin lon, lat·stretch) — без шва на антимеридиане, клетка
 * шума вытянута вдоль полосы; варп по шуму (вихри) и по производной яркости
 * текстуры по широте (складки прилипают к краям полос). Октавы гаснут по
 * экранному следу — издали вклад ноль математически. Требует
 * #include <noiseFunctions> (snoise(vec3)) до этого чанка, и объявление
 * хостом uniform sampler2D diffuseMap до include giantDetailFunctions.
 */
export const giantDetailUniforms = /* glsl */ `
  uniform float uGiantRadiusKm;
  uniform float uGiantDetailScaleKm;
  uniform float uGiantDetailStretch;
  uniform float uGiantDetailWarp;
  uniform float uGiantDetailTextureWarp;
  uniform float uGiantDetailStrength;
  uniform float uGiantDetailFadeUnits;
`

export const giantDetailFunctions = /* glsl */ `
  vec3 giantDomain(vec3 dir) {
    float lat = asin(clamp(dir.y, -1.0, 1.0));
    float lon = atan(dir.z, dir.x);
    return vec3(cos(lon), sin(lon), lat * uGiantDetailStretch) * uGiantRadiusKm / (uGiantDetailStretch * uGiantDetailScaleKm);
  }

  // fbm с гашением октав по следу: вес 1 пока период ≥ 2 px, плавно к 0;
  // деление на сумму выживших амплитуд держит размах на любой дистанции
  float giantFbm(vec3 q, float footprint) {
    float sum = 0.0;
    float norm = 0.0;
    float amplitude = 1.0;
    float frequency = 1.0;
    for (int i = 0; i < 5; i++) {
      float w = 1.0 - smoothstep(0.5, 1.0, footprint * frequency);
      sum += w * amplitude * snoise(q * frequency);
      norm += w * amplitude;
      amplitude *= 0.6;
      frequency *= 2.0;
    }
    // хвост гаснет по норме, а не обрывается
    return 0.5 + 0.5 * (sum / max(norm, 1e-4)) * smoothstep(0.0, 0.25, norm);
  }

  /**
   * dir — тело-локальное направление (легаси-сфера), uv — развёртка диффуза,
   * lumTex — яркость диффуза в точке, viewDistance — юниты.
   */
  void applyGiantDetail(inout vec3 albedoMul, vec3 dir, vec2 uv, float lumTex, float viewDistance) {
    // След считается от гладкого домена ДО варпа (производная шума
    // высокочастотна) и ДО раннего выхода — однородный поток в кваде
    vec3 q = giantDomain(dir);
    float footprint = length(fwidth(q));

    float polar = 1.0 - smoothstep(0.85, 0.98, abs(dir.y));
    float distFade = 1.0 - smoothstep(0.4 * uGiantDetailFadeUnits, uGiantDetailFadeUnits, viewDistance);
    float contrast = uGiantDetailStrength * polar * distFade * smoothstep(0.05, 0.35, lumTex);
    if (contrast <= 0.0) return;

    q += uGiantDetailWarp * (vec3(snoise(q * 0.25), snoise(q * 0.25 + 17.0), snoise(q * 0.25 + 31.0)));
    // Выборки под неоднородным ветвлением — на границе гейта contrast → 0,
    // множитель ≈ 1 независимо от dLum; поэтому оставлено (без textureLod)
    // Производная яркости текстуры по широте — две выборки, без dFdx
    vec2 dv = vec2(0.0, 1.0 / 4096.0);
    float dLum = dot(texture2D(diffuseMap, uv + dv).rgb, vec3(0.2126, 0.7152, 0.0722))
               - dot(texture2D(diffuseMap, uv - dv).rgb, vec3(0.2126, 0.7152, 0.0722));
    q.z += uGiantDetailTextureWarp * dLum;

    float n = giantFbm(q, footprint);
    albedoMul *= clamp(1.0 + contrast * (n - 0.5) * 2.0, 0.0, 2.0);
  }
`
