import { FC } from 'react'
import { TitanListItemProps } from '@/ui/TitanUI/types'

const TitanListItem: FC<TitanListItemProps> = ({ children, icon }) => {
  return (
    <>
      <div className="titan-list-item">
        {icon} {children}
      </div>
    </>
  )
}

export default TitanListItem
