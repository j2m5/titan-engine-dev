import { FC, useEffect, useState } from 'react'
import { IActor, ICategory } from '@/core/models/types'
import TitanInput from '@titanui/components/TitanInput'
import TitanTextarea from '@titanui/components/TitanTextarea'
import TitanSelect from '@titanui/components/TitanSelect'
import TitanButton from '@titanui/components/TitanButton'
import TitanFlex from '@titanui/components/TitanFlex'
import { TitanSelectOption } from '@titanui/types'

export interface ActorFormProps {
  actor: IActor | null
  actors: IActor[]
  categories: ICategory[]
  onChange(actor: IActor): void
  onDelete(): void
}

const ActorForm: FC<ActorFormProps> = ({ actor, actors, categories, onChange, onDelete }) => {
  // локальное зеркало полей
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState('#ffffff')
  const [categoryId, setCategoryId] = useState('')
  const [parentId, setParentId] = useState('')

  // синхронизация при смене выбранного актора
  useEffect(() => {
    if (!actor) return
    setName(actor.name)
    setDescription(actor.description)
    setColor(actor.color || '#ffffff')
    setCategoryId(String(actor.categoryId))
    setParentId(actor.parentId === null ? '' : String(actor.parentId))
  }, [actor])

  if (!actor) {
    return <div style={{ color: '#888', padding: '20px' }}>Select an actor or create a new one.</div>
  }

  // любое изменение собирает свежий IActor и поднимает наверх
  const emit = (patch: Partial<IActor>): void => {
    const updated: IActor = {
      id: actor.id,
      // @ts-ignore
      categoryId: patch.categoryId ?? (isNaN(Number(categoryId)) ? categoryId : Number(categoryId)),
      parentId: patch.parentId !== undefined ? patch.parentId : parentId === '' ? null : Number(parentId),
      name: patch.name ?? name,
      description: patch.description ?? description,
      color: patch.color ?? color
    }
    onChange(updated)
  }

  const categoryOptions: TitanSelectOption[] = categories.map((c) => ({
    value: String(c.id),
    label: `${c.name} (${c.id})`
  }))

  // parent — любой актор, кроме самого себя (защита от parentId === id)
  const parentOptions: TitanSelectOption[] = actors
    .filter((a) => a.id !== actor.id)
    .map((a) => ({ value: String(a.id), label: `${a.name} (${a.id})` }))

  return (
    <div>
      <div className="titan-form-grid">
        <TitanInput label="ID" value={actor.id} disabled onChange={() => {}} />

        <TitanInput
          label="Color"
          type="color"
          value={color}
          onChange={(v) => {
            setColor(v)
            emit({ color: v })
          }}
        />

        <TitanInput
          label="Name"
          value={name}
          invalid={name.trim() === ''}
          onChange={(v) => {
            setName(v)
            emit({ name: v })
          }}
          style={{ gridColumn: '1 / -1' }}
        />

        <TitanTextarea
          label="Description"
          value={description}
          placeholder="Short info about the object"
          onChange={(v) => {
            setDescription(v)
            emit({ description: v })
          }}
          style={{ gridColumn: '1 / -1' }}
        />

        <TitanSelect
          label="Category"
          value={categoryId}
          options={categoryOptions}
          invalid={categoryId === ''}
          onChange={(v) => {
            setCategoryId(v)
            emit({ categoryId: Number(v) })
          }}
        />

        <TitanSelect
          label="Parent"
          value={parentId}
          placeholder="— none (root) —"
          options={parentOptions}
          onChange={(v) => {
            setParentId(v)
            emit({ parentId: v === '' ? null : Number(v) })
          }}
        />
      </div>

      <div style={{ height: '14px' }} />

      <TitanFlex justify="end">
        <TitanButton onClick={onDelete}>Delete</TitanButton>
      </TitanFlex>
    </div>
  )
}

export default ActorForm
