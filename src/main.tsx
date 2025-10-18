import './styles/App.scss'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '@/ui/App'
import { Actor } from '@/core/models/Actor'
import { Category } from '@/core/models/Category'
import { PlanetShader } from '@/core/materials/shaders/PlanetShader'
import { PhysicalObject } from '@/core/models/PhysicalObject'
import { Collection } from '@/core/framework/Memoquent/Collection'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

const testActor = Actor.find(34)?.withAll()
console.log('testActor', testActor)

const collection = Actor.withRelations('resources', 'renderingObject', 'children')
console.log(collection)

const testActor2 = Actor.query().where({ categoryId: 7 }).first()
console.log(testActor2)

const testCategory = Category.find(3)
console.log('000000000000', testCategory)

const testCategory2 = Category.query().with('actors').where({ name: 'Galaxy' }).get()
console.log('555555555555', testCategory2)

console.log('=============', Category.all())

const pl = new PlanetShader(testActor!)

console.log(pl.toJSON())

console.log('lastPh', new Collection(PhysicalObject.query().get().toArray()).last())

console.log(PhysicalObject.withRelations())
