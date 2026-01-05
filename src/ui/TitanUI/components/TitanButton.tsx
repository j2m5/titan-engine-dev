import { FC } from 'react'
import { TitanButtonProps } from '@/ui/TitanUI/types'

const TitanButton: FC<TitanButtonProps> = ({ children, onClick }) => {
  return (
    <button className="titan-button" onClick={onClick}>
      {children}
    </button>
  )
}

export default TitanButton
