import { FC, useState, useEffect } from 'react'
import { TitanToastProps } from '@/ui/TitanUI/types'

const TitanToast: FC<TitanToastProps> = ({ visible, duration = 3000, style = {}, onClose, children }) => {
  if (!visible) return null

  const [hiding, setHiding] = useState(false)

  useEffect(() => {
    if (!duration) return

    const timer = setTimeout(() => {
      setHiding(true)

      setTimeout(onClose, 200)
    }, duration)

    return () => clearTimeout(timer)
  }, [])

  return (
    <div className={`titan-toast ${hiding ? 'hiding' : ''}`} style={style} onClick={onClose}>
      {children}
    </div>
  )
}

export default TitanToast
