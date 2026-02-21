/**
 * AtmosphereDebugScene.ts
 *
 * Usage:
 *   new AtmosphereDebugScene(document.getElementById('app')!, 79)
 */

import { WebGLRenderer, Scene, PerspectiveCamera, Mesh, SphereGeometry, Vector3, Color, TextureLoader } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min'

import { Actor } from '@/core/models/Actor'
import { AtmosphereLUTGenerator } from '@/core/renderables/Atmosphere/AtmosphereLUTGenerator'
import { BrunetonAtmosphereMaterial } from '@/core/renderables/Atmosphere/BrunetonAtmosphereMaterial'
import { Storage } from '@/core/framework/file/Storage'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'

const EMPTY = { width: 0, expTerm: 0, expScale: 0, linearTerm: 0, constantTerm: 0 }
const expL = (h: any) => ({ width: 0, expTerm: 1, expScale: -1 / h, linearTerm: 0, constantTerm: 0 })
const getH = (layers: any) => (layers[1].expScale !== 0 ? -1 / layers[1].expScale : 8)

class AtmosphereDebugScene {
  private readonly renderer: WebGLRenderer
  private scene = new Scene()
  private readonly camera: PerspectiveCamera
  private controls: OrbitControls
  private gui: GUI
  private readonly atmoMesh: Mesh
  private readonly mat: BrunetonAtmosphereMaterial
  private gen: AtmosphereLUTGenerator
  private light = new Vector3()
  private readonly p: any
  private timer: any = null
  private raf = 0
  private readonly actor: Actor

  public constructor(container: HTMLElement, actorId: number) {
    this.actor = Actor.find(actorId)!
    const data = this.actor.renderingObject?.getAttribute('data')
    this.scene.background = new Color(0, 0, 0)

    const map = new TextureLoader().load(Storage.url(this.actor.parent!.resources!.first()!.getAttribute('path') || ''))
    const night = new TextureLoader().load(Storage.url('night.jpg'))

    this.renderer = new WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(devicePixelRatio)
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.setClearColor(0x000000)
    container.appendChild(this.renderer.domElement)

    this.camera = new PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.01, 1000)
    this.camera.position.set(0, 0, 55.5)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.minDistance = 1.05
    this.controls.maxDistance = 150

    const plMat = new PlanetMaterial(this.actor.parent!)
    plMat.uniforms.diffuseMap.value = map
    plMat.uniforms.nightMap.value = night
    const planet = new Mesh(
      new SphereGeometry(toThreeJSUnits(this.actor.renderingObject?.getAttribute('data').bottomRadius), 256, 256),
      plMat
    )
    planet.position.set(0, 0, 10)

    this.scene.add(planet)

    this.gen = new AtmosphereLUTGenerator(this.renderer)
    this.mat = new BrunetonAtmosphereMaterial(this.actor)
    this.atmoMesh = new Mesh(
      new SphereGeometry(toThreeJSUnits(this.actor.renderingObject?.getAttribute('data').topRadius), 128, 128),
      this.mat
    )
    planet.add(this.atmoMesh)

    this.controls.target = planet.position.clone()

    this.p = {
      rayleigh_R: data.rayleighScattering[0],
      rayleigh_G: data.rayleighScattering[1],
      rayleigh_B: data.rayleighScattering[2],
      rayleighH: getH(data.rayleighDensity),

      mie_R: data.mieScattering[0],
      mie_G: data.mieScattering[1],
      mie_B: data.mieScattering[2],
      mieExt_R: data.mieExtinction[0],
      mieExt_G: data.mieExtinction[1],
      mieExt_B: data.mieExtinction[2],
      mieG: data.miePhaseFunctionG,
      mieH: getH(data.mieDensity),

      abs_R: data.absorptionExtinction[0],
      abs_G: data.absorptionExtinction[1],
      abs_B: data.absorptionExtinction[2],
      absH: getH(data.absorptionDensity),

      albedo_R: data.groundAlbedo[0],
      albedo_G: data.groundAlbedo[1],
      albedo_B: data.groundAlbedo[2],

      exposure: 10,
      wp_R: 1,
      wp_G: 1,
      wp_B: 1,
      sunLat: 0,
      sunLon: 45,

      _: {
        solarIrradiance: [...data.solarIrradiance],
        sunAngularRadius: data.sunAngularRadius,
        bottomRadius: data.bottomRadius,
        topRadius: data.topRadius,
        muSMin: data.muSMin
      }
    }

    this.rebuild()
    this.gui = new GUI({ title: this.actor.getAttribute('name'), width: 320 })
    this.buildGUI()

    window.addEventListener('resize', () => {
      this.camera.aspect = container.clientWidth / container.clientHeight
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(container.clientWidth, container.clientHeight)
    })

    this.loop()
    console.log(this.scene)
  }

  private cfg() {
    const p = this.p,
      b = p._
    return {
      solarIrradiance: b.solarIrradiance,
      sunAngularRadius: b.sunAngularRadius,
      bottomRadius: b.bottomRadius,
      topRadius: b.topRadius,
      rayleighDensity: [EMPTY, expL(p.rayleighH)],
      rayleighScattering: [p.rayleigh_R, p.rayleigh_G, p.rayleigh_B],
      mieDensity: [EMPTY, expL(p.mieH)],
      mieScattering: [p.mie_R, p.mie_G, p.mie_B],
      mieExtinction: [p.mieExt_R, p.mieExt_G, p.mieExt_B],
      miePhaseFunctionG: p.mieG,
      absorptionDensity: [EMPTY, expL(p.absH)],
      absorptionExtinction: [p.abs_R, p.abs_G, p.abs_B],
      groundAlbedo: [p.albedo_R, p.albedo_G, p.albedo_B],
      muSMin: b.muSMin
    }
  }

  private rebuild() {
    const c = this.cfg()
    this.mat.setAtmosphereConfig(c as any)
    this.mat.bindLUTTextures(this.gen.generate(c as any))
    this.mat.exposure = this.p.exposure
    this.mat.setWhitePoint(this.p.wp_R, this.p.wp_G, this.p.wp_B)
    this.atmoMesh.geometry.dispose()
  }

  private regen = () => {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.rebuild(), 120)
  }

  private vis = () => {
    this.mat.exposure = this.p.exposure
    this.mat.setWhitePoint(this.p.wp_R, this.p.wp_G, this.p.wp_B)
  }

  private buildGUI() {
    const p = this.p,
      r = this.regen,
      v = this.vis

    const ray = this.gui.addFolder('Rayleigh')
    ray.add(p, 'rayleigh_R', 0, 0.15, 0.0001).name('R').onChange(r)
    ray.add(p, 'rayleigh_G', 0, 0.15, 0.0001).name('G').onChange(r)
    ray.add(p, 'rayleigh_B', 0, 0.15, 0.0001).name('B').onChange(r)
    ray.add(p, 'rayleighH', 1, 100, 0.1).name('Scale H').onChange(r)

    const mie = this.gui.addFolder('Mie')
    mie.add(p, 'mie_R', 0, 0.1, 0.00001).name('Scat R').onChange(r)
    mie.add(p, 'mie_G', 0, 0.1, 0.00001).name('Scat G').onChange(r)
    mie.add(p, 'mie_B', 0, 0.1, 0.00001).name('Scat B').onChange(r)
    mie.add(p, 'mieExt_R', 0, 0.1, 0.00001).name('Ext R').onChange(r)
    mie.add(p, 'mieExt_G', 0, 0.1, 0.00001).name('Ext G').onChange(r)
    mie.add(p, 'mieExt_B', 0, 0.1, 0.00001).name('Ext B').onChange(r)
    mie.add(p, 'mieG', 0, 0.999, 0.001).name('Phase G').onChange(r)
    mie.add(p, 'mieH', 0.5, 100, 0.1).name('Scale H').onChange(r)
    mie.close()

    const abs = this.gui.addFolder('Absorption')
    abs.add(p, 'abs_R', 0, 0.02, 0.00001).name('R').onChange(r)
    abs.add(p, 'abs_G', 0, 0.02, 0.00001).name('G').onChange(r)
    abs.add(p, 'abs_B', 0, 0.02, 0.00001).name('B').onChange(r)
    abs.add(p, 'absH', 1, 100, 0.1).name('Scale H').onChange(r)
    abs.close()

    const alb = this.gui.addFolder('Albedo')
    alb.add(p, 'albedo_R', 0, 1, 0.01).name('R').onChange(r)
    alb.add(p, 'albedo_G', 0, 1, 0.01).name('G').onChange(r)
    alb.add(p, 'albedo_B', 0, 1, 0.01).name('B').onChange(r)
    alb.close()

    const sun = this.gui.addFolder('Sun')
    sun.add(p, 'sunLat', -90, 90, 1).name('Lat')
    sun.add(p, 'sunLon', -180, 180, 1).name('Lon')
    sun.close()

    const ren = this.gui.addFolder('Render')
    ren.add(p, 'exposure', 0.1, 50, 0.1).name('Exposure').onChange(v)
    ren.add(p, 'wp_R', 0.5, 2, 0.01).name('WP R').onChange(v)
    ren.add(p, 'wp_G', 0.5, 2, 0.01).name('WP G').onChange(v)
    ren.add(p, 'wp_B', 0.5, 2, 0.01).name('WP B').onChange(v)

    this.gui
      .add(
        {
          copy: () => {
            const txt = JSON.stringify(this.cfg(), null, 2)
            navigator.clipboard
              ?.writeText(txt)
              .then(() => alert('Copied!'))
              .catch(() => {
                console.log(txt)
                alert('See console')
              })
          }
        },
        'copy'
      )
      .name('📋 Copy')
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop)
    this.controls.update()
    this.light.set(0, 0, 0)
    this.mat.update(this.atmoMesh, this.camera, this.light)
    this.renderer.render(this.scene, this.camera)
  }

  public dispose() {
    cancelAnimationFrame(this.raf)
    this.gui.destroy()
    this.controls.dispose()
    this.gen.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}

export { AtmosphereDebugScene }
