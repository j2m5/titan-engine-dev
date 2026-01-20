import { FC, useEffect } from 'react'
import { TitanToastProps } from '@/ui/TitanUI/types'

const TitanToast: FC<TitanToastProps> = ({ visible, duration = 3000, onClose, children }) => {
  useEffect(() => {
    if (!visible || !duration) return

    const timer = setTimeout(() => {
      onClose()
    }, duration)

    return () => clearTimeout(timer)
  }, [visible, duration, onClose])

  if (!visible) return null

  return (
    <div className="titan-toast" onClick={onClose}>
      {children}
    </div>
  )
}

export default TitanToast
