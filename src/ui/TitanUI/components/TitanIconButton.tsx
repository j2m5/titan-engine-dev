import { FC } from 'react'
import { formatCssValue as fcv } from '@/ui/TitanUI/utils/helpers'
import { TitanButtonProps } from '@/ui/TitanUI/types'

const TitanIconButton: FC<TitanButtonProps> = ({ children, height = 40, width = 40, onClick }) => {
  return (
    <button className="titan-icon-button" style={{ height: fcv(height), width: fcv(width) }} onClick={onClick}>
      {children}
    </button>
  )
}

export default TitanIconButton
