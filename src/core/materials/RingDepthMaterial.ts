import { DoubleSide, ShaderChunk, Uniform } from 'three'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import type { RingMaterial } from '@/core/materials/RingMaterial'

/**
 * Порог ВИДИМОЙ альфы кольца (альфа текстуры после затуханий по дистанции и по
 * углу взгляда), с которого тексель считается ПОВЕРХНОСТЬЮ для эффектов по
 * глубине: он пишет глубину в пре-пассе, и полноэкранная атмосфера тонирует то,
 * что перед ним, а не то, что за ним. Тексели тоньше порога глубину не пишут —
 * кольцо там остаётся «прозрачным», и дымку набирает то, что видно сквозь него
 * (диск планеты, космос).
 *
 * Значение обязано быть СТРОГО ВЫШЕ `ringEdgeOpacity` (0.1): на ребре угловое
 * затухание кладёт пол именно на этой величине, и порог ниже пола вернул бы
 * жёсткую линию глубины вдоль почти невидимого кольца.
 *
 * Верхний край шкалы недостижим на пологих ракурсах: под 7° к плоскости угловое
 * затухание даёт максимум ≈0.14, под 20° ≈0.28. Порог 0.5 (он стоял, пока гейт
 * читал сырую альфу текстуры) после включения затуханий выключал бы пре-пасс
 * везде положе ~36°.
 *
 * Это ДРУГАЯ ручка, нежели `alphaTest` цветового прохода (0.08–0.2 в данных):
 * тот решает, рисовать ли пиксель вообще, этот — считать ли его непрозрачным.
 */
export const RING_DEPTH_ALPHA_TEST_DEFAULT: number = 0.12

/**
 * Материал глубинного пре-пасса кольца: цвета не пишет, пишет только глубину.
 *
 * Зачем: цветовой проход кольца прозрачен и `depthWrite = false`, поэтому в
 * depth-буфере на месте кольца остаётся то, что за ним, — диск планеты. Для
 * полноэкранной атмосферы (эффект по глубине) это значит «кольцо лежит на
 * поверхности планеты», и кольцо перед диском получало дымку планеты. Пре-пасс
 * возвращает в буфер честную глубину плотных участков кольца.
 *
 * `transparent = false` кладёт его в НЕПРОЗРАЧНУЮ очередь — она рисуется до
 * всех прозрачных, то есть до самого кольца; цветовой проход остаётся на
 * дефолтном `LessEqualDepth` и потому рисуется поверх собственной глубины.
 *
 * Силуэт глубины равен ВИДИМОМУ силуэту цветового прохода на пороге: гейт
 * повторяет обе его затухающие — по дистанции (`transparencyFactor`) и по углу
 * взгляда (`angleOpacity`) — и режет по произведению
 * `color.a * transparencyFactor * angleOpacity`. Иначе выцветшее в ноль кольцо
 * (камера ближе `minDistance`, либо взгляд почти на ребро) осталось бы писать
 * глубину и невидимым заслоняло бы камни и пыль за плоскостью кольца, а на
 * лимбе давало бы жёсткую линию «поверхности» в эффекте по глубине.
 *
 * Юниформы `diffuseMap`/`innerRadius`/`outerRadius` и ручки затуханий
 * (`minDistance`/`maxDistance`/`ringEdgeOpacity`/`ringAngleCurve`) разделяются с
 * цветовым материалом ПО ССЫЛКЕ (те же объекты `Uniform`): оба прохода обязаны
 * видеть одну текстуру, одни радиусы и одни пороги затуханий, иначе силуэт
 * глубины разойдётся с картинкой. `updateMaterial` — точка входа фан-аута
 * `materialSync`: если карта кольца когда-нибудь начнёт стримиться, значение
 * подтянется и без общего объекта.
 */
class RingDepthMaterial extends AbstractShaderMaterial {
  private readonly source: RingMaterial

  public constructor(source: RingMaterial, depthAlphaTest: number = RING_DEPTH_ALPHA_TEST_DEFAULT) {
    super()
    this.source = source

    this.uniforms = {
      diffuseMap: source.uniforms.diffuseMap,
      innerRadius: source.uniforms.innerRadius,
      outerRadius: source.uniforms.outerRadius,
      minDistance: source.uniforms.minDistance,
      maxDistance: source.uniforms.maxDistance,
      ringEdgeOpacity: source.uniforms.ringEdgeOpacity,
      ringAngleCurve: source.uniforms.ringAngleCurve,
      uDepthAlphaTest: new Uniform(depthAlphaTest)
    }

    this.vertexShader = RingDepthMaterial.vertexSource
    this.fragmentShader = RingDepthMaterial.fragmentSource

    this.side = DoubleSide
    this.transparent = false
    this.colorWrite = false
    this.depthWrite = true
    this.depthTest = true
  }

  public updateMaterial(): void {
    this.uniforms.diffuseMap.value = this.source.uniforms.diffuseMap.value
  }

  /** Заглушки цветового материала пре-пассу безразличны: он читает ту же текстуру, что и кольцо */
  public resetMaterial(): void {
    this.updateMaterial()
  }

  /** Позиция считается ровно как в RingShaderTemplate — глубина обязана совпасть с цветовым проходом */
  private static readonly vertexSource: string = `
    precision highp float;

    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_vertex']}

    varying vec3 vPosition;
    varying vec3 vLocalCameraPosition;

    void main() {
      vec3 viewPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;

      gl_Position = projectionMatrix * vec4(viewPosition, 1.0);

      vPosition = position;
      vLocalCameraPosition = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
      ${ShaderChunk['logdepthbuf_vertex']}
    }
  `

  private static readonly fragmentSource: string = `
    precision highp float;

    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_fragment']}

    uniform sampler2D diffuseMap;
    uniform float innerRadius;
    uniform float outerRadius;
    uniform float minDistance;
    uniform float maxDistance;
    uniform float ringEdgeOpacity;
    uniform float ringAngleCurve;
    uniform float uDepthAlphaTest;

    varying vec3 vPosition;
    varying vec3 vLocalCameraPosition;

    void main() {
      vec2 uv;
      uv.x = (length(vPosition) - innerRadius) / (outerRadius - innerRadius);

      if (uv.x < 0.0 || uv.x > 1.0) discard;
      uv.y = 0.0;

      vec4 color = texture2D(diffuseMap, uv);

      // Затухания дословно из цветового прохода: глубину пишет только то,
      // что там действительно видно
      float distance = length(vLocalCameraPosition - vPosition);
      float transparencyFactor = smoothstep(minDistance, maxDistance, distance);

      vec3 viewDirLocal = normalize(vLocalCameraPosition - vPosition);
      float faceCos = abs(viewDirLocal.z);
      float angleOpacity = mix(ringEdgeOpacity, 1.0, pow(faceCos, ringAngleCurve));

      float a = color.a * transparencyFactor * angleOpacity;

      if (a <= uDepthAlphaTest) discard;

      ${ShaderChunk['logdepthbuf_fragment']}
      gl_FragColor = vec4(0.0);
    }
  `
}

export { RingDepthMaterial }
