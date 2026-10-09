/**
 * Открытые окна в порядке открытия: Escape и обход Tab — только у верхнего,
 * иначе Escape над двумя окнами (туториал поверх настроек) закрыл бы оба.
 *
 * Отдельный модуль, а не TitanModal: панели вне стека окон (карточка объекта)
 * спрашивают, открыто ли окно, а файл компонента для fast refresh экспортирует
 * только компонент.
 */
export const openModals: symbol[] = []

/** Есть ли открытое окно — панели вне стека уступают ему Escape */
export function hasOpenModal(): boolean {
  return openModals.length > 0
}

/** Escape в поле ввода окно не закрывает: в редакторе это стоило бы правки */
export function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false

  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}
