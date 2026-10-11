/** Общая поза меша и запечённой формы; noiseFunctions включается раньше. */
export const asteroidPoseFunctions = /* glsl */`
  uniform float uSpinPeriod;
  uniform float uSpinTime;

  mat3 asteroidSpinMatrix(float shapeSeed) {
    mat3 spin = mat3(1.0);
    if (uSpinPeriod > 0.0) {
      vec3 spinAxis = normalize(vec3(
        hashSurface11(shapeSeed + 13.13),
        hashSurface11(shapeSeed + 17.17),
        hashSurface11(shapeSeed + 19.19)
      ) * 2.0 - 1.0);
      float m = min(6.0 + floor(hashSurface11(shapeSeed + 23.23) * 13.0), 18.0);
      float spinAngle = 2.0 * PI * (uSpinTime * (m / 12.0) / uSpinPeriod + hashSurface11(shapeSeed + 29.29));
      float cosA = cos(spinAngle);
      float sinA = sin(spinAngle);
      spin = cosA * mat3(1.0) + sinA * mat3(0.0, spinAxis.z, -spinAxis.y, -spinAxis.z, 0.0, spinAxis.x, spinAxis.y, -spinAxis.x, 0.0) + (1.0 - cosA) * outerProduct(spinAxis, spinAxis);
    }
    return spin;
  }

  mat3 asteroidNormalMatrix(mat3 instanceLinear, mat3 spin) {
    return transpose(inverse(instanceLinear)) * spin;
  }
`
