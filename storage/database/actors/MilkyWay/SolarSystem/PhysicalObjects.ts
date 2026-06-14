import { IPhysicalObject } from '@/core/models/types'
import { JupiterMass, JupiterRadius, SolarMass, SolarRadius } from '@/core/constants'

const Common: IPhysicalObject[] = [
  {
    id: 18,
    actorId: 31,
    parentId: 54,
    mass: SolarMass,
    radius: SolarRadius,
    axialTilt: 0,
    orbitalPeriod: 6.050707298909615e3,
    rotationPeriod: 10,
    temperature: 5778
  },
  {
    id: 19,
    actorId: 32,
    parentId: 54,
    mass: 3.3022e23,
    radius: 2440,
    axialTilt: 28.55,
    orbitalPeriod: 8.796918597597157e1,
    rotationPeriod: 1407.509405,
    temperature: 0
  },
  {
    id: 20,
    actorId: 33,
    parentId: 54,
    mass: 4.868e24,
    radius: 6051.8,
    axialTilt: 157.16,
    orbitalPeriod: 2.246975358369535e2,
    rotationPeriod: 5832.443616,
    temperature: 0
  },
  {
    id: 21,
    actorId: 34,
    parentId: 54,
    mass: 5.9736e24,
    radius: 6360,
    axialTilt: 23.4392911,
    orbitalPeriod: 2.731247317860557e1,
    rotationPeriod: 23.93447117,
    temperature: 0
  },
  {
    id: 22,
    actorId: 35,
    parentId: 54,
    mass: 6.4185e23,
    radius: 3390,
    axialTilt: 37.1135,
    orbitalPeriod: 7.210940705945861e-2,
    rotationPeriod: 24.622962156,
    temperature: 0
  },
  {
    id: 23,
    actorId: 36,
    parentId: 54,
    mass: 5.21e-10,
    radius: 469.7,
    axialTilt: 2.9,
    orbitalPeriod: 1.681454717456132e3,
    rotationPeriod: 9.07417,
    temperature: 0
  },
  {
    id: 24,
    actorId: 37,
    parentId: 54,
    mass: JupiterMass,
    radius: JupiterRadius,
    axialTilt: 2.22,
    orbitalPeriod: 1.734883989257963,
    rotationPeriod: 9.927953,
    temperature: 0
  },
  {
    id: 25,
    actorId: 38,
    parentId: 54,
    mass: 5.6846e26,
    radius: 58232,
    axialTilt: 28.052,
    orbitalPeriod: 1.176084225722678e1,
    rotationPeriod: 10.65622222,
    temperature: 0
  },
  {
    id: 26,
    actorId: 39,
    parentId: 54,
    mass: 8.681e25,
    radius: 25362,
    axialTilt: 97.722,
    orbitalPeriod: 6.607931280358359e-1,
    rotationPeriod: 17.24,
    temperature: 0
  },
  {
    id: 27,
    actorId: 40,
    parentId: 54,
    mass: 1.0243e26,
    radius: 24622,
    axialTilt: -28.03,
    orbitalPeriod: 5.644116357717567e1,
    rotationPeriod: 16.11,
    temperature: 0
  },
  {
    id: 28,
    actorId: 41,
    parentId: 54,
    mass: 1.305e22,
    radius: 1188.3,
    axialTilt: 119.591,
    orbitalPeriod: 6.38756595397599,
    rotationPeriod: 153.2935,
    temperature: 0
  },
  {
    id: 29,
    actorId: 42,
    parentId: 54,
    mass: 4.006e21,
    radius: 816,
    axialTilt: 0,
    orbitalPeriod: 1.02657569818199e5,
    rotationPeriod: 3.9154,
    temperature: 0
  },
  {
    id: 30,
    actorId: 43,
    parentId: 54,
    mass: 3.1e21,
    radius: 739,
    axialTilt: 0,
    orbitalPeriod: 1.112600602113746e5,
    rotationPeriod: 22.8266,
    temperature: 0
  },
  {
    id: 31,
    actorId: 44,
    parentId: 54,
    mass: 1.66e22,
    radius: 1163,
    axialTilt: 78,
    orbitalPeriod: 2.054788963660803e5,
    rotationPeriod: 25.9,
    temperature: 0
  },
  {
    id: 32,
    actorId: 45,
    parentId: 54,
    mass: 1.705e21,
    radius: 800,
    axialTilt: 0,
    orbitalPeriod: 2.054788963660803e5,
    rotationPeriod: 25.9,
    temperature: 0
  }
]
const Satellites: IPhysicalObject[] = [
  {
    id: 33,
    actorId: 46,
    parentId: 21,
    mass: 7.348e22,
    radius: 1735.97,
    axialTilt: 23.4608,
    orbitalPeriod: 2.731247317860291e1,
    rotationPeriod: 15542.212395883795,
    temperature: 0
  },
  {
    id: 34,
    actorId: 47,
    parentId: 24,
    mass: 893.2e20,
    radius: 1821.5,
    axialTilt: 0,
    orbitalPeriod: 1.772367152320881,
    rotationPeriod: 10,
    temperature: 0
  },
  {
    id: 35,
    actorId: 48,
    parentId: 24,
    mass: 480.0e20,
    radius: 1561,
    axialTilt: 0,
    orbitalPeriod: 3.553265805980927,
    rotationPeriod: 10,
    temperature: 0
  },
  {
    id: 36,
    actorId: 49,
    parentId: 24,
    mass: 1481.9e20,
    radius: 2631.2,
    axialTilt: 0,
    orbitalPeriod: 7.153113697741118,
    rotationPeriod: 10,
    temperature: 0
  },
  {
    id: 37,
    actorId: 50,
    parentId: 24,
    mass: 1075.9e20,
    radius: 2410.3,
    axialTilt: 0,
    orbitalPeriod: 1.669052351407539e1,
    rotationPeriod: 10,
    temperature: 0
  },
  {
    id: 38,
    actorId: 51,
    parentId: 25,
    mass: 3.75094e19,
    radius: 198.8,
    axialTilt: 6.48,
    orbitalPeriod: 9.423157476085949e-1,
    rotationPeriod: 10,
    temperature: 0
  },
  {
    id: 39,
    actorId: 52,
    parentId: 25,
    mass: 10.805e19,
    radius: 252.3,
    axialTilt: 6.48,
    orbitalPeriod: 1.370606981145769,
    rotationPeriod: 10,
    temperature: 0
  },
  {
    id: 40,
    actorId: 53,
    parentId: 25,
    mass: 61.76e19,
    radius: 536.3,
    axialTilt: 6.48,
    orbitalPeriod: 1.886742973951342,
    rotationPeriod: 10,
    temperature: 0
  },
  {
    id: 41,
    actorId: 54,
    parentId: 25,
    mass: 109.572e19,
    radius: 562.5,
    axialTilt: 6.48,
    orbitalPeriod: 2.733943223759778,
    rotationPeriod: 10,
    temperature: 0
  },
  {
    id: 42,
    actorId: 55,
    parentId: 25,
    mass: 230.9e19,
    radius: 764.5,
    axialTilt: 6.48,
    orbitalPeriod: 4.525634191766411,
    rotationPeriod: 10,
    temperature: 0
  },
  {
    id: 43,
    actorId: 56,
    parentId: 25,
    mass: 13455.3e19,
    radius: 2575,
    axialTilt: 6.06,
    orbitalPeriod: 1.594742668590515e1,
    rotationPeriod: 10,
    temperature: 0
  },
  {
    id: 44,
    actorId: 57,
    parentId: 25,
    mass: 180.59e19,
    radius: 734.5,
    axialTilt: 6.48,
    orbitalPeriod: 7.934018039665129e1,
    rotationPeriod: 10,
    temperature: 0
  },
  {
    id: 45,
    actorId: 58,
    parentId: 26,
    mass: 6.59e19,
    radius: 240,
    axialTilt: 74.9,
    orbitalPeriod: 1.413302216921377,
    rotationPeriod: 1.413302216921377,
    temperature: 0
  },
  {
    id: 46,
    actorId: 59,
    parentId: 26,
    mass: 1.353e21,
    radius: 577.9,
    axialTilt: 74.9,
    orbitalPeriod: 2.520985069377978,
    rotationPeriod: 2.520985069377978,
    temperature: 0
  },
  {
    id: 47,
    actorId: 60,
    parentId: 26,
    mass: 1.172e21,
    radius: 585,
    axialTilt: 74.9,
    orbitalPeriod: 4.144873237937239,
    rotationPeriod: 4.144873237937239,
    temperature: 0
  },
  {
    id: 48,
    actorId: 61,
    parentId: 26,
    mass: 3.527e21,
    radius: 788.9,
    axialTilt: 74.9,
    orbitalPeriod: 8.705875264578351,
    rotationPeriod: 8.705875264578351,
    temperature: 0
  },
  {
    id: 49,
    actorId: 62,
    parentId: 26,
    mass: 3.014e21,
    radius: 761.5,
    axialTilt: 74.9,
    orbitalPeriod: 1.346519665013879e1,
    rotationPeriod: 1.346519665013879e1,
    temperature: 0
  },
  {
    id: 50,
    actorId: 63,
    parentId: 27,
    mass: 2.1389e22,
    radius: 1352.6,
    axialTilt: 110.44,
    orbitalPeriod: 5.877059225888581,
    rotationPeriod: 208.94077099,
    temperature: 0
  },
  {
    id: 51,
    actorId: 64,
    parentId: 28,
    mass: 1.5897e21,
    radius: 606,
    axialTilt: 0,
    orbitalPeriod: 6.386965485763453,
    rotationPeriod: 10,
    temperature: 0
  },
  {
    id: 52,
    actorId: 65,
    parentId: 31,
    mass: 8.2e19,
    radius: 320,
    axialTilt: 0,
    orbitalPeriod: 1.578715398179681e1,
    rotationPeriod: 10,
    temperature: 0
  },
  {
    id: 54,
    actorId: 23,
    parentId: null,
    mass: SolarMass * 1.01,
    radius: 1,
    axialTilt: 0,
    orbitalPeriod: 1,
    rotationPeriod: 1,
    temperature: 0
  },
  {
    id: 55,
    actorId: 24,
    parentId: 54,
    mass: 5.9736e24,
    radius: 1,
    axialTilt: 0,
    orbitalPeriod: 1,
    rotationPeriod: 1,
    temperature: 0
  },
  {
    id: 66,
    actorId: 25,
    parentId: 54,
    mass: 6.4185e23,
    radius: 1,
    axialTilt: 0,
    orbitalPeriod: 1,
    rotationPeriod: 1,
    temperature: 0
  },
  {
    id: 56,
    actorId: 26,
    parentId: 54,
    mass: JupiterMass,
    radius: 1,
    axialTilt: 0,
    orbitalPeriod: 1,
    rotationPeriod: 1,
    temperature: 0
  },
  {
    id: 57,
    actorId: 27,
    parentId: 54,
    mass: 5.6846e26,
    radius: 1,
    axialTilt: 0,
    orbitalPeriod: 1,
    rotationPeriod: 1,
    temperature: 0
  },
  {
    id: 58,
    actorId: 28,
    parentId: 54,
    mass: 8.681e25,
    radius: 1,
    axialTilt: 0,
    orbitalPeriod: 1,
    rotationPeriod: 1,
    temperature: 0
  },
  {
    id: 59,
    actorId: 29,
    parentId: 54,
    mass: 1.0243e26,
    radius: 1,
    axialTilt: 0,
    orbitalPeriod: 1,
    rotationPeriod: 1,
    temperature: 0
  },
  {
    id: 60,
    actorId: 30,
    parentId: 54,
    mass: 1.305e22 + 1.5897e21,
    radius: 1,
    axialTilt: 0,
    orbitalPeriod: 1,
    rotationPeriod: 1,
    temperature: 0
  }
]

export const SolarSystemPhysicalObjects: IPhysicalObject[] = [...Common, ...Satellites]
