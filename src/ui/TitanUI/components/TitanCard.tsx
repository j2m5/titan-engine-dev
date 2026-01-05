import { FC } from 'react'
import { TitanCardProps } from '@/ui/TitanUI/types'
import TitanContainer from '@/ui/TitanUI/components/TitanContainer'
import TitanDivider from '@/ui/TitanUI/components/TitanDivider'

const TitanCard: FC<TitanCardProps> = ({ header, content, footer, media = null }) => {
  return (
    <TitanContainer>
      <div className="titan-card">
        <div className="titan-card-header">{header}</div>
        <TitanDivider />
        <div className="titan-card-content">
          {media}
          {content}
        </div>
        <TitanDivider />
        <div className="titan-card-footer">{footer}</div>
      </div>
    </TitanContainer>
  )
}

export default TitanCard
