import { skyboxSampleFunctions, skyboxSampleUniforms } from '@/core/materials/shaders/lib/chunks/SkyboxSample'

/** Слотов линз в одном проходе: сцены с двумя дырами — уже двойная система */
export const LENS_SLOTS = 2

/**
 * Дальнее поле гравитационной линзы поверх готового кадра.
 *
 * Для пикселя с прицельным параметром b > R (снаружи меша сильной зоны)
 * направление луча доворачивается к дыре на α(b) = 2/b + (15π/16)/b² + (16/3)/b³
 * (b в rs; зеркало deflectionLut.farFieldDeflection), и кадр читается по
 * сдвинутому направлению. Внутри меша (b ≤ R) кадр уже лензирован шейдером дыры
 * полным отклонением из LUT — на кромке обе величины совпадают, поле сдвига
 * гладкое. Сдвинутая выборка, попавшая в диск меша или за экран, берёт
 * кубмапу фона по направлению — иначе сильное поле лензировалось бы дважды.
 *
 * Не сдвигаются: пиксели с глубиной сцены ближе плоскости наибольшего
 * сближения (объект перед линзой) и кадры с камерой внутри сферы (там весь
 * экран рисует шейдер дыры — линза отфильтрована на CPU).
 */
export function buildGravitationalLensFragment(): string {
  return /* glsl */ `
  uniform int uCount;
  uniform vec3 uCenterView[${LENS_SLOTS}];
  uniform float uRs[${LENS_SLOTS}];
  uniform float uSimRadius[${LENS_SLOTS}];
  uniform mat4 uProjection;
  uniform mat4 uProjectionInverse;
  uniform mat4 uCameraWorldMatrix;
  uniform float uLogFarFactor;
  uniform samplerCube skybox;
  ${skyboxSampleUniforms}
  ${skyboxSampleFunctions}

  // Ряд дальнего поля Шварцшильда, b в rs (зеркало deflectionLut.farFieldDeflection)
  float lensFarField(float b) {
    float b2 = b * b;
    return 2.0 / b + 2.9452431 / b2 + 5.3333333 / (b2 * b);
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    if (uCount == 0) { outputColor = inputColor; return; }

    // Луч через пиксель в пространстве вида (clip.z = 0: см. AtmosphereEffect)
    vec4 clip = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
    vec4 viewH = uProjectionInverse * clip;
    vec3 d = normalize(viewH.xyz / viewH.w);

    // Лог-глубина three: z = log2(1 + w)/log2(far + 1), w вдоль оси камеры;
    // расстояние вдоль луча — w / (−d.z)
    float z = texture2D(depthBuffer, uv).r;
    float sceneT = z >= 1.0 - 1e-6 ? 1e30 : (exp2(z * uLogFarFactor) - 1.0) / max(-d.z, 1e-6);

    vec3 color = inputColor.rgb;
    for (int i = 0; i < ${LENS_SLOTS}; i++) {
      if (i >= uCount) break;
      vec3 c = uCenterView[i];
      float tMid = dot(c, d);
      if (tMid <= 0.0) continue;                 // дыра позади камеры
      vec3 perp = c - tMid * d;
      float b = length(perp);
      float R = uSimRadius[i];
      if (b <= R) continue;                      // внутри меша — рисует шейдер дыры
      if (sceneT < tMid) continue;               // объект перед плоскостью сближения

      float alpha = lensFarField(b / uRs[i]);
      vec3 inward = perp / b;
      vec3 d2 = normalize(cos(alpha) * d + sin(alpha) * inward);

      // Куда попала сдвинутая выборка: в диск меша, за экран или на объект
      // перед плоскостью сближения (он не за линзой и копироваться не должен) — кубмапа
      float tMid2 = dot(c, d2);
      float b2 = length(c - tMid2 * d2);
      vec4 p = uProjection * vec4(d2, 0.0);
      vec2 uv2 = p.xy / p.w * 0.5 + 0.5;
      bool onScreen = p.w > 0.0 && all(greaterThanEqual(uv2, vec2(0.0))) && all(lessThanEqual(uv2, vec2(1.0)));
      bool behindLens = false;
      if (onScreen) {
        float z2 = texture2D(depthBuffer, uv2).r;
        float sceneT2 = z2 >= 1.0 - 1e-6 ? 1e30 : (exp2(z2 * uLogFarFactor) - 1.0) / max(-d2.z, 1e-6);
        behindLens = !(sceneT2 < tMid2);
      }
      if (onScreen && b2 > R && behindLens) {
        color = texture2D(inputBuffer, uv2).rgb;
      } else {
        vec3 world = normalize(mat3(uCameraWorldMatrix) * d2);
        color = sampleSkyboxHdr(skybox, world, uSkyFlipX);
      }
      break;                                     // одна линза на пиксель
    }

    outputColor = vec4(color, inputColor.a);
  }
  `
}
