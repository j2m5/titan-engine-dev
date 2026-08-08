/**
 * Шейдеры конвейера запекания облачного поля.
 *
 * Числовое зеркало потока: tests/brownDwarf/brownDwarfFlowMirror.ts —
 * менять строго синхронно.
 */

/**
 * Поле потока: зональные струи плюс вихри. Обе части строятся векторным
 * произведением с самим направлением, поэтому касательны к сфере по
 * построению — полулагранжев снос не уводит выборку с единичной сферы.
 */
export const bdFlowChunk = `
  #define POLE_EPSILON 1e-4

  // Восточный вектор. На полюсах cross с осью Y вырождается в ноль, и
  // normalize дал бы NaN — защита обязана стоять ДО нормализации.
  vec3 bdEast(vec3 dir) {
    vec3 east = cross(vec3(0.0, 1.0, 0.0), dir);

    return dot(east, east) < POLE_EPSILON * POLE_EPSILON ? vec3(0.0) : normalize(east);
  }

  float bdPotential(vec3 dir, float seed) {
    return sin(dir.x * 3.1 + seed) * cos(dir.y * 2.7 - seed) * sin(dir.z * 3.7 + seed * 0.5);
  }

  vec3 bdPotentialGradient(vec3 dir, float seed) {
    float h = 1e-3;

    return vec3(
      (bdPotential(dir + vec3(h, 0.0, 0.0), seed) - bdPotential(dir - vec3(h, 0.0, 0.0), seed)) / (2.0 * h),
      (bdPotential(dir + vec3(0.0, h, 0.0), seed) - bdPotential(dir - vec3(0.0, h, 0.0), seed)) / (2.0 * h),
      (bdPotential(dir + vec3(0.0, 0.0, h), seed) - bdPotential(dir - vec3(0.0, 0.0, h), seed)) / (2.0 * h)
    );
  }

  // Струи: sin по широте даёт чередование направлений от пояса к поясу,
  // сдвиг между соседними струями растягивает поле вдоль пояса и скручивает
  // вихри на их границах — юпитерианская механика.
  vec3 bdFlow(vec3 dir, float bandCount, float jetStrength, float turbulence, float seed) {
    vec3 zonal = bdEast(dir) * (jetStrength * sin(dir.y * PI * bandCount));
    vec3 curl = cross(dir, bdPotentialGradient(dir, seed)) * turbulence;

    return zonal + curl;
  }
`
