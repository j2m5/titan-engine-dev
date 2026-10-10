import { AbstractShader } from '@/core/materials/shaders/AbstractShader'

/**
 * Вершинник неба на полноэкранном треугольнике: луч из клип-пространства
 * обратно в мировое. inverse() здесь дёшев: вершин ровно три
 */
export const SKY_VERTEX_SHADER: string = AbstractShader.prepareSource(/* glsl */ `
  precision highp float;

  uniform mat4 projectionMatrix;
  uniform mat4 viewMatrix;

  in vec3 position;

  out vec3 vRay;

  void main() {
    vec4 clip = vec4(position.xy, 1.0, 1.0);
    vec4 eye = inverse(projectionMatrix) * clip;
    vRay = (inverse(viewMatrix) * vec4(eye.xy, -1.0, 0.0)).xyz;
    gl_Position = clip;
  }
`)

/**
 * Фрагментник неба. Фон (layer = false) и слой видимого неба для проходов
 * линзы (layer = true, см. SkyLayer) — один источник: значения неба обязаны
 * совпадать бит-в-бит, иначе вычитание слоя из копии кадра оставит в линзе
 * следы звёзд. Небо считается безусловно — производные в равномерном потоке
 */
export function buildSkyFragmentShader(layer: boolean): string {
  const depth = layer ? 'uniform highp sampler2D uSceneDepth;' : ''
  const output = layer
    ? `// Видимо там, где сцена не написала глубину (небо на «бесконечности»)
      float visible = texelFetch(uSceneDepth, ivec2(gl_FragCoord.xy), 0).r >= 1.0 - 1e-6 ? 1.0 : 0.0;
      fragColor = vec4(sky * visible, visible);`
    : 'fragColor = vec4(sky, 1.0);'
  return AbstractShader.prepareSource(/* glsl */ `
    precision highp float;

    uniform samplerCube skybox;
    ${depth}

    #include <skySampleUniforms>
    #include <skySampleFunctions>

    in vec3 vRay;

    layout(location = 0) out vec4 fragColor;

    void main() {
      // Производные — до любых ветвлений: по ним фильтр звёзд берёт отпечаток пикселя
      vec3 dir = normalize(vRay);
      vec3 sky = sampleSky(dir, dFdx(dir), dFdy(dir));
      ${output}
    }
  `)
}
