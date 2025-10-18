export const atmosphereFunctions = `
  vec2 raySphere(in vec3 rayOrigin, in vec3 rayDirection, in float sphereRadius) {
    float b = 2.0 * dot(rayOrigin, rayDirection);
    float c = dot(rayOrigin, rayOrigin) - sphereRadius * sphereRadius;
    float d = b * b - 4.0 * c;

    if (d > 0.0) {
      float s = sqrt(d);
      float dstToSphereNear = max(0.0, (-b - s) / 2.0);
      float dstToSphereFar = (-b + s) / 2.0;

      if (dstToSphereFar > 0.0) {
        return vec2(dstToSphereNear, dstToSphereFar - dstToSphereNear);
      }
    }

    return vec2(500.0, 0.0);
  }

  float densityAtPoint(in vec3 densitySamplePoint) {
    float heightAboveSurface = length(densitySamplePoint - origin) - targetRadius;
    float height01 = heightAboveSurface / (atmosphereRadius - targetRadius);
    float localDensity = exp(-height01 * densityFalloff) * (1.0 - height01);

    return localDensity;
  }

  float opticalDepth(in vec3 rayOrigin, in vec3 rayDirection, in float rayLength) {
    vec3 densitySamplePoint = rayOrigin;
    float stepSize = rayLength / float(OPTICAL_DEPTH_POINT_COUNT - 1);
    float opticalDepth = 0.0;

    for (int i = 0; i < OPTICAL_DEPTH_POINT_COUNT; i++) {
      float localDensity = densityAtPoint(densitySamplePoint);
      opticalDepth += localDensity * stepSize;
      densitySamplePoint += rayDirection * stepSize;
    }

    return opticalDepth;
  }

  vec3 calculateLight(in vec3 rayOrigin, in vec3 rayDirection, in float rayLength, in vec3 originalColor) {
    vec3 dirToSun = normalize(-vLocalLightDirection);
    vec3 scatterPoint = rayOrigin;
    float stepSize = rayLength / float(SCATTER_POINT_COUNT - 1);
    vec3 scatterLight = vec3(0.0);

    float viewRayOpticalDepth = 0.0;

    for (int i = 0; i < SCATTER_POINT_COUNT; i++) {
      float sunRayLength = raySphere(scatterPoint, dirToSun, atmosphereRadius).y;
      float sunRayOpticalDepth = opticalDepth(scatterPoint, dirToSun, sunRayLength);
      viewRayOpticalDepth = opticalDepth(scatterPoint, -rayDirection, stepSize * float(i));
      float localDensity = densityAtPoint(scatterPoint);
      vec3 transmittance = exp(-(sunRayOpticalDepth + viewRayOpticalDepth) * scatterRGB);

      scatterLight += localDensity * stepSize * transmittance * scatterRGB;
      scatterPoint += rayDirection * stepSize;
    }

    float originalColorTransmittance = exp(-viewRayOpticalDepth);

    return originalColorTransmittance * originalColor + scatterLight;
  }
`

export const atmosphereFragment = `
  vec3 rayOrigin = vLocalCameraPosition;
  vec3 rayDirection = normalize(vPosition - rayOrigin);
  vec4 atmosphereColor;

  vec2 planetHitInfo = raySphere(rayOrigin, rayDirection, targetRadius);
  vec2 atmosphereHitInfo = raySphere(rayOrigin, rayDirection, atmosphereRadius);

  float dstToSurface = planetHitInfo.x;
  float dstToAtmosphere = atmosphereHitInfo.x;
  float dstThroughAtmosphere = min(atmosphereHitInfo.y, dstToSurface - dstToAtmosphere);

  if (dstThroughAtmosphere > 0.0) {
    vec3 pointInAtmosphere = rayOrigin + rayDirection * dstToAtmosphere;
    vec3 light = calculateLight(pointInAtmosphere, rayDirection, dstThroughAtmosphere, origin);

    atmosphereColor = vec4(light, 1.0);
  } else {
    atmosphereColor = vec4(origin, 0.0);
  }
`
