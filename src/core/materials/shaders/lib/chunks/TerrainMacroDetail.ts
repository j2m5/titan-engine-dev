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
  uniform float uMacroStreakStrength;
  uniform float uMacroStreakPeriodUnits;
  uniform float uMacroTerraceStrength;
  uniform float uMacroTerraceStepMeters;
  // Гейт форм по АБСОЛЮТНОМУ уклону (tan): x — начало, y — полная сила
  uniform vec2 uMacroStructureSlope;
  // Высота вершины (метры над референсом, атрибут height) — фаза террас
  varying float vHeightMeters;
  // Гейт наклона изотропного fbm (арка "средняя полоса B"): 0 у тел с
  // геометрией полосы - её рельеф уже покрывает то же место, что fbm, двойной
  // наклон нормали иначе. Альбедо-модуляция fbm и его роль источника вобла
  // для форм склона (applyMacroSlopeStructures) под этот гейт не подпадают.
  uniform float uMacroTiltGate;
`

export const terrainMacroDetailFunctions = /* glsl */ `
  // Отношение амплитуды рельефа к периоду (см. MACRO_RELIEF_ASPECT в зеркале):
  // 0.03 ≈ 90 м рельефа на 3-км период — стартовое число, приёмка владельца.
  #define MACRO_RELIEF_ASPECT 0.03

  // Направленные формы склона (арка A). Зеркало: terrainMacroDetailMath.ts —
  // менять строго синхронно.
  #define STREAK_STRETCH 6.0
  #define MACRO_RELIEF_ASPECT_STREAK 0.08
  #define STREAK_PLANE_POW 8.0
  #define STREAK_PLANE_MIN_WEIGHT 0.02
  #define TERRACE_WOBBLE 0.7
  #define TERRACE_RISER 0.3
  #define TERRACE_SHADE 0.07
  // Покрытие террас маской fbm: полки пятнами на стене, не сплошной изогипсой
  #define TERRACE_COVER_LO 0.1
  #define TERRACE_COVER_HI 0.4

  // Профиль террасы, период 1: уступ — подъём на [0, RISER], площадка —
  // линейный спад. x — значение (0 на концах периода), y — производная по фазе
  vec2 terraceProfile(float phase) {
    float t = fract(phase);
    float r = clamp(t / TERRACE_RISER, 0.0, 1.0);
    float rise = r * r * (3.0 - 2.0 * r);
    float dRise = t < TERRACE_RISER ? 6.0 * r * (1.0 - r) / TERRACE_RISER : 0.0;
    return vec2(rise - t, dRise - 1.0);
  }

  // Струи одной плоскости трипланара: uv — координаты плоскости в периодах,
  // d2 — единичная проекция «вниз по склону». x — значение, yz — градиент по uv.
  // Цепное правило при замороженном d2 (поворот базиса по склону не
  // дифференцируется — d меняется на масштабе текселя ≥ 1.3 км против периода 0.5 км)
  vec3 streakPlane(vec2 uv, vec2 d2, float seed) {
    vec2 p2 = vec2(-d2.y, d2.x);
    vec4 n = snoiseGrad(vec3(dot(uv, d2) / STREAK_STRETCH, dot(uv, p2), seed));
    return vec3(n.x, (n.y / STREAK_STRETCH) * d2 + n.z * p2);
  }

  // Струи (трипланар, повёрнутый по потоку) + террасы (фаза по высоте).
  // Анизотропия в 3D-домене dir·R/P невозможна (dot(q, d) ≡ 0 на сфере) —
  // отсюда 2D-чарты по осям тела. Внутри нет экранных производных: ветвление
  // по весам плоскостей безопасно. qs — домен струй (след посчитан хостом),
  // contrast/distFade — множители полосы. Гейт — по абсолютному уклону (tan),
  // НЕ по uMacroSlopeRef: тот калибрует амплитуду fbm (p90 уклонов на текселе,
  // ~4.6°) и включал бы формы на любой холмистости; стены кратеров — от ~11°.
  // gateSlopeLen — уклон ТОЛЬКО карты: наклон полосы B (до ~0.13 tan на холмах)
  // в сумме открывал бы гейт на пологих равнинах, и террасы читались бы
  // горизонталями топокарты; slope (с полосой) задаёт лишь направление стока
  void applyMacroSlopeStructures(inout vec3 nLocal, inout vec3 albedoMul, vec3 dirLocal, vec3 eastLocal, vec2 slope, float gateSlopeLen, float contrast, float distFade, vec3 qs, float streakWeight, float terraceWeight, float fbmValue) {
    float gate = smoothstep(uMacroStructureSlope.x, uMacroStructureSlope.y, gateSlopeLen);
    if (gate <= 0.0) return;
    float slopeLen = length(slope);
    if (slopeLen < 1e-5) return;

    vec3 T = normalize(eastLocal);
    vec3 B = cross(dirLocal, T);
    vec3 slopeVec = slope.x * T + slope.y * B;
    vec3 d = -slopeVec / slopeLen;

    if (uMacroStreakStrength > 0.0 && streakWeight > 0.0) {
      vec3 w3 = pow(abs(dirLocal), vec3(STREAK_PLANE_POW));
      w3 /= max(w3.x + w3.y + w3.z, 1e-6);
      float value = 0.0;
      vec3 g = vec3(0.0);
      // плоскость YZ (нормаль X)
      if (w3.x >= STREAK_PLANE_MIN_WEIGHT) {
        vec2 d2 = d.yz;
        float l = length(d2);
        if (l > 1e-3) {
          vec3 r = streakPlane(qs.yz, d2 / l, 0.0);
          value += w3.x * r.x;
          g += w3.x * vec3(0.0, r.y, r.z);
        }
      }
      // плоскость ZX (нормаль Y)
      if (w3.y >= STREAK_PLANE_MIN_WEIGHT) {
        vec2 d2 = d.zx;
        float l = length(d2);
        if (l > 1e-3) {
          vec3 r = streakPlane(qs.zx, d2 / l, 17.0);
          value += w3.y * r.x;
          g += w3.y * vec3(r.z, 0.0, r.y);
        }
      }
      // плоскость XY (нормаль Z)
      if (w3.z >= STREAK_PLANE_MIN_WEIGHT) {
        vec2 d2 = d.xy;
        float l = length(d2);
        if (l > 1e-3) {
          vec3 r = streakPlane(qs.xy, d2 / l, 31.0);
          value += w3.z * r.x;
          g += w3.z * vec3(r.y, r.z, 0.0);
        }
      }
      vec3 gT = g - dirLocal * dot(g, dirLocal);
      float k = uMacroStreakStrength * gate * contrast * streakWeight;
      nLocal = normalize(nLocal - MACRO_RELIEF_ASPECT_STREAK * k * gT);
      albedoMul *= clamp(1.0 + uMacroStrength * k * value, 0.0, 2.0);
    }

    if (uMacroTerraceStrength > 0.0) {
      // Производная берётся по h; член вобла TERRACE_WOBBLE·∇fbm (~6 % при
      // дефолтах) намеренно опущен
      vec2 tp = terraceProfile(vHeightMeters / max(uMacroTerraceStepMeters, 1e-3) + TERRACE_WOBBLE * fbmValue);
      float cover = smoothstep(TERRACE_COVER_LO, TERRACE_COVER_HI, fbmValue);
      float k = uMacroTerraceStrength * gate * distFade * terraceWeight * cover;
      // площадка (tp.y = −1) положе, уступ круче — модуляция собственного уклона
      nLocal = normalize(nLocal - k * tp.y * slopeVec);
      albedoMul *= max(1.0 - TERRACE_SHADE * k * max(tp.x, 0.0), 0.0);
    }
  }

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

  // slope — уклон карты + наклон полосы B (усиление fbm и направление форм);
  // gateSlopeLen — |уклон карты| для гейта форм склона (см. applyMacroSlopeStructures)
  void applyTerrainMacroDetail(inout vec3 nLocal, inout vec3 albedoMul, vec3 dirLocal, vec3 eastLocal, vec2 slope, float gateSlopeLen, float cavity, vec2 uv, float viewDistance) {
    // След — от гладкого домена ДО варпа и ДО раннего выхода (однородный поток в кваде)
    vec3 q = dirLocal * (uBodyRadiusUnits / max(uMacroPeriodUnits, 1e-6));
    float footprint = length(fwidth(q));

    // Домен и след струй — тоже до всех ранних выходов (однородный поток в кваде).
    // Домен через единичный dir: квант float32 ≈ 0.2 м при периоде 0.5 км;
    // период ниже ~0.2 км вернёт артефакт класса tile-jitter (см. detailPos)
    vec3 qs = dirLocal * (uBodyRadiusUnits / max(uMacroStreakPeriodUnits, 1e-9));
    float streakWeight = 1.0 - smoothstep(0.5, 1.0, length(fwidth(qs)));

    // След террас: шаг фазы на пиксель = fwidth(высоты)/step; полоса тоньше ~2 px гаснет
    float terraceWeight = 1.0 - smoothstep(0.5, 1.0, fwidth(vHeightMeters) / max(uMacroTerraceStepMeters, 1e-3));

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
    // uMacroTiltGate гасит только наклон нормали — альбедо и вклад в fbmValue
    // формам склона ниже (applyMacroSlopeStructures) идут отдельно, без гейта.
    nLocal = normalize(nLocal - uMacroTiltGate * uMacroNormalScale * MACRO_RELIEF_ASPECT * contrast * gradTangent);

    albedoMul *= clamp(1.0 + uMacroStrength * contrast * h, 0.0, 2.0);

    applyMacroSlopeStructures(nLocal, albedoMul, dirLocal, eastLocal, slope, gateSlopeLen, contrast, distFade, qs, streakWeight, terraceWeight, h);
  }
`
