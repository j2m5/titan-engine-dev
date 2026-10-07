import { FC } from 'react'
import { TitanButtonProps } from '@titanui/types'

// type="button": внутри формы кнопка не отправляет её
const TitanButton: FC<TitanButtonProps> = ({ children, disabled = false, onClick }) => {
  return (
    <button type="button" className="titan-button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  )
}

export default TitanButton
