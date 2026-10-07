import { FC, useEffect, useRef } from 'react'
import { TitanModalProps } from '@titanui/types'
import TitanContainer from '@titanui/components/TitanContainer'
import TitanDivider from '@titanui/components/TitanDivider'

/**
 * Открытые окна в порядке открытия: Escape и обход Tab — только у верхнего,
 * иначе Escape над двумя окнами (туториал поверх настроек) закрыл бы оба.
 */
const openModals: symbol[] = []

const FOCUSABLE: string =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Элементы для обхода Tab — без скрытых через display/visibility (скрытый input файла плеера) */
function focusablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element: HTMLElement): boolean => {
    const style: CSSStyleDeclaration = getComputedStyle(element)

    return style.display !== 'none' && style.visibility !== 'hidden'
  })
}

/** Escape в поле ввода окно не закрывает: в редакторе это стоило бы правки */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false

  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

const TitanModal: FC<TitanModalProps> = ({
  children,
  visible,
  title,
  actions,
  keepMounted = false,
  height = 'auto',
  width = 'auto',
  className = '',
  dimScene = false,
  onClose
}) => {
  const rootRef = useRef<HTMLDivElement>(null)

  // Обработчик закрытия — в ref: вызывающие передают инлайновую стрелку, и в
  // зависимостях эффекта она перезапускала бы его на каждом рендере родителя
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  })

  /**
   * Пока окно открыто: фокус внутри окна, Tab ходит по кругу, Escape закрывает
   * верхнее окно. После закрытия фокус возвращается туда, откуда окно открыли
   * (кнопка верхней панели).
   */
  useEffect(() => {
    if (!visible) return

    const id: symbol = Symbol('titan-modal')
    const opener: Element | null = document.activeElement

    openModals.push(id)
    rootRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent): void => {
      const root: HTMLDivElement | null = rootRef.current

      if (!root || openModals[openModals.length - 1] !== id) return

      if (event.key === 'Escape') {
        if (isEditable(event.target) || !onCloseRef.current) return

        event.preventDefault()
        onCloseRef.current()

        return
      }

      if (event.key !== 'Tab') return

      const focusables: HTMLElement[] = focusablesIn(root)

      if (!focusables.length) return

      const first: HTMLElement = focusables[0]
      const last: HTMLElement = focusables[focusables.length - 1]
      const active: Element | null = document.activeElement
      const outside: boolean = !root.contains(active) || active === root

      if (event.shiftKey && (active === first || outside)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || outside)) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)

    return (): void => {
      document.removeEventListener('keydown', onKeyDown)
      openModals.splice(openModals.indexOf(id), 1)

      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [visible])

  if (!keepMounted && !visible) return null

  return (
    <>
      {dimScene && visible && <div className="titan-scene-dim" />}
      <div
        ref={rootRef}
        tabIndex={-1}
        role="dialog"
        aria-modal={visible}
        aria-label={title}
        className={`titan-modal ${visible ? 'open' : 'closed'} ${className}`}
      >
        <TitanContainer width={width} height={height}>
          {title && (
            <>
              <div className="titan-modal-header">{title}</div>
              <TitanDivider />
            </>
          )}

          <div className="titan-modal-content">{children}</div>

          {actions && (
            <>
              <TitanDivider />
              <div className="titan-modal-actions">{actions}</div>
            </>
          )}
        </TitanContainer>
      </div>
    </>
  )
}

export default TitanModal
