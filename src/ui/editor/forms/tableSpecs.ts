import { TableSpec } from '@/ui/editor/forms/fieldSpec'

const idField = { key: 'id', label: 'ID', kind: 'number' as const, readonly: true }
const actorFk = {
  key: 'actorId',
  label: 'Actor',
  kind: 'select-fk' as const,
  references: 'actors' as const,
  full: true
}

export const orbitsSpec: TableSpec = {
  table: 'orbits',
  title: 'Orbits',
  fields: [
    idField,
    actorFk,
    { key: 'semiMajorAxis', label: 'Semi-major axis', kind: 'number', step: 0.0001 },
    { key: 'eccentricity', label: 'Eccentricity', kind: 'number', step: 0.0001, min: 0 },
    { key: 'inclination', label: 'Inclination', kind: 'number', step: 0.001 },
    { key: 'argOfPeriapsis', label: 'Arg of periapsis', kind: 'number', step: 0.001 },
    { key: 'ascendingNode', label: 'Ascending node', kind: 'number', step: 0.001 },
    { key: 'meanAnomalyAtEpoch', label: 'Mean anomaly @epoch', kind: 'number', step: 0.001 },
    { key: 'epoch', label: 'Epoch (JD)', kind: 'number', step: 0.5 },
    { key: 'period', label: 'Period (days, 0=auto)', kind: 'number', step: 0.0001, min: 0 }
  ],
  listLabel: (row, ctx) => `#${row.id} → ${ctx.actorName(row.actorId as number)}`,
  defaults: () => ({
    actorId: null,
    semiMajorAxis: 1,
    eccentricity: 0,
    inclination: 0,
    argOfPeriapsis: 0,
    ascendingNode: 0,
    meanAnomalyAtEpoch: 0,
    epoch: 2451545, // J2000
    period: 0
  })
}

export const physicalObjectsSpec: TableSpec = {
  table: 'physicalObjects',
  title: 'Physical',
  fields: [
    idField,
    actorFk,
    // parentId ссылается на ДРУГОЙ physicalObject (задача двух тел: масса родителя
    // нужна KeplerianModel). nullable — у центральных тел родителя нет.
    {
      key: 'parentId',
      label: 'Parent body (physical)',
      kind: 'select-fk',
      references: 'physicalObjects',
      nullable: true,
      excludeSelf: true,
      full: true
    },
    { key: 'mass', label: 'Mass (kg)', kind: 'number', step: 1 },
    { key: 'radius', label: 'Radius', kind: 'number', step: 0.1 },
    { key: 'axialTilt', label: 'Axial tilt', kind: 'number', step: 0.01 },
    { key: 'orbitalPeriod', label: 'Orbital period', kind: 'number', step: 0.0001 },
    { key: 'rotationPeriod', label: 'Rotation period', kind: 'number', step: 0.0001 },
    { key: 'temperature', label: 'Temperature', kind: 'number', step: 1 }
  ],
  listLabel: (row, ctx) => `#${row.id} → ${ctx.actorName(row.actorId as number)}`,
  defaults: () => ({
    actorId: null,
    parentId: null,
    mass: 0,
    radius: 1,
    axialTilt: 0,
    orbitalPeriod: 1,
    rotationPeriod: 1,
    temperature: 0
  })
}

export const rotationObjectsSpec: TableSpec = {
  table: 'rotationObjects',
  title: 'Rotation',
  fields: [
    idField,
    actorFk,
    { key: 'meridianAngle', label: 'Meridian angle', kind: 'number', step: 0.001 },
    { key: 'ascendingNode', label: 'Ascending node', kind: 'number', step: 0.001 },
    { key: 'inclination', label: 'Inclination', kind: 'number', step: 0.001 },
    { key: 'period', label: 'Period', kind: 'number', step: 0.0001 },
    {
      key: 'direction',
      label: 'Direction',
      kind: 'select-enum',
      nullable: true,
      options: [
        { value: '1', label: 'Prograde (+1)' },
        { value: '-1', label: 'Retrograde (−1)' }
      ]
    }
  ],
  listLabel: (row, ctx) => `#${row.id} → ${ctx.actorName(row.actorId as number)}`,
  defaults: () => ({
    actorId: null,
    meridianAngle: 0,
    ascendingNode: 0,
    inclination: 0,
    period: 1,
    direction: 1
  })
}

export const placementsSpec: TableSpec = {
  table: 'placements',
  title: 'Placements',
  fields: [
    idField,
    actorFk,
    { key: 'x', label: 'X', kind: 'number', step: 0.001 },
    { key: 'y', label: 'Y', kind: 'number', step: 0.001 },
    { key: 'z', label: 'Z', kind: 'number', step: 0.001 }
  ],
  listLabel: (row, ctx) => `#${row.id} → ${ctx.actorName(row.actorId as number)}`,
  defaults: () => ({ actorId: null, x: 0, y: 0, z: 0 })
}

/** реестр всех «табличных» спеков по имени таблицы */
export const tableSpecs = {
  orbits: orbitsSpec,
  physicalObjects: physicalObjectsSpec,
  rotationObjects: rotationObjectsSpec,
  placements: placementsSpec
} as const
