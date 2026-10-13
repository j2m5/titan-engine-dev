export function replaceExactlyOnce(
  source: string,
  anchor: string | RegExp,
  replacement: string,
  pass: string,
  point: string
): string {
  const matches =
    typeof anchor === 'string'
      ? source.split(anchor).length - 1
      : [...source.matchAll(new RegExp(anchor.source, 'g'))].length
  if (matches !== 1) throw new Error(`${pass} shader ${point}: expected one replacement, found ${matches}`)
  return source.replace(anchor, () => replacement)
}

export const geographyShader = `uniform mat3 cloudECEFToPlanet;
uniform float cloudLongitudeOffset;

vec2 getGlobeUv(const vec3 position) {
  vec3 n = normalize(cloudECEFToPlanet * position);
  float phi = dot(n.xz, n.xz) > 1e-12 ? atan(n.z, -n.x) : 0.0;
  float u = (phi + cloudLongitudeOffset) / 6.283185307179586;
  return vec2(fract(u), 1.0 - acos(clamp(n.y, -1.0, 1.0)) / 3.141592653589793);
}`

const mipShader = `float getMipLevel(const vec2 uv) {
  vec2 uvA = vec2(fract(uv.x), uv.y);
  vec2 uvB = vec2(fract(uv.x + 0.5) - 0.5, uv.y);
  vec2 dxA = dFdx(uvA), dxB = dFdx(uvB);
  vec2 dyA = dFdy(uvA), dyB = dFdy(uvB);
  vec2 size = vec2(textureSize(localWeatherTexture, 0));
  vec2 dx = vec2(min(abs(dxA.x), abs(dxB.x)), abs(dxA.y)) * size;
  vec2 dy = vec2(min(abs(dyA.x), abs(dyB.x)), abs(dyA.y)) * size;
  return max(0.0, 0.5 * log2(max(1.0, max(dot(dx, dx), dot(dy, dy)))));
}`

const weatherShader = `WeatherSample sampleWeather(const vec2 uv, const float height, const float mipLevel) {
  WeatherSample weather;
  weather.heightFraction = remapClamped(vec4(height), minLayerHeights, maxLayerHeights);
  vec4 localWeather = vec4(textureLod(localWeatherTexture, uv, mipLevel).r, 0.0, 0.0, 0.0);
  #ifdef SHADOW
  localWeather *= shadowLayerMask;
  #endif
  weather.density = localWeather * shapeAlteringFunction(weather.heightFraction, shapeAlteringBiases);
  return weather;
}`

export const colorUniformShader = `uniform bool cloudUseColorMap;
uniform sampler2D cloudColorTexture;
uniform vec3 cloudConstantColor;
uniform float cloudColorStrength;
uniform float cloudColorMipBias;
`

export function adaptCloudAppearanceShader(source: string, pass: 'cloud' | 'shadow'): string {
  let shader = replaceExactlyOnce(source, /vec2 getGlobeUv\([^]*?\}/g, geographyShader, pass, 'getGlobeUv')
  shader = replaceExactlyOnce(shader, /float getMipLevel\([^]*?\}/g, mipShader, pass, 'getMipLevel')
  shader = replaceExactlyOnce(shader, /WeatherSample sampleWeather\([^]*?\}/g, weatherShader, pass, 'sampleWeather')
  shader = replaceExactlyOnce(
    shader,
    '(position + evolution + turbulence) * shapeRepeat',
    '(cloudECEFToPlanet * (position + evolution) + turbulence) * shapeRepeat',
    pass,
    'shape position'
  )
  shader = replaceExactlyOnce(
    shader,
    '(position + turbulence) * shapeDetailRepeat',
    '(cloudECEFToPlanet * position + turbulence) * shapeDetailRepeat',
    pass,
    'erosion position'
  )
  if (pass === 'cloud') {
    shader = replaceExactlyOnce(
      shader,
      'uniform mat3 cloudECEFToPlanet;',
      colorUniformShader + 'uniform mat3 cloudECEFToPlanet;',
      pass,
      'color uniforms'
    )
    shader = replaceExactlyOnce(
      shader,
      'radiance *= media.scattering;',
      `vec3 cloudColor = cloudUseColorMap
        ? textureLod(cloudColorTexture, uv, max(0.0, mipLevel + cloudColorMipBias)).rgb
        : cloudConstantColor;
      vec3 cloudAlbedo = mix(vec3(1.0), clamp(cloudColor, 0.0, 1.0), cloudColorStrength);
      radiance *= media.scattering * cloudAlbedo;`,
      pass,
      'scattering color'
    )
  }
  return shader
}
