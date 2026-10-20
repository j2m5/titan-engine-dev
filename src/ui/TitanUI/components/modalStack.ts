import { isEditableTarget } from '@/core/helpers/isEditableTarget'

/**
 * Открытые окна в порядке открытия: Escape и обход Tab — только у верхнего,
 * иначе Escape над двумя окнами (туториал поверх настроек) закрыл бы оба.
 *
 * Отдельный модуль, а не TitanModal: панели вне стека окон (карточка объекта)
 * спрашивают, открыто ли окно, а файл компонента для fast refresh экспортирует
 * только компонент.
 */
export const openModals: symbol[] = []

const modalElements = new Map<symbol, HTMLElement>()

/** Visual layers follow the same order as keyboard handling, even after a background modal closes. */
function updateModalLayers(): void {
  openModals.forEach((id, index) => {
    const element = modalElements.get(id)

    if (element) element.style.zIndex = String(1000000 + index)
  })
}

export function registerModal(id: symbol, element: HTMLElement): void {
  modalElements.set(id, element)
  openModals.push(id)
  updateModalLayers()
}

export function unregisterModal(id: symbol): void {
  const index = openModals.indexOf(id)

  if (index !== -1) openModals.splice(index, 1)
  modalElements.delete(id)
  updateModalLayers()
}

export function topModalElement(): HTMLElement | undefined {
  return modalElements.get(openModals[openModals.length - 1])
}

/** Есть ли открытое окно — панели вне стека уступают ему Escape */
export function hasOpenModal(): boolean {
  return openModals.length > 0
}

/** Escape в поле ввода окно не закрывает: в редакторе это стоило бы правки */
export function isEditable(target: EventTarget | null): boolean {
  return isEditableTarget(target)
}
