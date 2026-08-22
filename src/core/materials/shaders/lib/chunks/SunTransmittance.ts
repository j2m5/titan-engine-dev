import { TRANSMITTANCE_H, TRANSMITTANCE_W } from '@/core/renderables/Atmosphere/AtmosphereLUTGenerator'

/**
 * Цвет солнца на палубе: пропускание Брунетона от точки датума к солнцу,
 * нормированное зенитным (tint ≡ 1 в зените — яркость тел не меняется).
 * Порт GetTransmittanceTextureUvFromRMu / GetTransmittanceToSun ядра на
 * юниформах; параметризация LUT — ПОДОГНАННЫЕ радиусы (пол рельефа),
 * точка — радиус датума (RTC-патчи радиус не несут; см. спеку §1).
 */
export const sunTransmittanceUniforms = /* glsl */ `
  uniform sampler2D uAtmoTransmittance;
  uniform float uAtmoBottomRadius;
  uniform float uAtmoTopRadius;
  uniform float uAtmoSunAngularRadius;
  uniform float uAtmoDatumRadius;
  uniform float uSunTintStrength;
`

export const sunTransmittanceFunctions = /* glsl */ `
  const int ATMO_TRANSMITTANCE_W = ${TRANSMITTANCE_W};
  const int ATMO_TRANSMITTANCE_H = ${TRANSMITTANCE_H};

  float atmoSafeSqrt(float a) { return sqrt(max(a, 0.0)); }

  float atmoUnitToTexCoord(float x, int n) {
    return 0.5 / float(n) + x * (1.0 - 1.0 / float(n));
  }

  float atmoDistanceToTop(float r, float mu) {
    float discriminant = r * r * (mu * mu - 1.0) + uAtmoTopRadius * uAtmoTopRadius;
    return max(-r * mu + atmoSafeSqrt(discriminant), 0.0);
  }

  vec2 atmoTransmittanceUv(float r, float mu) {
    float H = sqrt(uAtmoTopRadius * uAtmoTopRadius - uAtmoBottomRadius * uAtmoBottomRadius);
    float rho = atmoSafeSqrt(r * r - uAtmoBottomRadius * uAtmoBottomRadius);
    float d = atmoDistanceToTop(r, mu);
    float d_min = uAtmoTopRadius - r;
    float d_max = rho + H;
    float x_mu = (d - d_min) / (d_max - d_min);
    // Ниже горизонта d выходит за d_max (x_mu > 1) — кламп к [0,1] = ClampToEdge
    // самой LUT; smoothstep солнечного диска там и так даёт 0.
    x_mu = clamp(x_mu, 0.0, 1.0);
    float x_r = rho / H;
    return vec2(atmoUnitToTexCoord(x_mu, ATMO_TRANSMITTANCE_W), atmoUnitToTexCoord(x_r, ATMO_TRANSMITTANCE_H));
  }

  vec3 atmoTransmittanceToTop(float r, float mu) {
    return texture2D(uAtmoTransmittance, atmoTransmittanceUv(r, mu)).rgb;
  }

  vec3 atmoTransmittanceToSun(float r, float muS) {
    float sin_theta_h = uAtmoBottomRadius / r;
    float cos_theta_h = -sqrt(max(1.0 - sin_theta_h * sin_theta_h, 0.0));
    return atmoTransmittanceToTop(r, muS) *
      smoothstep(-sin_theta_h * uAtmoSunAngularRadius, sin_theta_h * uAtmoSunAngularRadius, muS - cos_theta_h);
  }

  // tint = T(r, muS) / T(r, 1): в зените 1, к терминатору теплее и темнее, как небо
  vec3 sunTint(float muS) {
    vec3 zenith = max(atmoTransmittanceToSun(uAtmoDatumRadius, 1.0), vec3(1e-3));
    return clamp(atmoTransmittanceToSun(uAtmoDatumRadius, muS) / zenith, 0.0, 1.0);
  }
`
