<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
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

// 编辑模式：物体 / 顶点
type EditMode = 'object' | 'vertex'
const editMode = ref<EditMode>('object')

// 框选逻辑
let isSelecting = false
let isDragging = false

// 顶点编辑句柄（attach 到它）
const vertexHandle = new THREE.Object3D()
vertexHandle.visible = false
let selectedVertex: { mesh: THREE.Mesh; index: number } | null = null

/* =========================
 * 1) Weld：把 geometry 按 position 合并成共享顶点（indexed）
 *   - 忽略 uv/normal（建模阶段够用）
 *   - 后续可拓展：同时焊 uv/normal 或保留硬边
 * ========================= */
function weldGeometryByPosition(
  geometry: THREE.BufferGeometry,
  epsilon = 1e-6
): THREE.BufferGeometry {
  const src = geometry.clone()

  const pos = src.getAttribute('position') as THREE.BufferAttribute
  const indexAttr = src.getIndex()

  // 展开成“按三角形顺序”的顶点列表（有 index 就按 index 取）
  const expanded: number[] = []
  if (indexAttr) {
    const idx = indexAttr.array as ArrayLike<number>
    for (let i = 0; i < idx.length; i++) {
      const vi = idx[i]
      expanded.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi))
    }
  } else {
    // 本来就是非 indexed
    for (let i = 0; i < pos.count; i++) {
      expanded.push(pos.getX(i), pos.getY(i), pos.getZ(i))
    }
  }

  // hash：把坐标映射到网格 key，容差 epsilon
  const inv = 1 / epsilon
  const keyOf = (x: number, y: number, z: number) => {
    const ix = Math.round(x * inv)
    const iy = Math.round(y * inv)
    const iz = Math.round(z * inv)
    return `${ix},${iy},${iz}`
  }

  const map = new Map<string, number>() // key -> newIndex
  const newPositions: number[] = []
  const newIndices: number[] = []

  for (let i = 0; i < expanded.length; i += 3) {
    const x = expanded[i]
    const y = expanded[i + 1]
    const z = expanded[i + 2]
    const key = keyOf(x, y, z)

    let newIndex = map.get(key)
    if (newIndex == null) {
      newIndex = newPositions.length / 3
      map.set(key, newIndex)
      newPositions.push(x, y, z)
    }
    newIndices.push(newIndex)
  }

  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3))
  out.setIndex(newIndices)

  out.computeVertexNormals()
  out.computeBoundingSphere()
  out.computeBoundingBox()
  return out
}

/* =========================
 * 2) 给 mesh 创建/刷新 helpers（wireframe + points）
 *    - points 用“共享顶点 position”，所以拖动一次就行
 * ========================= */
function buildHelpers(mesh: THREE.Mesh) {
  // 清理旧的
  if (mesh.userData.wire) {
    mesh.userData.wire.geometry.dispose()
      ; (mesh.userData.wire.material as THREE.Material).dispose?.()
  }
  if (mesh.userData.points) {
    mesh.userData.points.geometry.dispose()
      ; (mesh.userData.points.material as THREE.Material).dispose?.()
  }

  const g = mesh.geometry as THREE.BufferGeometry

  // wireframe
  const wire = new THREE.LineSegments(
    new THREE.WireframeGeometry(g),
    new THREE.LineBasicMaterial({ color: 0x00ffff })
  )
  wire.visible = false
  wire.raycast = () => { } // 避免被拾取干扰
  mesh.userData.wire = wire

  // points（共享顶点）
  const ptsGeo = new THREE.BufferGeometry()
  // 这里直接 clone 一份 attribute，避免 points 改动影响 mesh（也可以共享，但 clone 更稳）
  const posAttr = g.getAttribute('position') as THREE.BufferAttribute
  ptsGeo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute((posAttr.array as Float32Array).slice(), 3)
  )
  const pts = new THREE.Points(
    ptsGeo,
    new THREE.PointsMaterial({ size: 8, sizeAttenuation: false, color: 0xffcc00 })
  )
  pts.visible = false
  pts.userData.owner = mesh
  mesh.userData.points = pts
}

/* =========================
 * 3) 同步 points / wireframe（当 mesh.geometry.position 改了）
 * ========================= */
function syncHelpers(mesh: THREE.Mesh) {
  const g = mesh.geometry as THREE.BufferGeometry
  const posAttr = g.getAttribute('position') as THREE.BufferAttribute

  // sync points
  const pts = mesh.userData.points as THREE.Points | undefined
  if (pts) {
    const pPos = pts.geometry.getAttribute('position') as THREE.BufferAttribute
    // 复制 mesh 的 position 到 points
    for (let i = 0; i < posAttr.count; i++) {
      pPos.setXYZ(i, posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i))
    }
    pPos.needsUpdate = true
  }

  // sync wireframe（重建最省事，Demo 足够）
  const wire = mesh.userData.wire as THREE.LineSegments | undefined
  if (wire) {
    wire.geometry.dispose()
    wire.geometry = new THREE.WireframeGeometry(g)
  }
}

onMounted(() => {
  const scene = new THREE.Scene()

  camera = new THREE.PerspectiveCamera(45, 800 / 800, 1, 3000)
  camera.position.set(400, 400, 400)

  renderer = new THREE.WebGLRenderer({ canvas: canvasRef.value!, antialias: true })
  renderer.setSize(800, 800)

  // 创建物体
  for (let i = -1; i <= 1; i += 2) {
    const base = new THREE.BoxGeometry(100, 100, 100)
    const welded = weldGeometryByPosition(base, 1e-6) // ✅ 关键：共享顶点
    base.dispose()

    const cube = new THREE.Mesh(welded, new THREE.MeshNormalMaterial())
    cube.position.set(i * 150, 0, 0)

    cubes.push(cube)
    scene.add(cube)

    buildHelpers(cube)
    scene.add(cube.userData.wire)
    scene.add(cube.userData.points)
  }

  orbit = new OrbitControls(camera, renderer.domElement)
  orbit.enableDamping = true

  transform = new TransformControls(camera, renderer.domElement)
  scene.add(transform)

  scene.add(virtualControl)
  scene.add(vertexHandle)

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
    if (!boxSelectMode.value || isDragging) return
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

  canvasRef.value!.addEventListener('pointermove', (event) => {
    if (!isSelecting || isDragging || !selectionBox.value) return
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

  canvasRef.value!.addEventListener('pointerup', (event) => {
    if (!isSelecting || isDragging) return
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

  function clearHelpersVisible() {
    cubes.forEach(c => {
      if (c.userData.wire) c.userData.wire.visible = false
      if (c.userData.points) c.userData.points.visible = false
    })
  }

  function updateSelection(objects: THREE.Object3D[]) {
    selectedObjects.length = 0
    selectedObjects.push(...objects)

    // 清顶点选择
    selectedVertex = null
    vertexHandle.visible = false

    clearHelpersVisible()

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

      const m = obj as THREE.Mesh
      if (m.userData.wire) m.userData.wire.visible = true
      if (m.userData.points) m.userData.points.visible = (editMode.value === 'vertex')
    }
  }

  // 点击：顶点模式优先拾取点，否则拾取物体
  canvasRef.value!.addEventListener('pointerdown', (event) => {
    if (boxSelectMode.value) return

    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(mouse, camera)

    // ---------- 顶点模式 ----------
    if (editMode.value === 'vertex' && selectedObjects.length === 1) {
      const mesh = selectedObjects[0] as THREE.Mesh
      const pts = mesh.userData.points as THREE.Points | undefined
      if (pts) {
        const hit = raycaster.intersectObject(pts, false)[0]
        if (hit && hit.index != null) {
          selectedVertex = { mesh, index: hit.index }

          // vertexHandle 放到该顶点位置（注意：这里用 points 的位置，因为 points 是可视化）
          const pPos = pts.geometry.getAttribute('position') as THREE.BufferAttribute
          vertexHandle.position.set(pPos.getX(hit.index), pPos.getY(hit.index), pPos.getZ(hit.index))
          vertexHandle.visible = true

          transform.attach(vertexHandle)
          return
        }
      }
    }

    // ---------- 物体模式 ----------
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

  // 多选拖动同步 + 顶点拖动写回
  transform.addEventListener('objectChange', () => {
    // 顶点编辑：写回 mesh.geometry
    if (transform.object === vertexHandle && selectedVertex) {
      const { mesh, index } = selectedVertex
      const g = mesh.geometry as THREE.BufferGeometry
      const pos = g.getAttribute('position') as THREE.BufferAttribute

      pos.setXYZ(index, vertexHandle.position.x, vertexHandle.position.y, vertexHandle.position.z)
      pos.needsUpdate = true

      g.computeVertexNormals()
      g.computeBoundingSphere()
      g.computeBoundingBox()

      syncHelpers(mesh)
      return
    }

    // 多选同步
    if (selectedObjects.length <= 1) return
    const mainObject = virtualControl
    selectedObjects.forEach((o, i) => {
      if (o !== mainObject) o.position.copy(mainObject.position).add(offsets[i])
      if (o !== mainObject) o.rotation.copy(mainObject.rotation)
      if (o !== mainObject) o.scale.copy(mainObject.scale)
    })
  })

  function animate() {
    orbit.update()
    renderer.render(scene, camera)
    requestAnimationFrame(animate)
  }
  animate()

  // 默认先选中一个，方便体验
  updateSelection([cubes[0]])
})

// 切换编辑模式时：显示/隐藏 points
watch(editMode, () => {
  cubes.forEach(c => {
    if (c.userData.points) c.userData.points.visible = false
  })
  if (selectedObjects.length === 1) {
    const m = selectedObjects[0] as THREE.Mesh
    if (m.userData.points) m.userData.points.visible = (editMode.value === 'vertex')
  }
  // 切回物体模式清理顶点句柄
  if (editMode.value === 'object') {
    selectedVertex = null
    vertexHandle.visible = false
  }
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

    <button @click="editMode = editMode === 'object' ? 'vertex' : 'object'">
      {{ editMode === 'object' ? '切到点模式' : '切到物体模式' }}
    </button>

    <p>
      物体模式：点击选择 / Ctrl 多选 / Transform 操作<br />
      点模式：先单选一个物体 → 点击顶点 → 拖动 gizmo 改形状（共享顶点已 Weld，不会一角拖两次）
    </p>

    <canvas ref="canvasRef" width="800" height="800" />
    <div ref="selectionBox" style="position:absolute; border:1px dashed #0ff; pointer-events:none; display:none"></div>
  </div>
</template>
