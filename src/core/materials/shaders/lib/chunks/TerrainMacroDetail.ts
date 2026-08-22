/**
 * Средняя полоса детали рельефа (терраформный путь, USE_TERRAIN_MACRO_DETAIL):
 * километровый рельеф под текселем диффуза между текселем (~1–5 км) и
 * 40-метровой шкалой TerrainDetail. fbm из snoiseGrad — нормаль из
 * аналитического градиента; домен dirLocal·R/period бесшовен на сфере.
 * Подчинение данным: амплитуда по |slope| и cavity — оба приходят параметрами
 * от хоста (чанк slope-карту не читает; cavity = 0 без USE_CAVITY), варп домена по
 * производной яркости диффуза вдоль меридиана. Октавы гаснут по экранному
 * следу. Требует #include <noiseFunctions> и объявления diffuseMap хостом
 * до include. CPU-зеркало: terrainMacroDetailMath.ts.
 */
export const terrainMacroDetailUniforms = /* glsl */ `
  uniform float uMacroStrength;
  uniform float uMacroNormalScale;
  uniform float uMacroPeriodUnits;
  uniform float uMacroSlopeInfluence;
  uniform float uMacroSlopeRef;
  uniform float uMacroCavityInfluence;
  uniform float uMacroTextureWarp;
  uniform vec2 uMacroFadeRange;
  uniform vec2 uDiffuseTexelSize;
  uniform float uBodyRadiusUnits;
`

export const terrainMacroDetailFunctions = /* glsl */ `
  // Отношение амплитуды рельефа к периоду (см. MACRO_RELIEF_ASPECT в зеркале):
  // 0.03 ≈ 90 м рельефа на 3-км период — стартовое число, приёмка владельца.
  #define MACRO_RELIEF_ASPECT 0.03

  // fbm с гашением октав по следу; w — значение, xyz — градиент по домену
  // (snoiseGrad возвращает x = значение, yzw = градиент — см. AsteroidShape.ts)
  vec4 macroFbm(vec3 q, float footprint) {
    vec4 sum = vec4(0.0);
    float norm = 0.0;
    float amplitude = 1.0;
    float frequency = 1.0;
    for (int i = 0; i < 3; i++) {
      float w = 1.0 - smoothstep(0.5, 1.0, footprint * frequency);
      vec4 n = snoiseGrad(q * frequency);
      sum += w * amplitude * vec4(n.yzw * frequency, n.x);
      norm += w * amplitude;
      amplitude *= 0.5;
      frequency *= 2.0;
    }
    // хвост гаснет по норме, а не обрывается
    return (sum / max(norm, 1e-4)) * smoothstep(0.0, 0.25, norm);
  }

  void applyTerrainMacroDetail(inout vec3 nLocal, inout vec3 albedoMul, vec3 dirLocal, vec3 eastLocal, vec2 slope, float cavity, vec2 uv, float viewDistance) {
    // След — от гладкого домена ДО варпа и ДО раннего выхода (однородный поток в кваде)
    vec3 q = dirLocal * (uBodyRadiusUnits / max(uMacroPeriodUnits, 1e-6));
    float footprint = length(fwidth(q));

    float eastLen = length(eastLocal);
    if (eastLen < 1e-4) return; // полюс: тангенс вырожден

    // Ранние выходы до выборок текстур: за концом fade полоса не читается
    float distFade = 1.0 - smoothstep(uMacroFadeRange.x, uMacroFadeRange.y, viewDistance);
    if (distFade <= 0.0) return;

    // uMacroSlopeRef — уклон полной амплитуды: у километровых текселей |slope|
    // на порядок ниже потолка кодировки, нормировка по нему обнуляла бы полосу.
    float s = clamp(length(slope) / uMacroSlopeRef, 0.0, 1.0);
    float gain = (1.0 - uMacroSlopeInfluence + uMacroSlopeInfluence * s) * max(0.0, 1.0 + uMacroCavityInfluence * cavity);
    float contrast = gain * distFade;
    if (contrast <= 0.0) return;

    // Варп по производной яркости диффуза вдоль меридиана: деталь прилипает к пятнам текстуры
    vec3 north = cross(dirLocal, eastLocal);
    float lumUp = dot(texture2D(diffuseMap, uv + vec2(0.0, uDiffuseTexelSize.y)).rgb, vec3(0.2126, 0.7152, 0.0722));
    float lumDown = dot(texture2D(diffuseMap, uv - vec2(0.0, uDiffuseTexelSize.y)).rgb, vec3(0.2126, 0.7152, 0.0722));
    float dLum = lumUp - lumDown;
    q += uMacroTextureWarp * dLum * north;

    vec4 f = macroFbm(q, footprint);
    float h = f.w;

    // Касательная часть градиента (домен ∝ dirLocal, радиальная компонента не наклоняет нормаль)
    vec3 g = f.xyz;
    vec3 gradTangent = g - dirLocal * dot(g, dirLocal);
    // Наклон = (амплитуда/период)·grad: домен в периодах, ∂/∂s = (1/P)·∂/∂q.
    nLocal = normalize(nLocal - uMacroNormalScale * MACRO_RELIEF_ASPECT * contrast * gradTangent);

    albedoMul *= clamp(1.0 + uMacroStrength * contrast * h, 0.0, 2.0);
  }
`
