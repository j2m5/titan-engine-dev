import { makeAutoObservable } from 'mobx'
import { MenuController } from '@/core/ports/MenuController'

class MenuStore implements MenuController {
  public isOpen: boolean = false
  public menuWidth: number = 240

  public constructor() {
    makeAutoObservable(this)
  }

  public openMenu(): void {
    this.isOpen = true
  }

  public closeMenu(): void {
    this.isOpen = false
  }

  public close(): void {
    this.closeMenu()
  }
}

export const menuStore: MenuStore = new MenuStore()
