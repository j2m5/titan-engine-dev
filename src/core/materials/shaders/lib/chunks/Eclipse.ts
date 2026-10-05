/**
 * Затмения: доля видимого диска звезды в точке при перекрытии дисками тел-соседей
 * (≤ 4), плюс подсветка умбры тел с атмосферой. CPU-зеркало — src/core/eclipse/eclipseMath.ts.
 * eclipseFunctions — чистые функции (подключает и эффект атмосферы); eclipseHostFunctions —
 * юниформы материала и обёртка eclipseLight(p). Точки и центры — в одной системе и единицах.
 */
export const eclipseFunctions = /* glsl */ `
  #define ECLIPSE_PI 3.141592653589793

  // угол через полухорду: на малых углах точен, acos(dot) в float32 полосит полутень
  float eclipseSeparation(vec3 nS, vec3 nO) {
    return 2.0 * asin(clamp(0.5 * length(nS - nO), 0.0, 1.0));
  }

  // доля диска звезды (aS), не закрытая диском тела (aO) при угле theta; плоское приближение
  float eclipseVisible(float aS, float aO, float theta) {
    if (theta >= aS + aO) return 1.0;
    if (theta <= abs(aS - aO)) return aO >= aS ? 0.0 : 1.0 - (aO * aO) / (aS * aS);
    float d = theta;
    float a1 = aS * aS * acos(clamp((d * d + aS * aS - aO * aO) / (2.0 * d * aS), -1.0, 1.0));
    float a2 = aO * aO * acos(clamp((d * d + aO * aO - aS * aS) / (2.0 * d * aO), -1.0, 1.0));
    float a3 = 0.5 * sqrt(max((-d + aS + aO) * (d + aS - aO) * (d - aS + aO) * (d + aS + aO), 0.0));
    return clamp(1.0 - (a1 + a2 - a3) / (ECLIPSE_PI * aS * aS), 0.0, 1.0);
  }

  // свет звезды в точке p: видимая доля (произведение) + подсветка умбр; без тел — ровно 1
  vec3 eclipseLightAt(vec3 p, int count, vec4 occ[4], vec3 star, float starRadius, vec4 umbra[4]) {
    if (count <= 0) return vec3(1.0);
    vec3 vS = star - p;
    float dS = length(vS);
    vec3 nS = vS / dS;
    float aS = asin(min(1.0, starRadius / dS));
    float visible = 1.0;
    vec3 glow = vec3(0.0);
    for (int i = 0; i < 4; i++) {
      if (i >= count) break;
      vec3 vO = occ[i].xyz - p;
      if (dot(vO, vS) <= 0.0) continue;
      float dO = length(vO);
      float aO = asin(min(1.0, occ[i].w / dO));
      float v = eclipseVisible(aS, aO, eclipseSeparation(nS, vO / dO));
      visible *= v;
      glow += (1.0 - v) * umbra[i].a * umbra[i].rgb;
    }
    return vec3(visible) + glow;
  }
`

export const eclipseHostFunctions = /* glsl */ `
  uniform int uEclipseCount;
  uniform vec4 uEclipseOccluders[4];
  uniform vec3 uEclipseStar;
  uniform float uEclipseStarRadius;
  uniform vec4 uEclipseUmbra[4];

  // свет звезды в точке p системы тела (юниты сцены)
  vec3 eclipseLight(vec3 p) {
    return eclipseLightAt(p, uEclipseCount, uEclipseOccluders, uEclipseStar, uEclipseStarRadius, uEclipseUmbra);
  }
`
