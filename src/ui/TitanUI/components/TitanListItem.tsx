import { FC } from 'react'
import { TitanListItemProps } from '@/ui/TitanUI/types'

const TitanListItem: FC<TitanListItemProps> = ({ children, icon, style = {} }) => {
  return (
    <>
      <div className="titan-list-item" style={style}>
        {icon} {children}
      </div>
    </>
  )
}

export default TitanListItem
