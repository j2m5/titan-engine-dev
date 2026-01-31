import { FC } from 'react'
import { TitanListItemProps } from '@/ui/TitanUI/types'

const TitanListItem: FC<TitanListItemProps> = ({ children, icon, style = {}, onClick }) => {
  return (
    <>
      <div className="titan-list-item" style={style} onClick={onClick}>
        {icon} {children}
      </div>
    </>
  )
}

export default TitanListItem
