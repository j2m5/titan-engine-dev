import { FC } from 'react'
import { TitanContainerProps } from '@/ui/TitanUI/types'
import { formatCssValue as fcv } from '@/ui/TitanUI/utils/helpers'

const TitanContainer: FC<TitanContainerProps> = ({ children, height = 'auto', width = 'auto', style = {} }) => {
  return (
    <div className="titan-container" style={{ ...style, height: fcv(height), width: fcv(width) }}>
      <span className="corner tl"></span>
      <span className="corner tr"></span>
      <span className="corner bl"></span>
      <span className="corner br"></span>
      {children}
    </div>
  )
}

export default TitanContainer
