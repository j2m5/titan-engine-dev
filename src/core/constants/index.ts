export const G = 2.9591220828559115e-4
export const SolarRadius = 696000
export const SolarMass = 1.9891e30
export const EarthRadius = 6378.1
export const EarthMass = 5.9736e24
export const MoonRadius = 1735.97
export const MoonMass = 7.348e22
export const JupiterRadius = 69911
export const JupiterMass = 1.8986e27

export const LightSpeed = 299792
export const AU = 149597870
export const AUM = AU * 1000
export const CIRCLE = 2 * Math.PI
export const QUARTER_CIRCLE = Math.PI / 2
export const J2000 = 2451545
export const UNIX_EPOCH_JULIAN_DATE = 2440587.5
export const DAY = 86400 //60 * 60 * 24;
export const YEAR = 365.25
export const CENTURY = 100 * YEAR
export const SceneSize = 5 * Math.pow(10, 13)
export const SpaceScale = Math.pow(10, -3.3)

/**
 * Категория актора-атмосферы (`storage/database/categories.ts`, alias
 * `atmosphere`): атмосфера — дочерний актор своего тела, и её ищут по
 * `children.where('categoryId', …)`.
 */
export const ATMOSPHERE_CATEGORY_ID = 5

/**
 * Категория актора-звезды (`storage/database/categories.ts`): звезда или
 * звезда-гигант — либо корень дерева акторов, либо его прямой ребёнок
 * (см. resolveStarRadiusKm).
 */
export const STAR_CATEGORY_ID = 3

/** Категория звезды-гиганта (`giantStar`) */
export const GIANT_STAR_CATEGORY_ID = 10

/**
 * Категории, которые движок считает светилом системы, в порядке предпочтения.
 * Карлики и чёрная дыра не входят осознанно: добавление категории меняет
 * полутень теней рельефа у всех тел под таким объектом.
 */
export const LIGHT_SOURCE_CATEGORY_IDS: readonly number[] = [STAR_CATEGORY_ID, GIANT_STAR_CATEGORY_ID]
