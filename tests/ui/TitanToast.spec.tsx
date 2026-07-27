import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import TitanToast from '@titanui/components/TitanToast'

/**
 * Первый тест React-компонента в проекте, поэтому рендерим напрямую через
 * react-dom/client: @testing-library/react в зависимостях нет, а вводить её
 * ради одного компонента — лишнее.
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(node: ReactNode): void {
  act(() => {
    root.render(node)
  })
}

const toast = (visible: boolean): ReactNode => (
  <TitanToast visible={visible} onClose={() => {}}>
    привет
  </TitanToast>
)

describe('TitanToast — правила хуков', () => {
  it('переключение visible false → true не нарушает инварианты React', () => {
    // Хуки, объявленные после `if (!visible) return null`, вызываются не на
    // каждом рендере. React 19 на этом не падает, но сообщает о сломанном
    // инварианте: «Internal React error: Expected static flag was missing».
    // Отсутствие вывода в console.error — и есть проверяемый признак того,
    // что порядок хуков стабилен между рендерами.
    const errors: string[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]): void => {
      errors.push(String(args[0]))
    })

    try {
      render(toast(false))
      expect(container.textContent).toBe('')

      render(toast(true))
    } finally {
      spy.mockRestore()
    }

    expect(errors).toEqual([])
    expect(container.textContent).toBe('привет')
  })
})

describe('TitanToast — автозакрытие', () => {
  it('невидимый тост не вызывает onClose по таймеру', () => {
    vi.useFakeTimers()
    const onClose = vi.fn()

    try {
      render(
        <TitanToast visible={false} duration={3000} onClose={onClose}>
          привет
        </TitanToast>
      )

      // duration + запас на вложенный таймер скрывающей анимации
      act(() => {
        vi.advanceTimersByTime(3500)
      })
    } finally {
      vi.useRealTimers()
    }

    expect(onClose).not.toHaveBeenCalled()
  })

  it('вызывает актуальный onClose, а не захваченный первым рендером', () => {
    vi.useFakeTimers()
    const stale = vi.fn()
    const fresh = vi.fn()

    try {
      render(
        <TitanToast visible={true} duration={3000} onClose={stale}>
          привет
        </TitanToast>
      )

      // Родитель перерисовался и передал другой обработчик — например, потому
      // что в очереди появилось соседнее уведомление и колбэк пересоздался.
      render(
        <TitanToast visible={true} duration={3000} onClose={fresh}>
          привет
        </TitanToast>
      )

      act(() => {
        vi.advanceTimersByTime(3500)
      })
    } finally {
      vi.useRealTimers()
    }

    expect(stale).not.toHaveBeenCalled()
    expect(fresh).toHaveBeenCalledTimes(1)
  })

  it('показанный заново тост не остаётся в состоянии скрытия', () => {
    vi.useFakeTimers()
    const onClose = vi.fn()

    try {
      render(
        <TitanToast visible={true} duration={3000} onClose={onClose}>
          привет
        </TitanToast>
      )

      // Дожидаемся, пока сработает автоскрытие и выставит класс `hiding`.
      act(() => {
        vi.advanceTimersByTime(3500)
      })

      render(
        <TitanToast visible={false} duration={3000} onClose={onClose}>
          привет
        </TitanToast>
      )
      render(
        <TitanToast visible={true} duration={3000} onClose={onClose}>
          привет
        </TitanToast>
      )
    } finally {
      vi.useRealTimers()
    }

    expect(container.querySelector('.titan-toast')?.className).not.toContain('hiding')
  })

  it('видимый тост вызывает onClose после duration', () => {
    vi.useFakeTimers()
    const onClose = vi.fn()

    try {
      render(
        <TitanToast visible={true} duration={3000} onClose={onClose}>
          привет
        </TitanToast>
      )

      act(() => {
        vi.advanceTimersByTime(3500)
      })
    } finally {
      vi.useRealTimers()
    }

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
