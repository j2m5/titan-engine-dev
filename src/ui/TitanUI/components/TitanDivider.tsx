import { FC } from 'react'
import { TitanDividerProps } from '@/ui/TitanUI/types'

const TitanDivider: FC<TitanDividerProps> = ({ offsetTop = 12, offsetBottom = 12 }) => {
  return <div className="titan-divider" style={{ marginTop: offsetTop, marginBottom: offsetBottom }} />
}

export default TitanDivider
