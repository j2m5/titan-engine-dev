import { makeAutoObservable } from 'mobx'

class MenuStore {
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
}

export const menuStore: MenuStore = new MenuStore()
