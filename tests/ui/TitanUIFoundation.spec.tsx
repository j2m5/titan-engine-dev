import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import TitanButton from '@titanui/components/TitanButton'
import TitanIconButton from '@titanui/components/TitanIconButton'
import TitanTabs from '@titanui/components/TitanTabs'
import TitanFlex from '@titanui/components/TitanFlex'
import TitanContainer from '@titanui/components/TitanContainer'
import { sliderFill } from '@titanui/utils/helpers'

describe('кнопки TitanUI не отправляют форму', () => {
  it('TitanButton — type="button"', () => {
    expect(renderToStaticMarkup(<TitanButton onClick={() => {}}>Run</TitanButton>)).toContain('type="button"')
  })

  it('TitanIconButton — type="button"', () => {
    expect(renderToStaticMarkup(<TitanIconButton onClick={() => {}}>x</TitanIconButton>)).toContain('type="button"')
  })

  it('табы — type="button"', () => {
    const markup = renderToStaticMarkup(<TitanTabs tabs={[{ key: 'a', label: 'A' }]} active="a" onChange={() => {}} />)

    expect(markup).toContain('type="button"')
  })
})

describe('TitanButton передаёт disabled', () => {
  it('disabled доходит до <button>', () => {
    expect(renderToStaticMarkup(<TitanButton disabled onClick={() => {}}>Save</TitanButton>)).toContain('disabled=""')
  })

  it('без disabled атрибута нет', () => {
    expect(renderToStaticMarkup(<TitanButton onClick={() => {}}>Save</TitanButton>)).not.toContain('disabled')
  })
})

describe('размеры из style не затираются', () => {
  it('TitanFlex: style.width остаётся, пока width не передан пропом', () => {
    expect(renderToStaticMarkup(<TitanFlex style={{ width: 300 }}>x</TitanFlex>)).toContain('width:300px')
  })

  it('TitanFlex: проп width побеждает style.width', () => {
    const markup = renderToStaticMarkup(
      <TitanFlex width="100%" style={{ width: 300 }}>
        x
      </TitanFlex>
    )

    expect(markup).toContain('width:100%')
    expect(markup).not.toContain('width:300px')
  })

  it('TitanContainer: style.height остаётся, пока height не передан пропом', () => {
    expect(renderToStaticMarkup(<TitanContainer style={{ height: 120 }}>x</TitanContainer>)).toContain('height:120px')
  })

  it('без размеров инлайн не навязывает width/height: auto', () => {
    const markup = renderToStaticMarkup(<TitanFlex>x</TitanFlex>)

    expect(markup).not.toContain('width:auto')
    expect(markup).not.toContain('height:auto')
  })
})

describe('sliderFill — заливка слайдера', () => {
  it('доля значения и буфера в процентах', () => {
    expect(sliderFill(25, 0, 100, 50)).toEqual({ percent: 25, bufferPercent: 50 })
  })

  it('max == min — 0%, а не NaN', () => {
    expect(sliderFill(5, 5, 5, 5)).toEqual({ percent: 0, bufferPercent: 0 })
  })

  it('значение за пределами — зажато в 0–100', () => {
    expect(sliderFill(150, 0, 100, 0).percent).toBe(100)
    expect(sliderFill(-10, 0, 100, 0).percent).toBe(0)
  })

  it('буфер меньше значения не идёт назад — сегмент буфера нулевой длины', () => {
    const fill = sliderFill(60, 0, 100, 20)

    expect(fill.bufferPercent).toBe(fill.percent)
  })

  it('отрицательный min (буфер по умолчанию 0) — буфер не уходит назад', () => {
    const fill = sliderFill(0, -1, 1, 0)

    expect(fill.percent).toBe(50)
    expect(fill.bufferPercent).toBe(50)
  })
})
