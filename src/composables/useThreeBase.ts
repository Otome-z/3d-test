// src/composables/useThreeBase.ts
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls'

export type ThreeBase = {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  orbit: OrbitControls
  transform: TransformControls
  raycaster: THREE.Raycaster
  mouse: THREE.Vector2
  getRect: () => DOMRect
  updateMouseFromEvent: (ev: PointerEvent) => void
  start: () => void
  stop: () => void
  dispose: () => void
}

export function createThreeBase(canvas: HTMLCanvasElement): ThreeBase {
  const scene = new THREE.Scene()

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000) // 视角(fov)=45°，宽高比(aspect)=1，近裁剪面(near)=0.1，远裁剪面(far)=5000
  camera.position.set(400, 400, 400)

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)) // 设置像素比例

  const orbit = new OrbitControls(camera, renderer.domElement)
  orbit.enableDamping = true

  const transform = new TransformControls(camera, renderer.domElement)
  scene.add(transform)

  const raycaster = new THREE.Raycaster()
  const mouse = new THREE.Vector2()

  const getRect = () => canvas.getBoundingClientRect()

  const updateMouseFromEvent = (ev: PointerEvent) => {
    const rect = getRect()
    mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1
    mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1
  }

  // helpers（可删）
  const axes: any = new THREE.AxesHelper(300) // 坐标轴长度(size)=300
  axes.raycast = () => { }
  scene.add(axes)
  const grid: any = new THREE.GridHelper(800, 20) // 网格尺寸(size)=800，分割数(divisions)=20
  grid.raycast = () => { }
  scene.add(grid)

  // resize：当 canvas 的“显示尺寸”(CSS 像素) 或 DPR 变化时，同步更新 WebGL 实际绘制缓冲区大小与相机宽高比
  // - 目的：避免窗口/容器尺寸变化后画面被拉伸；同时在高分屏下避免模糊（用 DPR 提升实际像素）
  const resizeRendererToDisplaySize = () => {
    const rect = getRect() // canvas 在页面上的实际显示尺寸（CSS 像素）
    const dpr = Math.min(window.devicePixelRatio || 1, 2) // 设备像素比（限制最大 2，兼顾清晰度与性能）
    const width = Math.max(1, Math.floor(rect.width)) // 视口宽（CSS 像素）
    const height = Math.max(1, Math.floor(rect.height)) // 视口高（CSS 像素）

    // canvas.width/height 是 WebGL 绘制缓冲区尺寸（设备像素）；若与当前显示尺寸*dpr 不一致则需要 resize
    const needResize =
      canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)

    if (needResize) {
      renderer.setPixelRatio(dpr) // 让 renderer 以 dpr 计算绘制缓冲区大小
      renderer.setSize(width, height, false) // 设置绘制尺寸；false 表示不改动 canvas 的 style（CSS 尺寸）
      camera.aspect = width / height // 同步相机宽高比，避免画面拉伸
      camera.updateProjectionMatrix() // 应用新的投影矩阵
    }
  }

  let raf = 0
  const loop = () => {
    // 主渲染循环：每一帧都做一次「尺寸同步 + 控制器更新 + 渲染」
    // - requestAnimationFrame：浏览器按刷新率回调，适合动画/实时渲染，并且在后台页会自动降频/暂停以省电
    raf = requestAnimationFrame(loop) // 记录句柄，便于 stop() 里取消循环
    resizeRendererToDisplaySize() // 若 canvas 显示尺寸/DPR 变了就更新 renderer 与相机宽高比
    orbit.update() // 更新 OrbitControls（例如 enableDamping 时需要每帧推进）
    renderer.render(scene, camera) // 用当前相机视角渲染场景到 canvas
  }

  // orbit/transform 冲突处理
  transform.addEventListener('dragging-changed', (e: any) => {
    orbit.enabled = !e.value
  })

  const start = () => loop()
  const stop = () => cancelAnimationFrame(raf)

  const dispose = () => {
    stop()
    renderer.dispose()
  }

  return {
    scene,
    camera,
    renderer,
    orbit,
    transform,
    raycaster,
    mouse,
    getRect,
    updateMouseFromEvent,
    start,
    stop,
    dispose
  }
}
