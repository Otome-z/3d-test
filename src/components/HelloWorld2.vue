<script setup lang="ts">
import { ref, onMounted } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls'

const canvasRef = ref<HTMLCanvasElement | null>(null)
const selectionBox = ref<HTMLDivElement | null>(null)

let transform: TransformControls
let camera: THREE.PerspectiveCamera
let orbit: OrbitControls
let renderer: THREE.WebGLRenderer

const cubes: THREE.Mesh[] = []
const selectedObjects: THREE.Object3D[] = []

// 多选偏移量
let offsets: THREE.Vector3[] = []

// 虚拟控制器（多选时 attach）
const virtualControl = new THREE.Object3D()
virtualControl.visible = false

// 框选模式开关
const boxSelectMode = ref(false)

// -------------------- 框选逻辑 --------------------
let isSelecting = false
let isDragging = false  // 新增：TransformControls 拖动状态

onMounted(() => {
  const scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(45, 800 / 800, 1, 3000)
  camera.position.set(400, 400, 400)

  renderer = new THREE.WebGLRenderer({ canvas: canvasRef.value!, antialias: true })
  renderer.setSize(800, 800)

  // 创建物体
  for (let i = -1; i <= 1; i += 2) {
    const cube = new THREE.Mesh(new THREE.BoxGeometry(100, 100, 100), new THREE.MeshNormalMaterial())
    cube.position.set(i * 150, 0, 0)
    cubes.push(cube)
    scene.add(cube)
  }

  orbit = new OrbitControls(camera, renderer.domElement)
  orbit.enableDamping = true

  transform = new TransformControls(camera, renderer.domElement)
  scene.add(transform)
  scene.add(virtualControl)
  transform.addEventListener('dragging-changed', (event) => {
    isDragging = event.value
    orbit.enabled = !event.value && !boxSelectMode.value
  })
  // 辅助轴和网格
  const axesHelper = new THREE.AxesHelper(300)
  axesHelper.raycast = () => { }
  scene.add(axesHelper)
  const grid = new THREE.GridHelper(600, 10)
  grid.raycast = () => { }
  scene.add(grid)

  // -------------------- 框选逻辑 --------------------
  const startPoint = new THREE.Vector2()
  const rect = canvasRef.value!.getBoundingClientRect()
  canvasRef.value!.addEventListener('pointerdown', (event) => {
    if (!boxSelectMode.value || isDragging) return // 正在拖动就跳过
    isSelecting = true
    orbit.enabled = false
    startPoint.set(event.clientX - rect.left, event.clientY - rect.top)
    if (selectionBox.value) {
      selectionBox.value.style.left = `${startPoint.x}px`
      selectionBox.value.style.top = `${startPoint.y}px`
      selectionBox.value.style.width = '0px'
      selectionBox.value.style.height = '0px'
      selectionBox.value.style.display = 'block'
    }
  })

  // pointermove
  canvasRef.value!.addEventListener('pointermove', (event) => {
    if (!isSelecting || isDragging || !selectionBox.value) return // 正在拖动跳过
    const current = new THREE.Vector2(event.clientX - rect.left, event.clientY - rect.top)
    const x = Math.min(startPoint.x, current.x)
    const y = Math.min(startPoint.y, current.y)
    const w = Math.abs(current.x - startPoint.x)
    const h = Math.abs(current.y - startPoint.y)
    selectionBox.value.style.left = `${x}px`
    selectionBox.value.style.top = `${y}px`
    selectionBox.value.style.width = `${w}px`
    selectionBox.value.style.height = `${h}px`
  })

  // pointerup
  canvasRef.value!.addEventListener('pointerup', (event) => {
    if (!isSelecting || isDragging) return // 正在拖动跳过
    isSelecting = false
    orbit.enabled = true
    if (selectionBox.value) selectionBox.value.style.display = 'none'

    const x1 = Math.min(startPoint.x, event.clientX - rect.left)
    const y1 = Math.min(startPoint.y, event.clientY - rect.top)
    const x2 = Math.max(startPoint.x, event.clientX - rect.left)
    const y2 = Math.max(startPoint.y, event.clientY - rect.top)

    const newSelection: THREE.Object3D[] = []
    cubes.forEach(obj => {
      const pos = obj.position.clone().project(camera)
      const sx = ((pos.x + 1) / 2) * rect.width
      const sy = ((-pos.y + 1) / 2) * rect.height
      if (sx >= x1 && sx <= x2 && sy >= y1 && sy <= y2) newSelection.push(obj)
    })

    if (newSelection.length) updateSelection(newSelection)
  })

  // -------------------- 单选/多选逻辑 --------------------
  const raycaster = new THREE.Raycaster()
  const mouse = new THREE.Vector2()

  function updateSelection(objects: THREE.Object3D[]) {
    selectedObjects.length = 0
    selectedObjects.push(...objects)

    if (selectedObjects.length > 1) {
      // 多选 → attach 到虚拟控制器
      const center = new THREE.Vector3()
      selectedObjects.forEach(o => center.add(o.position))
      center.multiplyScalar(1 / selectedObjects.length)
      virtualControl.position.copy(center)
      virtualControl.rotation.set(0, 0, 0)
      virtualControl.scale.set(1, 1, 1)
      virtualControl.visible = true
      offsets = selectedObjects.map(o => o.position.clone().sub(center))
      transform.attach(virtualControl)
    } else {
      // 单选 → attach 到物体
      virtualControl.visible = false
      const obj = selectedObjects[0]
      transform.attach(obj)
      offsets = [new THREE.Vector3()]
    }
  }

  canvasRef.value!.addEventListener('pointerdown', (event) => {
    if (boxSelectMode.value) return
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(mouse, camera)
    const intersects = raycaster.intersectObjects(cubes, false)
    if (intersects.length) {
      const obj = intersects[0].object
      let newSelection = [...selectedObjects]
      if (event.ctrlKey) {
        if (!newSelection.includes(obj)) newSelection.push(obj)
      } else {
        newSelection = [obj]
      }
      updateSelection(newSelection)
    }
  })

  // -------------------- 拖动同步多选 --------------------
  transform.addEventListener('objectChange', () => {
    if (selectedObjects.length <= 1) return
    const mainObject = virtualControl
    selectedObjects.forEach((o, i) => {
      if (o !== mainObject) o.position.copy(mainObject.position).add(offsets[i])
      if (o !== mainObject) o.rotation.copy(mainObject.rotation)
      if (o !== mainObject) o.scale.copy(mainObject.scale)
    })
  })

  // -------------------- 动画循环 --------------------
  function animate() {
    orbit.update()
    renderer.render(scene, camera)
    requestAnimationFrame(animate)
  }
  animate()
})

const setTransformMode = (mode: 'translate' | 'rotate' | 'scale') => {
  if (transform) transform.mode = mode
}

const toggleBoxSelectMode = () => {
  boxSelectMode.value = !boxSelectMode.value
  orbit.enabled = !boxSelectMode.value
}
</script>

<template>
  <div style="position: relative;">
    <button @click="setTransformMode('translate')">平移</button>
    <button @click="setTransformMode('rotate')">旋转</button>
    <button @click="setTransformMode('scale')">缩放</button>
    <button @click="toggleBoxSelectMode">{{ boxSelectMode ? '关闭框选' : '开启框选' }}</button>
    <p>Ctrl+点击可多选，拖动框选可选中多个物体，多选时虚拟控制器显示在中心</p>
    <canvas ref="canvasRef" width="800" height="800" />
    <div ref="selectionBox" style="position:absolute; border:1px dashed #0ff; pointer-events:none; display:none"></div>
  </div>
</template>