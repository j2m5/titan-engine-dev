import { hashSurface11Function } from './Noise'
import { hash13Function } from './AsteroidShape'

/**
 * Ледяная примесь камней стримера (USE_ICE_VARIETY): заданная данными доля
 * тел получает ручки ледяного профиля вместо базового, остальные — базовый.
 *
 * Выбор — хеш МЕСТНОЙ позиции инстанса в секторе, тот же вход, что у сида
 * формы: камень не меняет породу при переезде плавающего начала, а L0/Near и
 * билборд считают одно и то же выражение — тир не меняет выбор.
 *
 * Все куски вставляются строковой композицией: без опции тексты программ
 * колец остаются байт-в-байт прежними. Детальные карты у ледяных тел
 * остаются базовыми — второй сет текстур в общий материал не подмешать.
 */

/** Выражение выбора — одно на оба материала, иначе тиры разойдутся во льде */
export const ASTEROID_ICE_SELECT = 'step(1.0 - uIceFraction, hashSurface11(hash13(instanceMatrix[3].xyz) + 53.53))'

/** Вершинник L0: hash13 и hashSurface11 у него уже есть (чанки формы и шумов) */
export const asteroidIceVertexDecl = `
    uniform float uIceFraction;
    varying float vIce;`

/** Вершинник билборда: чанков формы/шумов у него нет — оба хеша приходят сюда */
export const asteroidIceBillboardVertexDecl = `
        uniform float uIceFraction;
        varying float vIce;
        ${hashSurface11Function}
        ${hash13Function}`

/** Выбор породы инстанса: 1 — ледяное тело, 0 — базовый профиль */
export const asteroidIceVertexSelect = `
      vIce = ${ASTEROID_ICE_SELECT};`

export const asteroidIceFragmentDecl = `
    uniform vec3 uIceRockColor;
    uniform float uIceSpecularStrength;
    uniform float uIceSpecularPower;
    uniform float uIceSpecularTint;
    uniform float uIceLunarMix;
    uniform float uIceSurfaceAmbient;
    varying float vIce;`

/** Ручки профиля по породе инстанса; имена локалов подставляются на места юниформов */
export const asteroidIceFragmentLocals = `
      vec3 rockColor = mix(uRockColor, uIceRockColor, vIce);
      float specularStrength = mix(uSpecularStrength, uIceSpecularStrength, vIce);
      float specularPower = mix(uSpecularPower, uIceSpecularPower, vIce);
      float specularTint = mix(uSpecularTint, uIceSpecularTint, vIce);
      float lunarMix = mix(uLunarMix, uIceLunarMix, vIce);
      float surfaceAmbient = mix(uSurfaceAmbient, uIceSurfaceAmbient, vIce);`

export const asteroidIceBillboardFragmentDecl = `
        uniform vec3 uIceRockColor;
        varying float vIce;`

/** Билборд без блика: ледяное тело отличается только цветом породы */
export const ASTEROID_ICE_BILLBOARD_COLOR = 'mix(uColor, uIceRockColor, vIce)'
