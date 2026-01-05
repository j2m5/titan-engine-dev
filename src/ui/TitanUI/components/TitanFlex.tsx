import { FC } from 'react'
import { formatCssValue as fcv } from '@/ui/TitanUI/utils/helpers'
import { TitanFlexProps } from '@/ui/TitanUI/types'

const TitanFlex: FC<TitanFlexProps> = ({
  children,
  align = 'start',
  justify = 'start',
  height = 'auto',
  width = 'auto',
  style = {}
}) => {
  return (
    <div
      className={`titan-flex align-${align} justify-${justify}`}
      style={{ ...style, height: fcv(height), width: fcv(width) }}
    >
      {children}
    </div>
  )
}

export default TitanFlex
