import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { ShaderChunk, Uniform, Vector3, Color } from 'three'
import {
  asteroidIceFragmentDecl,
  asteroidIceFragmentLocals,
  asteroidIceVertexDecl,
  asteroidIceVertexSelect
} from '@/core/materials/shaders/lib/chunks/AsteroidIce'

export interface InstancedAsteroidShaderOptions {
  /**
   * Ледяная примесь (см. чанк AsteroidIce): доля инстансов берёт ручки
   * ледяного профиля. Вставляется строковой композицией — без опции текст
   * программы колец остаётся байт-в-байт прежним.
   */
  iceVariety?: boolean
}

/** Имена ручек профиля в теле фрагментника: юниформы, а под льдом — локалы-смеси по vIce */
const PROFILE_KNOBS = {
  base: {
    rockColor: 'uRockColor',
    specularStrength: 'uSpecularStrength',
    specularPower: 'uSpecularPower',
    specularTint: 'uSpecularTint',
    lunarMix: 'uLunarMix',
    surfaceAmbient: 'uSurfaceAmbient'
  },
  ice: {
    rockColor: 'rockColor',
    specularStrength: 'specularStrength',
    specularPower: 'specularPower',
    specularTint: 'specularTint',
    lunarMix: 'lunarMix',
    surfaceAmbient: 'surfaceAmbient'
  }
}

export const InstancedAsteroidShaderTemplate: ShaderProps = {
  uniforms: {
    lightPosition: new Uniform(new Vector3()),
    uLightColor: new Uniform(new Color(1, 1, 1)),
    // Макро-облик — профиль (см. чанк AsteroidSurface / AsteroidProfiles)
    uRockColor: new Uniform(new Color(0x6b6157)),
    uColorJitter: new Uniform(0.12),
    uTintStrength: new Uniform(0.25),
    uMariaStrength: new Uniform(0.3),
    uSurfaceAmbient: new Uniform(0.03),
    uSpecularStrength: new Uniform(0.05),
    uSpecularPower: new Uniform(8.0),
    uSpecularTint: new Uniform(0.0),
    // Фотограмметрический PBR-микрослой (см. чанк TriplanarDetail); enabled 0 —
    // текстуры не загрузились, слой выключен
    uRockDiffMap: new Uniform(null),
    uRockNorMap: new Uniform(null),
    uRockArmMap: new Uniform(null),
    uDetailMapsEnabled: new Uniform(0),
    uDetailScale: new Uniform(1),
    uDetailAverageDiffuse: new Uniform(new Vector3(1, 1, 1)),
    uDetailAverageArm: new Uniform(new Vector3(1, 1, 0)),
    uDetailSaturation: new Uniform(0.35),
    uDetailBrightness: new Uniform(1.6),
    uDetailNormalScale: new Uniform(1),
    uDetailAoInfluence: new Uniform(0.8),
    uDetailRoughInfluence: new Uniform(0.7),
    // Пылевая дымка (см. чанк RingDust). uDustDensity = 0 — туман выключен,
    // пока AsteroidRingSystem явно не сконфигурирует пыль.
    uDustColor: new Uniform(new Color(0x9b968c)),
    uDustDensity: new Uniform(0),
    uDustScaleHeight: new Uniform(1),
    uDustRingInner: new Uniform(0),
    uDustRingOuter: new Uniform(1e9),
    uDustCamRingPos: new Uniform(new Vector3()),
    uDustLightDirRing: new Uniform(new Vector3(1, 0, 0)),
    uDustAnglePower: new Uniform(2),
    uDustNearFade: new Uniform(1),
    uDustPlanetRadius: new Uniform(0),
    // Модель освещения камня (см. чанк AsteroidBrdf): реголит + planetshine
    uLunarMix: new Uniform(0.8),
    uOppositionSurge: new Uniform(0.3),
    uPlanetshineColor: new Uniform(new Color(0xb8ad9c)),
    uPlanetshineStrength: new Uniform(1.5),
    uRingshineStrength: new Uniform(0),
    // 1 — байты полос в sRGB (текстура кольца SRGBColorSpace), 0 — линейные
    uRingBandSrgb: new Uniform(0),
    // Радиальный профиль пыли из альфы текстуры кольца; scale 0 — выключен
    uDustRadialMap: new Uniform(null),
    uDustRadialMapScale: new Uniform(0),
    // Полосы кольца и слой (см. чанк RingDust): выключены, пока система не отдаст текстуру
    uRingBandMap: new Uniform(null),
    uRingBandEnabled: new Uniform(0),
    uBandMeanColor: new Uniform(new Vector3(1, 1, 1)),
    uBandTintStrength: new Uniform(1),
    uLayerHalfThickness: new Uniform(1),
    uLayerShadowStrength: new Uniform(0.25),
    // Деформация силуэта (см. чанк AsteroidShape). Амплитуда — per-instance из
    // диапазона [min,max]; min=max=0 → форма выключена.
    // Позиция плавающего начала в ring-local (см. FloatingOrigin): матрицы
    // инстансов хранятся относительно него, а ring-local абсолют нужен модели
    // пыли/тени. Кольца его не пишут — 0 и все выражения тождественны прежним.
    uOriginOffset: new Uniform(new Vector3()),
    uShapeAmpMin: new Uniform(0),
    uShapeAmpMax: new Uniform(0),
    uShapeFreq: new Uniform(1),
    // Вращение камня — период/время симуляции, см. объявления в вершиннике
    uSpinPeriod: new Uniform(0),
    uSpinTime: new Uniform(0),
    // Запечённые атрибуты породы (см. чанк AsteroidShape / ArchetypeShape.surfaceAt):
    // свежий скол разлома светлее/глаже, днища кратерных чаш затенены
    uFreshnessBrighten: new Uniform(0.15),
    uCavityShade: new Uniform(0.5),
    // Ледяная примесь (см. чанк AsteroidIce): доля 0 — все тела базового
    // профиля; ручки заполняет AsteroidRingSystem из ледяного профиля
    uIceFraction: new Uniform(0),
    uIceRockColor: new Uniform(new Color(0xc4d2dc)),
    uIceSpecularStrength: new Uniform(0.5),
    uIceSpecularPower: new Uniform(12.0),
    uIceSpecularTint: new Uniform(0.0),
    uIceLunarMix: new Uniform(0.5),
    uIceSurfaceAmbient: new Uniform(0.06)
  },
  ...instancedAsteroidShaderSource()
}

/**
 * Тексты вершинника и фрагментника по опциям. Без опций — прежний текст
 * колец побайтно: куски льда пустые строки, ручки профиля — сами юниформы.
 */
export function instancedAsteroidShaderSource(
  options: InstancedAsteroidShaderOptions = {}
): Pick<ShaderProps, 'vertexShader' | 'fragmentShader'> {
  const ice = options.iceVariety === true
  const iceVertexDecl = ice ? asteroidIceVertexDecl : ''
  const iceVertexSelect = ice ? asteroidIceVertexSelect : ''
  const iceFragmentDecl = ice ? asteroidIceFragmentDecl : ''
  const iceFragmentLocals = ice ? asteroidIceFragmentLocals : ''
  const knob = ice ? PROFILE_KNOBS.ice : PROFILE_KNOBS.base

  return {
  vertexShader: `
    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_vertex']}

    uniform vec3 lightPosition;
    // Смещение начала едет юниформом; float32 здесь достаточно — потребители
    // vRingPos (пыль, тень планеты, полосы) гладкие по радиусу
    uniform vec3 uOriginOffset;
    uniform float uShapeAmpMin;
    uniform float uShapeAmpMax;
    uniform float uShapeFreq;
    uniform float uImpostorReady;
    uniform float uLodVolumetric;
    uniform float uDetailStartFraction;
    attribute float instanceDetailEnd;
    attribute float instanceDetailMix;
    // Вращение камня: uSpinPeriod — номинальный период в секундах СИМУЛЯЦИИ
    // (часы данных → секунды на CPU, 0 — выкл); uSpinTime — время симуляции
    // (ctx.epoch, не рендер-часы), свёрнутое на CPU по кратному 12·uSpinPeriod
    // (см. AsteroidRingSystem.updateObject) — отдельный от прочих юниформ времени движка
${iceVertexDecl}

    // Per-instance fade [0..1] — плавные LOD/sector-переходы (см. InstancePool.writeFade)
    attribute float instanceFade;
    // Смещение сектора камня от плавающего начала (см. InstancePool.writeOrigins):
    // матрица инстанса хранит позицию ОТНОСИТЕЛЬНО центра сектора, абсолютная в
    // системе кольца = instanceOrigin + instanceMatrix[3].xyz. Оба слагаемых малы,
    // само начало внесено в modelViewMatrix на CPU в double. У колец начало не
    // переезжает, атрибут нулевой — все выражения ниже тождественны прежним.
    attribute vec3 instanceOrigin;
    // Запечённые атрибуты породы из библиотеки архетипов (см. ArchetypeGeometry,
    // ArchetypeShape.surfaceAt): xy = freshness (скол разлома), cavity (кратерная
    // чаша); zw — резервные каналы, не прокидываются во фрагмент. Геометрии без
    // этого атрибута (WebGL default) дают (0,0,0,0) → модуляция ниже тихо нейтральна.
    attribute vec4 surfaceData;

    varying vec3 vViewLightDirection;
    varying vec3 vViewPosition;
    varying vec3 vPlanetDirView;
    varying vec3 vRingNormalView;
    varying vec3 vRingPos;
    varying vec3 vObjectPos;
    varying vec3 vObjectNormal;
    varying mat3 vObjToView;
    varying float vFade;
    varying float vAsteroidDetailWeight;
    varying vec2 vSurfaceData;
    // Пер-инстансные хеши сида считаются ЗДЕСЬ и едут во фрагмент готовыми:
    // сырой сид через хеш во фрагментнике превращает ULP-джиттер интерполяции
    // в пиксельный шум («сетка» по фасетам). Джиттер самих значений (≤1e-6 без
    // хеш-усиления) визуально нулевой.
    varying float vTintSeed;
    varying vec3 vDomainOffset;
    varying vec2 vTriOffset;

    #include <noiseFunctions>
    #include <asteroidShapeFunctions>
#include <asteroidPoseFunctions>

    void main() {
      // Деформация силуэта: сид рисунка контура — хеш от МЕСТНОЙ позиции
      // инстанса (в своём секторе): она у камня не меняется при переезде
      // плавающего начала, а instanceOrigin меняется — сид от суммы
      // перещёлкивал бы форму всех камней разом. У колец начало нулевое, и
      // выражение то же, что было.
      // Амплитуда — второй, декоррелированный хеш той же позиции → каждый
      // камень получает свою «изрезанность» из диапазона [min,max].
      if (abs(determinant(mat3(instanceMatrix))) < 1e-20) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
      vAsteroidDetailWeight = 1.0;
      if (uImpostorReady > 0.5 && instanceDetailEnd > 0.0) {
        vec3 cameraLocal = -inverse(mat3(modelViewMatrix)) * modelViewMatrix[3].xyz;
        vec3 cameraDelta = instanceOrigin + instanceMatrix[3].xyz - cameraLocal;
        float distance = uLodVolumetric > 0.5 ? length(cameraDelta) : length(cameraDelta.xz);
        float q = 1.0 - smoothstep(uDetailStartFraction * instanceDetailEnd, instanceDetailEnd, distance);
        vAsteroidDetailWeight = q * instanceDetailMix;
      }
      float shapeSeed = hash13(instanceMatrix[3].xyz);
      float ampSeed = hash13(instanceMatrix[3].xyz * 1.37 + 11.7);
      float shapeAmp = mix(uShapeAmpMin, uShapeAmpMax, ampSeed) * vAsteroidDetailWeight;
      vec3 shapedPos;
      vec3 shapedNormal;
      deformAsteroid(position, normal, shapeSeed, shapeAmp, shapedPos, shapedNormal);

      // Вращение вокруг оси из того же хеша, что форма (shapeSeed — значение
      // вершинника, НЕ варьинг: ULP-джиттер интерполяции сюда не попадает).
      // uSpinPeriod <= 0 — блок не исполняется, всё ниже тождественно прежнему
      // (кольца по умолчанию).
      //
      // Поза ДО вращения — домен узора и трипланара (vObjectPos/vObjectNormal):
      // текстура привязана к камню. Из повёрнутой позы узор стоял бы в
      // пространстве, а камень крутился под ним. Само вращение — матрицей в
      // vObjToView: освещение видит повёрнутую нормаль
      vec3 restPos = shapedPos;
      vec3 restNormal = shapedNormal;
      mat3 spin = asteroidSpinMatrix(shapeSeed);
      shapedPos = spin * restPos;

      vec4 worldPosition = instanceMatrix * vec4(shapedPos, 1.0);
      // Абсолютная позиция в системе кольца: смещение сектора + локальная
      worldPosition.xyz += instanceOrigin;
      vec4 mvPosition = modelViewMatrix * worldPosition;

      gl_Position = projectionMatrix * mvPosition;

      // Ring-local позиция фрагмента для модели пыли/тени (пофрагментная) —
      // от ЦЕНТРА КОЛЬЦА, а не от плавающего начала: прибавляем его смещение.
      vRingPos = worldPosition.xyz + uOriginOffset;

      vec4 viewLightDirection = viewMatrix * vec4(lightPosition, 1.0);

      vViewLightDirection = normalize(viewLightDirection.xyz - mvPosition.xyz);
      vViewPosition = -mvPosition.xyz;
      // Направление на центр планеты (начало ring-local) во view — для
      // planetshine. В модельном пространстве центр кольца лежит в
      // -uOriginOffset: модельное начало — это плавающее начало
      vPlanetDirView = normalize((modelViewMatrix * vec4(-uOriginOffset, 1.0)).xyz - mvPosition.xyz);
      // Нормаль листа кольца в view: ring-local Y (лист — плоскость XZ)
      vRingNormalView = normalize(mat3(modelViewMatrix) * vec3(0.0, 1.0, 0.0));

      // Для макро-облика (см. чанк AsteroidSurface): объектная позиция (домен),
      // геом. нормаль объекта (нормаль больше не возмущается процедурно) и
      // матрица объект→view — трипланарная деталь (см. чанк TriplanarDetail)
      // применяется к геометрической нормали во фрагменте.
      vObjectPos = restPos;
      vObjectNormal = restNormal;
      vObjToView = normalMatrix * asteroidNormalMatrix(mat3(instanceMatrix), spin);
      vFade = instanceFade;
      // Freshness фасет разлома + cavity кратерных чаш из запекания (см. attribute
      // выше); резервные каналы zw не прокидываем
      vSurfaceData = surfaceData.xy;

      // Пер-инстансные хеши (см. комментарий у varyings): тинт, сдвиг домена
      // макро-шумов, сдвиг трипланарной проекции — из сида формы
      vTintSeed = hashSurface11(shapeSeed + 3.17);
      vDomainOffset = vec3(
        hashSurface11(shapeSeed + 1.1),
        hashSurface11(shapeSeed + 2.2),
        hashSurface11(shapeSeed + 3.3)
      ) * 40.0;
      vTriOffset = vec2(
        hashSurface11(shapeSeed + 7.7),
        hashSurface11(shapeSeed + 9.9)
      ) * 8.0;${iceVertexSelect}

      ${ShaderChunk['logdepthbuf_vertex']}
    }
  `,
  fragmentShader: `
    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_fragment']}

    uniform vec3 uRockColor;
    uniform float uColorJitter;
    uniform float uTintStrength;
    uniform float uMariaStrength;
    uniform float uSurfaceAmbient;
    uniform float uSpecularStrength;
    uniform float uSpecularPower;
    uniform float uSpecularTint;
    uniform float uFreshnessBrighten;
    uniform float uCavityShade;
    uniform float uLunarMix;
    uniform float uOppositionSurge;
    uniform vec3 uPlanetshineColor;
    uniform float uPlanetshineStrength;
    uniform float uRingshineStrength;
    uniform float uRingBandSrgb;${iceFragmentDecl}

    #ifdef USE_LIGHT_TINT
      uniform vec3 uLightColor;
    #endif

    varying vec3 vViewLightDirection;
    varying vec3 vViewPosition;
    varying vec3 vPlanetDirView;
    varying vec3 vRingNormalView;
    varying vec3 vRingPos;
    varying vec3 vObjectPos;
    varying vec3 vObjectNormal;
    varying mat3 vObjToView;
    varying float vFade;
    varying float vAsteroidDetailWeight;
    varying vec2 vSurfaceData;
    // Готовые пер-инстансные хеши из вершинника (анти-ULP-джиттер, см. вершинник)
    varying float vTintSeed;
    varying vec3 vDomainOffset;
    varying vec2 vTriOffset;

    #include <noiseFunctions>
    #include <asteroidSurfaceFunctions>
    #include <asteroidBrdfFunctions>
    #include <triplanarDetailUniforms>
    #include <triplanarDetailFunctions>
    #include <ringDustUniforms>
    #include <ringDustFunctions>
#include <asteroidAppearanceFunctions>

    // Interleaved gradient noise (Jimenez) — экранный дизер для fade-переходов.
    float fadeDither(vec2 fragCoord) {
      return fract(52.9829189 * fract(dot(fragCoord, vec2(0.06711056, 0.00583715))));
    }

    void main() {
      ${ShaderChunk['logdepthbuf_fragment']}

      // Screen-door fade: непрозрачная геометрия гаснет упорядоченным дизером —
      // без сортировки, с сохранением depthWrite. Знак vFade кодирует направление
      // кросс-фейда: уходящий тир (vFade<0) берёт ИНВЕРТИРОВАННЫЙ порог, поэтому
      // его покрытие комплементарно входящему (vFade>0) — сумма ≈ полный камень
      // без «дыр» на середине перехода. |vFade|>=1 → порог не срабатывает.
      float fadeMag = abs(vFade);
      float fadeThresh = fadeDither(gl_FragCoord.xy);
      if (vFade < 0.0) fadeThresh = 1.0 - fadeThresh;
      if (fadeMag < fadeThresh) discard;

${iceFragmentLocals}
      AsteroidAppearanceProfile profile = AsteroidAppearanceProfile(${knob.rockColor}, ${knob.specularStrength}, ${knob.specularPower}, ${knob.specularTint}, ${knob.lunarMix}, ${knob.surfaceAmbient});
      vec3 finalColor = shadeAsteroid(vObjectPos, vObjectNormal, vObjToView, vViewPosition, vViewLightDirection,
        vPlanetDirView, vRingNormalView, vRingPos, vSurfaceData, vTintSeed, vDomainOffset, vTriOffset, vAsteroidDetailWeight, profile);

      gl_FragColor = vec4(finalColor, 1.0);

      ${ShaderChunk['tonemapping_fragment']}
      ${ShaderChunk['colorspace_fragment']}
    }
  `
  }
}
