/** Общий макрооблик, PBR-предел и освещение геометрии и импостора. */
export const asteroidAppearanceFunctions = /* glsl */`
  uniform vec3 uDetailAverageDiffuse;
  uniform vec3 uDetailAverageArm;
  struct AsteroidAppearanceProfile {
    vec3 rockColor;
    float specularStrength;
    float specularPower;
    float specularTint;
    float lunarMix;
    float surfaceAmbient;
  };
  vec3 shadeAsteroid(vec3 vObjectPos, vec3 vObjectNormal, mat3 vObjToView,
    vec3 vViewPosition, vec3 vViewLightDirection, vec3 vPlanetDirView, vec3 vRingNormalView,
    vec3 vRingPos, vec2 vSurfaceData, float vTintSeed, vec3 vDomainOffset, vec2 vTriOffset,
    float detailWeight, AsteroidAppearanceProfile profile) {
      vec3 surfDir = normalize(vObjectPos);
      vec3 albedo = applyAsteroidSurface(surfDir, vTintSeed, vDomainOffset, profile.rockColor, uColorJitter, uTintStrength, uMariaStrength);
      albedo *= ringBandTint(length(vRingPos.xz));
      vec3 objN = normalize(vObjectNormal);
      float surfAO = 1.0;
      float specStrength = profile.specularStrength;
      float specPower = profile.specularPower;
      if (uDetailMapsEnabled > 0.5) {
        vec3 geomN = normalize(vObjectNormal);
        vec3 detail = uDetailAverageDiffuse;
        vec3 arm = uDetailAverageArm;
        if (detailWeight > 0.0) {
          vec3 triW = triplanarWeights(geomN);
          vec2 triOffset = vTriOffset;
          detail = mix(detail, triplanarAlbedo(uRockDiffMap, vObjectPos, triW, triOffset), detailWeight);
          arm = mix(arm, triplanarArm(uRockArmMap, vObjectPos, triW, triOffset), detailWeight);
          vec3 nDetail = triplanarNormal(uRockNorMap, vObjectPos, geomN, triW, triOffset);
          objN = normalize(objN + detailWeight * uDetailNormalScale * (nDetail - geomN));
        }
        float detailLum = dot(detail, vec3(0.299, 0.587, 0.114));
        vec3 structureTint = mix(vec3(detailLum), detail, uDetailSaturation);
        albedo *= structureTint * uDetailBrightness;
        surfAO *= mix(1.0, arm.r, uDetailAoInfluence);
        float gloss = 1.0 - arm.g * uDetailRoughInfluence;
        specStrength *= gloss;
        specPower = max(specPower * gloss, 2.0);
      }
      albedo *= 1.0 + uFreshnessBrighten * vSurfaceData.x;
      specStrength *= 1.0 + 0.5 * vSurfaceData.x;
      surfAO *= 1.0 - uCavityShade * vSurfaceData.y;
      vec3 normal = normalize(vObjToView * objN);
      if (!gl_FrontFacing) normal = -normal;
      vec3 lightDirection = normalize(vViewLightDirection);
      vec3 viewDir = normalize(vViewPosition);
      float NdotL = dot(normal, lightDirection);
      float NdotV = dot(normal, viewDir);
      float cosPhase = dot(lightDirection, viewDir);
      float lightIntensity = asteroidRegolithDiffuse(NdotL, NdotV, cosPhase, profile.lunarMix, uOppositionSurge);
      float planetShadow = ringDustPlanetShadow(vRingPos);
      float direct = planetShadow * ringLayerShadow(vRingPos);
      float shine = asteroidPlanetshine(normal, normalize(vPlanetDirView), vRingPos, uDustLightDirRing, uDustPlanetRadius);
      #ifdef USE_LIGHT_TINT
        vec3 finalColor = albedo * (lightIntensity * surfAO * direct * uLightColor + profile.surfaceAmbient);
      #else
        vec3 finalColor = albedo * (lightIntensity * surfAO * direct + profile.surfaceAmbient);
      #endif
      finalColor += albedo * uPlanetshineColor * (uPlanetshineStrength * shine * surfAO);
      if (uRingBandEnabled > 0.5 && uRingshineStrength > 0.0) {
        float ringR = length(vRingPos.xz);
        vec3 band = ringBandAt(ringR).rgb;
        vec3 sheetColor = mix(band, pow(band, vec3(2.2)), uRingBandSrgb);
        vec3 ringshine = asteroidRingshine(normal, normalize(vRingNormalView), vRingPos, uDustLightDirRing, ringLayerTau(ringR), sheetColor, uLayerHalfThickness);
        #ifdef USE_LIGHT_TINT
          finalColor += albedo * ringshine * (uRingshineStrength * planetShadow * surfAO) * uLightColor;
        #else
          finalColor += albedo * ringshine * (uRingshineStrength * planetShadow * surfAO);
        #endif
      }
      vec3 halfVec = normalize(lightDirection + viewDir);
      float specNormalVar = dot(dFdx(normal), dFdx(normal)) + dot(dFdy(normal), dFdy(normal));
      float specToksvig = 1.0 / (1.0 + specPower * specNormalVar);
      float specPowerAA = specPower * specToksvig;
      float spec = pow(max(dot(normal, halfVec), 0.0), specPowerAA) * specStrength * specToksvig;
      vec3 specColor = mix(vec3(1.0), albedo, profile.specularTint);
      #ifdef USE_LIGHT_TINT
        finalColor += spec * specColor * uLightColor * max(NdotL, 0.0) * direct;
      #else
        finalColor += spec * specColor * max(NdotL, 0.0) * direct;
      #endif
      finalColor = ringDustApplyFog(finalColor, vRingPos);
      return finalColor;
  }
`
