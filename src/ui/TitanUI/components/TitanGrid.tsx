import { FC } from 'react'
import { TitanGridProps } from '@titanui/types'

const TitanGrid: FC<TitanGridProps> = ({ children, min = 200, gap = 12 }) => {
  return (
    <div className="titan-grid" style={{ gridTemplateColumns: `repeat(auto-fill, ${min}px)`, gap, margin: '0 10px' }}>
      {children}
    </div>
  )
}

export default TitanGrid
