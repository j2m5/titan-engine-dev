import type { IUniform } from 'three'
import { config } from '@/core/framework/config'
import type { BackgroundSource } from '@/config/background'
import {
  createSkyboxSampleUniforms,
  skyboxSampleFunctions,
  skyboxSampleUniforms
} from '@/core/materials/shaders/lib/chunks/SkyboxSample'
import { gaiaSkyUniforms } from '@/core/sky/gaiaSkyUniforms'

const gaiaUniforms = `
  uniform highp samplerCube uGaiaGalaxy;
  uniform highp samplerCube uGaiaStars;
  uniform highp samplerCube uGaiaStarsCoarse;
  uniform mat3 uGaiaOrientation;
  uniform float uGaiaMinLod;
  uniform float uGaiaExposure;
  uniform float uGaiaStarCeiling;
`

const gaiaFunctions = `
  // Данные Брунетона (gaia_sky_map): грань 2048², отпечаток пикселя не шире
  // 4 текселей, ручной фильтр на уровнях 0…6
  const float GAIA_CUBE_SIZE = 2048.0;
  const float GAIA_MAX_FOOTPRINT_SIZE = 4.0;
  const float GAIA_MAX_FOOTPRINT_LOD = 6.0;
  const float GAIA_GALAXY_SCALE = 6.78494e-5;
  // Единица площади галактики — центральный тексель грани, (1/1024)² ср
  const float GAIA_TEXEL_AREA_INV = 1048576.0;

  // Звёзды в отпечатке пикселя × scale (порт DefaultStarColor). Звезда — точка
  // с треугольным весом в экранных пикселях, позиция в текселе — хеш битов её
  // цвета. Грубые уровни — средние, уже яркость: scale к ним не идёт
  vec3 gaiaStars(vec3 dir, vec3 dxDir, vec3 dyDir, float scale) {
    vec3 absDir = abs(dir);
    float maxComp = max(absDir.x, max(absDir.y, absDir.z));
    // Наибольшая компонента — в z; обе перестановки самообратны
    int axis = maxComp == absDir.x ? 1 : (maxComp == absDir.y ? 2 : 0);
    vec3 d = axis == 1 ? dir.zyx : (axis == 2 ? dir.xzy : dir);
    vec3 dx = axis == 1 ? dxDir.zyx : (axis == 2 ? dxDir.xzy : dxDir);
    vec3 dy = axis == 1 ? dyDir.zyx : (axis == 2 ? dyDir.xzy : dyDir);

    // uv грани и производные аналитически: dFdx(uv) рвётся на рёбрах куба
    float invZ = 1.0 / d.z;
    vec2 uv = d.xy * invZ;
    vec2 dxUv = (dx.xy - uv * dx.z) * invZ;
    vec2 dyUv = (dy.xy - uv * dy.z) * invZ;

    vec2 dUv = max(abs(dxUv + dyUv), abs(dxUv - dyUv));
    vec2 footprint = (0.5 * GAIA_CUBE_SIZE / GAIA_MAX_FOOTPRINT_SIZE) * dUv;
    float lod = max(ceil(max(log2(footprint.x), log2(footprint.y))), uGaiaMinLod);
    // Нулевые или коллинеарные производные: inverse ниже дал бы NaN
    float det = dxUv.x * dyUv.y - dxUv.y * dyUv.x;
    // Один выход: ранний return перед динамическим циклом ANGLE (HLSL)
    // помечает как «возможно неинициализированный» результат
    vec3 result = vec3(0.0);
    if (lod > GAIA_MAX_FOOTPRINT_LOD || abs(det) <= 1e-6 * dot(dUv, dUv)) {
      // Исходное направление — у Брунетона здесь переставленное
      result = textureGrad(uGaiaStarsCoarse, dir, dxDir, dyDir).rgb;
    } else {
      float lodWidth = (0.5 * GAIA_CUBE_SIZE) / exp2(lod);
      mat2 toScreenPixels = inverse(mat2(dxUv, dyUv));
      ivec2 ij0 = ivec2(floor((uv - dUv) * lodWidth));
      ivec2 ij1 = ivec2(floor((uv + dUv) * lodWidth));
      for (int j = ij0.y; j <= ij1.y; ++j) {
        for (int i = ij0.x; i <= ij1.x; ++i) {
          vec2 texelUv = (vec2(i, j) + 0.5) / lodWidth;
          vec3 texelDir = vec3(texelUv * d.z, d.z);
          texelDir = axis == 1 ? texelDir.zyx : (axis == 2 ? texelDir.xzy : texelDir);
          vec3 star = textureLod(uGaiaStars, texelDir, lod).rgb;
          vec2 subTexel = vec2((floatBitsToInt(star.rb) >> 8) % 257) / 257.0 - 0.5;
          vec2 starPixels = toScreenPixels * (uv - texelUv + subTexel / lodWidth);
          vec2 overlap = max(vec2(1.0) - abs(starPixels), 0.0);
          result += star * overlap.x * overlap.y;
        }
      }
      result *= scale;
    }
    return result;
  }

  // Небо по направлению dir (мир сцены); dDirDx/dDirDy — его экранные
  // производные, посчитанные вызывающим до ветвлений
  vec3 sampleSky(vec3 dir, vec3 dDirDx, vec3 dDirDy) {
    vec3 d = uGaiaOrientation * dir;
    vec3 dx = uGaiaOrientation * dDirDx;
    vec3 dy = uGaiaOrientation * dDirDy;
    vec3 galaxy = textureGrad(uGaiaGalaxy, d, dx, dy).rgb * GAIA_GALAXY_SCALE;
    // Поток звёзд → яркость: площадь пикселя в текселях, не меньше одного
    float pixelArea = max(length(cross(dx, dy)) * GAIA_TEXEL_AREA_INV, 1.0);
    vec3 sky = (galaxy + gaiaStars(d, dx, dy, 1.0 / pixelArea)) * uGaiaExposure;
    // Мягкий потолок: выше C — логарифм, гладко в C, цветность сохраняется
    float y = dot(sky, vec3(0.2126, 0.7152, 0.0722));
    if (y > uGaiaStarCeiling) sky *= uGaiaStarCeiling * (1.0 + log(y / uGaiaStarCeiling)) / y;
    return sky;
  }
`

const cubemapFunctions = `${skyboxSampleFunctions}
  // Прежняя кубмапа: производные не нужны
  vec3 sampleSky(vec3 dir, vec3 dDirDx, vec3 dDirDy) {
    return sampleSkyboxHdr(skybox, dir, uSkyFlipX);
  }
`

/**
 * Единственная точка чтения неба для всех мест — фон, сильное поле дыры,
 * дальнее поле линзы: расхождение между ними — ступенька на кромке сферы
 * линзы. Ветка выбирается при сборке строки: #include раскрывается одним
 * проходом. Ветка cubemap читает `skybox` — потребитель объявляет его до include
 */
export function buildSkySampleUniforms(source: BackgroundSource): string {
  return source === 'gaia' ? gaiaUniforms : skyboxSampleUniforms
}

export function buildSkySampleFunctions(source: BackgroundSource): string {
  return source === 'gaia' ? gaiaFunctions : cubemapFunctions
}

export const skySampleUniforms: string = buildSkySampleUniforms(config('background.source'))
export const skySampleFunctions: string = buildSkySampleFunctions(config('background.source'))

/**
 * Юниформы неба для материала. Gaia — ОБЩИЕ экземпляры (GaiaSky пишет в них
 * текстуры и уровень загрузки); cubemap — свежие, из конфига фона
 */
export function createSkyUniforms(source: BackgroundSource = config('background.source')): Record<string, IUniform> {
  return source === 'gaia' ? { ...gaiaSkyUniforms } : createSkyboxSampleUniforms()
}
