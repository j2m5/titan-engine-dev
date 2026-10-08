import { FC, useEffect } from 'react'
import { observer } from 'mobx-react-lite'
import { XIcon } from '@phosphor-icons/react'
import TitanCard from '@titanui/components/TitanCard'
import TitanFlex from '@titanui/components/TitanFlex'
import TitanIconButton from '@titanui/components/TitanIconButton'
import { hasOpenModal, isEditable } from '@titanui/components/modalStack'
import { bodyInfoStore } from '@/ui/mobx/BodyInfoStore'
import type { BodyLive, BodyReference, RelativeValue } from '@/core/bodyInfo/types'
import {
  formatAngle,
  formatDistanceKm,
  formatNumber,
  formatOrbitalPeriod,
  formatRotationPeriod,
  formatSemiMajorAxis,
  formatWithUnit
} from '@/ui/components/common/bodyInfo/formatQuantity'

interface Row {
  label: string
  value: string
}

function withRelative(absolute: string, relative: RelativeValue | null): string {
  return relative ? `${absolute} (${formatWithUnit(relative.value, relative.unit)})` : absolute
}

/** Справка: только поля с осмысленным значением, пустые блоки не рисуются */
function referenceRows(reference: BodyReference): Row[] {
  const rows: Row[] = []
  const physics = reference.physics
  const rotation = reference.rotation
  const orbit = reference.orbit

  if (physics) {
    rows.push({ label: 'Mass', value: withRelative(formatWithUnit(physics.massKg, 'kg'), physics.relativeMass) })
    rows.push({ label: 'Radius', value: withRelative(formatWithUnit(physics.radiusKm, 'km'), physics.relativeRadius) })
    if (physics.densityGcm3 !== null)
      rows.push({ label: 'Mean density', value: formatWithUnit(physics.densityGcm3, 'g/cm³') })
    if (physics.gravityMs2 !== null)
      rows.push({ label: 'Surface gravity', value: formatWithUnit(physics.gravityMs2, 'm/s²') })
    if (physics.escapeKms !== null)
      rows.push({ label: 'Escape velocity', value: formatWithUnit(physics.escapeKms, 'km/s') })
    if (physics.schwarzschildKm !== null) {
      rows.push({ label: 'Schwarzschild radius', value: formatWithUnit(physics.schwarzschildKm, 'km') })
    }
    if (physics.temperatureK !== null)
      rows.push({ label: 'Temperature', value: formatWithUnit(physics.temperatureK, 'K') })
    if (physics.luminositySun !== null)
      rows.push({ label: 'Luminosity', value: formatWithUnit(physics.luminositySun, 'L☉') })
  }

  if (rotation) {
    const period: string = formatRotationPeriod(rotation.periodHours)

    rows.push({ label: 'Rotation period', value: rotation.retrograde ? `${period}, retrograde` : period })
    rows.push({ label: 'Axial tilt', value: formatAngle(rotation.axialTiltDeg) })
  }

  if (orbit) {
    rows.push({ label: 'Semi-major axis', value: formatSemiMajorAxis(orbit.semiMajorAxisAu) })
    rows.push({ label: 'Eccentricity', value: formatNumber(orbit.eccentricity) })
    rows.push({ label: 'Inclination', value: formatAngle(orbit.inclinationDeg) })
    if (orbit.periodDays !== null) rows.push({ label: 'Orbital period', value: formatOrbitalPeriod(orbit.periodDays) })
  }

  return rows
}

/** Живой блок: тело пропало из сцены (смена сценария посреди опроса) — прочерк */
function liveRows(live: BodyLive | null, primaryName: string | null): Row[] {
  if (!live) return [{ label: 'Distance', value: '—' }]

  const rows: Row[] = [{ label: 'Distance', value: formatDistanceKm(live.distanceKm) }]

  if (live.starDistanceKm !== null)
    rows.push({ label: 'Distance to star', value: formatDistanceKm(live.starDistanceKm) })
  if (live.orbitalSpeedKms !== null && primaryName !== null) {
    rows.push({ label: `Orbital speed (rel. to ${primaryName})`, value: formatWithUnit(live.orbitalSpeedKms, 'km/s') })
  }

  return rows
}

const Rows: FC<{ rows: Row[] }> = ({ rows }) => (
  <>
    {rows.map((row: Row) => (
      <TitanFlex key={row.label} justify="between" style={{ gap: '12px', fontSize: '13px' }}>
        <span style={{ opacity: 0.7 }}>{row.label}</span>
        <span style={{ textAlign: 'right' }}>{row.value}</span>
      </TitanFlex>
    ))}
  </>
)

/**
 * Карточка объекта у левого края, зеркально списку справа. Открывается только
 * кнопкой ⓘ в списке: 3D главное, интерфейс не шумит. Escape уступает окнам
 * (настройки, туториал) и полям ввода.
 */
const BodyInfoPanel = observer(() => {
  const { reference, live } = bodyInfoStore
  const open: boolean = reference !== null

  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || hasOpenModal() || isEditable(event.target)) return

      bodyInfoStore.close()
    }

    document.addEventListener('keydown', onKeyDown)

    return (): void => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  if (!reference) return null

  const subtitle: string = reference.primaryName
    ? `${reference.typeLabel} · Orbits ${reference.primaryName}`
    : reference.typeLabel

  const header = (
    <TitanFlex align="center" justify="between" width="100%">
      <div>
        <div>{reference.name}</div>
        <div style={{ fontSize: '12px', opacity: 0.7 }}>{subtitle}</div>
      </div>
      <TitanIconButton
        title="Close"
        ariaLabel="Close object info"
        height="auto"
        width="auto"
        onClick={() => bodyInfoStore.close()}
      >
        <XIcon size={18} />
      </TitanIconButton>
    </TitanFlex>
  )

  const footer = (
    <div style={{ width: '100%' }}>
      <div style={{ fontSize: '12px', opacity: 0.7 }}>Now</div>
      <Rows rows={liveRows(live, reference.primaryName)} />
    </div>
  )

  return (
    <div
      style={{
        position: 'fixed',
        left: '10px',
        top: '80px',
        width: '280px',
        maxHeight: 'calc(100vh - 100px)',
        overflowY: 'auto',
        zIndex: 9999
      }}
    >
      <TitanCard header={header} content={<Rows rows={referenceRows(reference)} />} footer={footer} />
    </div>
  )
})

export default BodyInfoPanel
