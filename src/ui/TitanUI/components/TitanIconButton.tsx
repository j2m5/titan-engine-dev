import { FC } from 'react'
import { formatCssValue as fcv } from '@titanui/utils/helpers'
import { TitanButtonProps } from '@titanui/types'

const TitanIconButton: FC<TitanButtonProps & { disabled?: boolean }> = ({
  children,
  height = 40,
  width = 40,
  disabled = false,
  onClick
}) => {
  return (
    <button
      disabled={disabled}
      className="titan-icon-button"
      style={{ height: fcv(height), width: fcv(width) }}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export default TitanIconButton
