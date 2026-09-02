/**
 * SceneDepth — обрыв луча объёмного марша по глубине сцены.
 *
 * Общая реализация для всех материалов, которые рисует DepthVolumePass (пыль
 * колец, туманность): один фрагмент прокси несёт интеграл вдоль всего луча, и
 * аппаратный тест глубины бинарен — он не умеет «объём до поверхности есть, за
 * ней нет». Поэтому объём рисуется после сцены, читает КОПИЮ depth-текстуры по
 * экранной координате и режет параметр луча на tScene.
 *
 * Глубина — логарифмическая three (проект всегда рендерит с лог-буфером,
 * src/config/three.ts): z = log2(1 + w)/log2(far + 1), w = −viewZ вдоль оси
 * камеры. Перевод в параметр луча: камера — начало view-пространства, поэтому
 * −viewZ(t) = t · (−dirView.z), где dirView = mat3(modelViewMatrix) · rayDir в
 * ЛОКАЛЬНЫХ единицах луча без нормировки — масштаб модели учитывается сам.
 *
 * uSceneDepthEnabled — пасс включает обрезку перед рендером объёма и выключает
 * после: рендер вне пасса (запекание импостора) идёт без глубины сцены.
 */

export const sceneDepthUniforms = `
  uniform sampler2D uSceneDepth;
  uniform vec2 uResolution;
  uniform float uLogFarFactor;
  uniform float uSceneDepthEnabled;
`

export const sceneDepthFunctions = `
  // Параметр луча (в единицах dirView), на котором луч упирается в сцену.
  // Небо (z = 1) и выключенная обрезка ничего не режут.
  float sceneDepthRayT(vec3 dirView) {
    if (uSceneDepthEnabled < 0.5) return 1.0e30;
    float z = texture2D(uSceneDepth, gl_FragCoord.xy / uResolution).r;
    if (z < 1.0 - 1e-6) {
      // Лог-глубина three: z = log2(1 + w)/log2(far + 1), w = -viewZ
      float w = exp2(z * uLogFarFactor) - 1.0;
      // Камера — начало view-пространства: -viewZ(t) = t * (-dirView.z)
      return w / max(-dirView.z, 1e-6);
    }
    return 1.0e30;
  }
`
