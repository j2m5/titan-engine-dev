import { FC } from 'react'
import { TitanLabelProps } from '@titanui/types'

const TitanLabel: FC<TitanLabelProps> = ({ children, size = 12 }) => {
  return (
    <div className="titan-label" style={{ fontSize: size }}>
      {children}
    </div>
  )
}

export default TitanLabel
