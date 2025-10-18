export const ringShadowUniforms = `
  uniform float shadowRingsInnerRadius;
  uniform float shadowRingsOuterRadius;
  uniform sampler2D shadowRingsTexture;
`

export const ringShadowFunctions = `
  vec3 getShadowFromRings(vec3 lightColor, vec3 lightDir) {
    vec3 ringNormal = vec3(0.0, 1.0, 0.0);
    float d = dot(vPosition, ringNormal) / dot(lightDir, ringNormal);
    vec3 pointOnRingPlane = -d * lightDir + vPosition;
    float distanceOnPlane = length(pointOnRingPlane - dot(pointOnRingPlane, ringNormal) * ringNormal);
    float shadowU = (distanceOnPlane - shadowRingsInnerRadius) / (shadowRingsOuterRadius - shadowRingsInnerRadius);
    float shadowIntensity = 1.0 - texture2D(shadowRingsTexture, vec2(shadowU, 0.0)).a;

    if (shadowRingsInnerRadius <= distanceOnPlane && distanceOnPlane <= shadowRingsOuterRadius && d > 0.0) {
      return lightColor * shadowIntensity;
    } else {
      return lightColor;
    }
  }
`

export const ringShadowFragment = `
  lightColor = getShadowFromRings(lightColor, normalize(vLocalLightDirection));
  finalColor *= lightColor;
`
