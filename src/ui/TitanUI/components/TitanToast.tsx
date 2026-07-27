import { FC, useState, useEffect, useRef } from 'react'
import { TitanToastProps } from '@titanui/types'

const TitanToast: FC<TitanToastProps> = ({ visible, duration = 3000, style = {}, onClose, children }) => {
  const [hiding, setHiding] = useState(false)
  const [shown, setShown] = useState(visible)

  /**
   * Сброс состояния скрытия при повторном показе. Компонент не размонтируется
   * на `visible={false}` — хуки обязаны вызываться на каждом рендере, поэтому
   * ранний возврат стоит ниже них, — и без сброса заново показанный тост
   * появился бы сразу с классом `hiding`. Правка состояния прямо в рендере —
   * штатный приём React для реакции на смену пропса: он отрабатывает до
   * коммита, поэтому кадра с чужим классом не возникает.
   */
  if (visible !== shown) {
    setShown(visible)
    setHiding(false)
  }

  /**
   * Обработчик закрытия держим в ref, а не в зависимостях эффекта. Потребители
   * передают его инлайновой стрелкой, то есть на каждом рендере родителя это
   * новая функция: попади она в зависимости — таймер перезапускался бы,
   * и приход соседнего уведомления продлевал бы жизнь предыдущему тосту.
   */
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!visible || !duration) return

    let hideTimer: ReturnType<typeof setTimeout> | undefined

    const timer = setTimeout(() => {
      setHiding(true)

      hideTimer = setTimeout(() => onCloseRef.current(), 200)
    }, duration)

    // Снимаем оба таймера: вложенный переживал размонтирование и звал onClose
    // у уже удалённого тоста.
    return () => {
      clearTimeout(timer)
      clearTimeout(hideTimer)
    }
  }, [visible, duration])

  if (!visible) return null

  return (
    <div className={`titan-toast ${hiding ? 'hiding' : ''}`} style={style} onClick={onClose}>
      {children}
    </div>
  )
}

export default TitanToast
