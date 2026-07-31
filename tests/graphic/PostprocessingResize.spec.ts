import { Postprocessing } from '@/core/graphic/Postprocessing'

describe('Postprocessing: ресайз композера', () => {
  it('setSize делегирует в composer.setSize — буферы пассов следуют за окном', () => {
    const pp = new Postprocessing(null as never, null as never, null as never)
    const setSize = vi.fn()
    pp.composer = { setSize } as never

    pp.setSize(800, 600)

    expect(setSize).toHaveBeenCalledWith(800, 600)
  })

  it('setSize до initialize (композер null) не падает', () => {
    const pp = new Postprocessing(null as never, null as never, null as never)

    expect(() => pp.setSize(800, 600)).not.toThrow()
  })
})
