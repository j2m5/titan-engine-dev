import { DAY, J2000, UNIX_EPOCH_JULIAN_DATE } from '@/core/constants'

export function getJD(date: Date): number {
  return +date / 1000 / DAY + UNIX_EPOCH_JULIAN_DATE
}

export function getDateFromJD(jd: number) {
  const date: Date = new Date()
  const t: number = (jd - UNIX_EPOCH_JULIAN_DATE) * DAY * 1000
  date.setTime(t)
  return date
}

export function getJ2000SecondsFromJD(jd: number): number {
  return (jd - J2000) * DAY
}
