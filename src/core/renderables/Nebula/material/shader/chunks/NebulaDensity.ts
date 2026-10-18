// GLSL chunk: analytic boundary + warped fbm density + lobes/cavities/Worley.
// Mirror of fields/NebulaField.ts (boundary + noiseField + lobes + cavities).
// Worley cell-wall carving is GPU-only (needs cellular3d from <noiseFunctions>);
// the CPU mirror covers lobe placement + analytic cavities, not Worley.
export const nebulaDensityChunk = `
  #define NEB_MAX_LOBES 8  // nebula-program-local define; not the shared Noise.ts

  uniform int   uShape;        // 0 ellipsoid, 1 disk, 2 shell, 3 torus, 4 hourglass
  uniform vec3  uInvAxis;
  uniform float uShapeThickness;
  uniform mat3  uShapeRotation; // proxy space -> shape space (транспонированный поворот формы)
  uniform float uEdgeFalloff;
  uniform int   uOctaves;
  uniform float uFrequency;
  uniform float uLacunarity;
  uniform float uGain;
  uniform float uWarpStrength;
  uniform float uBoundaryWarp;  // 0..1 варп самого контура формы тем же вектором варпа
  uniform float uRidged;
  uniform float uContrast;
  uniform vec3  uDustNoiseOffset;
  uniform float uDustFrequency;
  uniform float uDustThreshold;
  uniform float uDustContrast;
  uniform vec3  uStructureDirection;
  uniform float uStructureStretch;

  uniform int   uLobeCount;
  uniform vec4  uLobeData[NEB_MAX_LOBES];   // xyz center (local), w radius
  uniform float uLobeWeight[NEB_MAX_LOBES];
  uniform int   uCavityCount;
  uniform vec4  uCavityData[NEB_MAX_LOBES]; // xyz center (local), w radius
  uniform float uCavityStrength[NEB_MAX_LOBES];
  uniform float uWorleyStrength;            // 0..1 cell-wall filament carving

  #ifdef NEB_BAKED
    uniform highp sampler3D uDensityTex;    // RG: static gas and dust fields
    uniform float uDensityReady;
  #endif

  // Показатель раздувания лепестков песочных часов. Единица дала бы конусы,
  // двойка — характерные пузыри биполярных туманностей
  #define NEB_HOURGLASS_POWER 2.0

  float nebBoundary(vec3 p) {
    // Mirror of NebulaField.boundary. The disk's vertical falloff is steeper
    // than radial (DISK_VERTICAL_STEEPNESS = 2) so a disk reads as genuinely
    // flatter than an ellipsoid at equal axisRatios. MUST stay in sync with CPU.
    const float diskVerticalSteepness = 2.0;

    // Поворот идёт ДО uInvAxis: сплющивание задаётся по СОБСТВЕННЫМ осям формы,
    // а не по осям прокси, иначе наклонённый тор сплющивался бы не по своей
    // нормали. При единичной матрице выражение тождественно прежнему.
    vec3 a = (uShapeRotation * p) * uInvAxis;

    if (uShape == 1) {
      float r = length(a.xz);
      float radial = 1.0 - smoothstep(1.0 - uEdgeFalloff, 1.0, r);
      float vertical = 1.0 - smoothstep(1.0 - uEdgeFalloff * diskVerticalSteepness, 1.0, abs(a.y));
      return max(0.0, radial * vertical);
    }

    if (uShape == 2) {
      // Полая сфера: внешняя кромка на 1, внутренняя на 1 - толщина
      float r = length(a);
      float inner = 1.0 - uShapeThickness;
      float outer = 1.0 - smoothstep(1.0 - uEdgeFalloff, 1.0, r);
      float hole = smoothstep(inner - uEdgeFalloff * uShapeThickness, inner, r);
      return max(0.0, outer * hole);
    }

    if (uShape == 3) {
      // Тор: расстояние до окружности радиуса 1 - толщина в плоскости XZ формы.
      // Радиус кольца выводится из толщины, а не задаётся вторым числом, — так
      // труба всегда касается границы прокси и не может из неё вылезти
      float ring = 1.0 - uShapeThickness;
      vec2 q = vec2(length(a.xz) - ring, a.y);
      float d = length(q) / max(uShapeThickness, 1e-4);
      return 1.0 - smoothstep(1.0 - uEdgeFalloff, 1.0, d);
    }

    if (uShape == 4) {
      // Песочные часы: допустимый радиус в XZ растёт от талии на экваторе до
      // единицы на полюсах
      float waist = mix(uShapeThickness, 1.0, pow(abs(a.y), NEB_HOURGLASS_POWER));
      float radial = 1.0 - smoothstep(waist * (1.0 - uEdgeFalloff), waist, length(a.xz));
      float vertical = 1.0 - smoothstep(1.0 - uEdgeFalloff, 1.0, abs(a.y));
      return max(0.0, radial * vertical);
    }

    float r = length(a);
    return 1.0 - smoothstep(1.0 - uEdgeFalloff, 1.0, r);
  }

  // Low-frequency dust channel, decorrelated from the main noise by a position
  // offset (snoise has no seed). Single octave: dust lanes are broad and low-freq,
  // so extra octaves would only add per-step cost. Mirror: NebulaField.dustMask.
  float nebulaDustMask(vec3 p) {
    float n = snoise(p * uDustFrequency + vec3(55.5) + uDustNoiseOffset);
    return clamp(1.0 - abs(n), 0.0, 1.0);
  }

  // Stretch internal structure without moving the envelope, lobes or cavities.
  // The axis is normalized on the CPU; its sign does not change the transform.
  vec3 nebStructurePoint(vec3 p) {
    if (uStructureStretch <= 1.0) return p;
    return p - uStructureDirection * dot(p, uStructureDirection) * (1.0 - 1.0 / uStructureStretch);
  }

  // Sum of Gaussian lobes (mirror of NebulaField.lobeContribution): field-level
  // composition of many sub-clouds inside one raymarch pass (no Group of meshes).
  float nebLobes(vec3 p) {
    float extra = 0.0;
    for (int i = 0; i < NEB_MAX_LOBES; i++) {
      if (i >= uLobeCount) break;
      vec3 d = p - uLobeData[i].xyz;
      float r2 = max(1e-4, uLobeData[i].w * uLobeData[i].w);
      extra += uLobeWeight[i] * exp(-dot(d, d) / r2);
    }
    return extra;
  }

  // Analytic cavity carving (mirror of NebulaField.cavityCarve) + GPU-only Worley
  // cell walls for filament structure. cellular3d is heavy (3x3x3 search), so it is
  // gated on uWorleyStrength; set noise.worleyStrength to 0 to reclaim that per-step
  // cost (it will become free once the static field is baked to a 3D texture).
  float nebCavities(vec3 p, vec3 noiseP) {
    float carve = 1.0;
    for (int i = 0; i < NEB_MAX_LOBES; i++) {
      if (i >= uCavityCount) break;
      float d = length(p - uCavityData[i].xyz);
      float inside = 1.0 - clamp(d / max(1e-4, uCavityData[i].w), 0.0, 1.0);
      carve *= 1.0 - uCavityStrength[i] * inside;
    }
    if (uWorleyStrength > 0.001) {
      vec2 f = cellular3d(noiseP * 1.7 + uNoiseOffset);
      float walls = mix(1.0, smoothstep(0.0, 0.4, f.y - f.x), uWorleyStrength);
      carve *= walls;
    }
    return max(0.0, carve);
  }

  // Returns gas and dust in [0,1]. Gas mirrors NebulaField.sampleDensity:
  // pow(clamp(boundary * (noise + lobes)) * cavities, contrast), + GPU Worley.
  // When NEB_BAKED, the (static) field is read from a precomputed 3D texture
  // instead of evaluating fbm+Worley per step. The 3D-bake material runs the
  // compute branch (no define) to fill that texture. RG8 quantisation and trilinear
  // interpolation approximate the live field; unfinished bakes use live noise.
  vec2 nebulaMedium(vec3 p) {
  #ifdef NEB_BAKED
    // The baked field has one level with trilinear spatial filtering. Explicit
    // LOD avoids implicit derivatives inside divergent view/light marches.
    if (uDensityReady > 0.5) return textureLod(uDensityTex, p * 0.5 + 0.5, 0.0).rg;
  #endif
    // Порядок ветвей — как в NebulaField.sampleDensity: при uBoundaryWarp 0 сначала
    // граница и ранний выход (варп не считается впустую), при > 0 вектор варпа
    // нужен уже для границы: контур перестаёт быть аналитической сферой/эллипсоидом
    vec3 w;
    float b;
    vec3 structureP = nebStructurePoint(p);
    if (uBoundaryWarp > 0.0) {
      w = nebWarpVector(p, uLacunarity, uGain);
      b = nebBoundary(p + uBoundaryWarp * w);
      if (b <= 0.0) return vec2(0.0);
      // The boundary keeps its original warp; internal warp follows the axis.
      if (uStructureStretch > 1.0) w = nebWarpVector(structureP, uLacunarity, uGain);
    } else {
      b = nebBoundary(p);
      if (b <= 0.0) return vec2(0.0);
      w = nebWarpVector(structureP, uLacunarity, uGain);
    }
    vec3 q = (structureP + uWarpStrength * w) * uFrequency;
    float base = nebFbm(q, uOctaves, uLacunarity, uGain);
    float billow = abs(base);
    float ridged = 1.0 - abs(base);
    base = mix(billow, ridged, uRidged);
    float d = b * (clamp(base, 0.0, 1.0) + nebLobes(p));
    float carve = nebCavities(p, structureP);
    d *= carve;
    d = pow(clamp(d, 0.0, 1.0), uContrast);
    // Independent interior structure, shared envelope and carved cavities.
    // threshold=1 is an explicitly empty field (smoothstep(1,1,x) is undefined).
    float dust = 0.0;
    if (uDustThreshold < 1.0) {
      float mask = smoothstep(uDustThreshold, 1.0, nebulaDustMask(structureP));
      dust = b * carve * pow(mask, uDustContrast);
    }
    return clamp(vec2(d, dust), 0.0, 1.0);
  }
`
