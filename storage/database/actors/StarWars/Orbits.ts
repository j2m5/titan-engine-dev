import { IOrbit } from '@/core/models/types'

const TatooOrbits: IOrbit[] = [
  {
    id: 1,
    actorId: 4,
    semiMajorAxis: 0.137,
    eccentricity: 0.25,
    inclination: 2.5,
    argOfPeriapsis: 47.8,
    ascendingNode: 94.2,
    meanAnomalyAtEpoch: 22.1
  },
  {
    id: 2,
    actorId: 5,
    semiMajorAxis: 0.145,
    eccentricity: 0.3,
    inclination: 2.5,
    argOfPeriapsis: 213.5,
    ascendingNode: 94.2,
    meanAnomalyAtEpoch: 335.4
  },
  {
    id: 3,
    actorId: 6,
    semiMajorAxis: 1.6,
    eccentricity: 0.05,
    inclination: 2.1,
    argOfPeriapsis: 259.1,
    ascendingNode: 27.4,
    meanAnomalyAtEpoch: 17.3
  },
  {
    id: 4,
    actorId: 7,
    semiMajorAxis: 5.2,
    eccentricity: 0.125,
    inclination: 1.7,
    argOfPeriapsis: 30.5,
    ascendingNode: 240.3,
    meanAnomalyAtEpoch: 70.8
  },
  {
    id: 5,
    actorId: 8,
    semiMajorAxis: 11.2,
    eccentricity: 0.26,
    inclination: 5.3,
    argOfPeriapsis: 140.6,
    ascendingNode: 58.2,
    meanAnomalyAtEpoch: 30.4
  },
  {
    id: 6,
    actorId: 9,
    semiMajorAxis: 0.001,
    eccentricity: 0.07,
    inclination: 3.142,
    argOfPeriapsis: 45.769,
    ascendingNode: 27.314,
    meanAnomalyAtEpoch: 97.123
  },
  {
    id: 7,
    actorId: 10,
    semiMajorAxis: 0.0027,
    eccentricity: 0.09,
    inclination: 4.36,
    argOfPeriapsis: 250.908,
    ascendingNode: 114.783,
    meanAnomalyAtEpoch: 178.234
  },
  {
    id: 8,
    actorId: 11,
    semiMajorAxis: 0.04,
    eccentricity: 0.36,
    inclination: 2.14,
    argOfPeriapsis: 310.582,
    ascendingNode: 87.231,
    meanAnomalyAtEpoch: 67.391
  },
  {
    id: 9,
    actorId: 12,
    semiMajorAxis: 0.003,
    eccentricity: 0.06,
    inclination: 0.14,
    argOfPeriapsis: 234.678,
    ascendingNode: 77.123,
    meanAnomalyAtEpoch: 10.234
  },
  {
    id: 10,
    actorId: 13,
    semiMajorAxis: 0.007,
    eccentricity: 0.16,
    inclination: 0.84,
    argOfPeriapsis: 56.789,
    ascendingNode: 210.345,
    meanAnomalyAtEpoch: 178.123
  },
  {
    id: 11,
    actorId: 14,
    semiMajorAxis: 0.015,
    eccentricity: 0.09,
    inclination: 1.32,
    argOfPeriapsis: 123.456,
    ascendingNode: 300.234,
    meanAnomalyAtEpoch: 250.567
  },
  {
    id: 12,
    actorId: 15,
    semiMajorAxis: 0.0017,
    eccentricity: 0.03,
    inclination: -30.2,
    argOfPeriapsis: 200.123,
    ascendingNode: 187.489,
    meanAnomalyAtEpoch: 342.567
  },
  {
    id: 13,
    actorId: 16,
    semiMajorAxis: 0.0024,
    eccentricity: 0.02,
    inclination: -31.4,
    argOfPeriapsis: 78.934,
    ascendingNode: 188.567,
    meanAnomalyAtEpoch: 150.245
  },
  {
    id: 14,
    actorId: 17,
    semiMajorAxis: 0.0035,
    eccentricity: 0.03,
    inclination: -32.1,
    argOfPeriapsis: 102.345,
    ascendingNode: 190.255,
    meanAnomalyAtEpoch: 89.456
  },
  {
    id: 15,
    actorId: 18,
    semiMajorAxis: 0.0064,
    eccentricity: 0.13,
    inclination: -35.8,
    argOfPeriapsis: 120.789,
    ascendingNode: 195.124,
    meanAnomalyAtEpoch: 270.987
  }
]

export const Orbits: IOrbit[] = [...TatooOrbits]
