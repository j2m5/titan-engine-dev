/** Original deformation at 669e0028. Keep this independent of the optimized
 * chunk: zero amplitude still reconstructs dir*R and normalizes the normal. */
export const deformationReference = `
  vec4 referenceFbmGrad(vec3 p) {
    vec4 sum = vec4(0.0);
    float amp = 0.5;
    float freq = 1.0;
    for (int o = 0; o < 2; o++) {
      vec4 nv = snoiseGrad(p * freq);
      sum.x += amp * nv.x;
      sum.yzw += amp * freq * nv.yzw;
      amp *= 0.5;
      freq *= 2.0;
    }
    return sum;
  }
  void referenceDeform(vec3 pos, vec3 normal, float seed, float amp, out vec3 displacedPos, out vec3 newNormal) {
    float R = length(pos);
    vec3 dir = pos / max(R, 1e-6);
    vec3 domain = dir * uShapeFreq + vec3(seed * 17.13, seed * 5.71, seed * 9.37);
    vec4 nv = referenceFbmGrad(domain);
    displacedPos = dir * (R * (1.0 + amp * nv.x));
    vec3 gdisp = amp * nv.yzw;
    vec3 gTangent = gdisp - dot(gdisp, normal) * normal;
    gTangent /= 1.0 + length(gTangent);
    newNormal = normalize(normal - gTangent);
  }
`
