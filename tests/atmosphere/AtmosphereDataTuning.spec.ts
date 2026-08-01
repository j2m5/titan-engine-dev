import { RenderingObjects } from '@storage/database'

type TunedData = { exposure?: number; hdrKnee?: number }

function dataOf(id: number): TunedData {
  const row = RenderingObjects.find((r: { id: number }) => r.id === id)
  expect(row).toBeDefined()
  return (row as unknown as { data: TunedData }).data
}

describe('Калибровка пересвета атмосфер (спека 2026-07-31, перекалибровка H4 2026-08-01)', () => {
  it('Венера (id 13) погашена сильнее всех: exposure 1.5, hdrKnee 0.1', () => {
    expect(dataOf(13).exposure).toBe(1.5)
    expect(dataOf(13).hdrKnee).toBe(0.1)
  })

  it('Марс/Юпитер/Сатурн/Уран/Нептун: все планеты приёмки H4 перекалиброваны под покомпонентную композицию', () => {
    expect(dataOf(15)).toMatchObject({ exposure: 2.2, hdrKnee: 0.35 })
    expect(dataOf(16)).toMatchObject({ exposure: 1, hdrKnee: 0.3 })
    expect(dataOf(17)).toMatchObject({ exposure: 1.5, hdrKnee: 0.3 })
    expect(dataOf(18)).toMatchObject({ exposure: 1.8, hdrKnee: 0.3 })
    expect(dataOf(19)).toMatchObject({ exposure: 1.7, hdrKnee: 0.3 })
  })

  it('Земля (id 14): exposure появился при переходе на покомпонентную композицию (H4), hdrKnee по-прежнему дефолтный', () => {
    expect(dataOf(14).exposure).toBe(1.4)
    expect(dataOf(14).hdrKnee).toBeUndefined()
  })
})
