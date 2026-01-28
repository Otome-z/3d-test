<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import * as THREE from 'three'
import { createThreeBase } from '@/composables/useThreeBase'

const canvasRef = ref<HTMLCanvasElement | null>(null)
let three: ReturnType<typeof createThreeBase> | null = null

const handle = new THREE.Object3D()
handle.visible = false

const mode = ref<'vertex' | 'edge'>('vertex')

let mesh!: THREE.Mesh

// overlays（只 build 一次，切换 visible）
let pointsOverlay!: THREE.Points
let edgeOverlay!: THREE.LineSegments

// 顶点/边选择状态
let selectedIndex: number | null = null
let selectedEdge: [number, number] | null = null

// 边数据：每条边对应 mesh.position 里的两个顶点索引
let edgePairs: Array<[number, number]> = []

// 边拖动需要：记录 handle 上次位置来算 delta
const lastHandlePos = new THREE.Vector3()

/** 从 indexed 三角网格提取唯一边（无向边去重） */
function buildUniqueEdgesFromIndexedGeometry(g: THREE.BufferGeometry) {
  const index = g.getIndex()
  if (!index) return []

  const pairs: Array<[number, number]> = []
  const seen = new Set<string>()

  const addEdge = (a: number, b: number) => {
    const i0 = Math.min(a, b)
    const i1 = Math.max(a, b)
    const key = `${i0}_${i1}`
    if (seen.has(key)) return
    seen.add(key)
    pairs.push([i0, i1])
  }

  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i)
    const b = index.getX(i + 1)
    const c = index.getX(i + 2)
    addEdge(a, b)
    addEdge(b, c)
    addEdge(c, a)
  }
  return pairs
}

/** Points overlay：直接共享 mesh 的 position attribute，顶点变动自动反映 */
function buildPointsOverlay(mesh: THREE.Mesh) {
  const g = mesh.geometry as THREE.BufferGeometry
  const ptsGeo = new THREE.BufferGeometry()
  ptsGeo.setAttribute('position', g.getAttribute('position') as THREE.BufferAttribute)

  const pts = new THREE.Points(
    ptsGeo,
    new THREE.PointsMaterial({
      size: 10,
      sizeAttenuation: false,
      color: 0xffcc00,
      depthTest: false,
      depthWrite: false
    })
  )
  pts.renderOrder = 10
  pts.frustumCulled = false
  mesh.add(pts)
  return pts
}

/** Edge overlay：用 edgePairs 展开成 LineSegments 的 position */
function buildEdgeOverlay(mesh: THREE.Mesh, edgePairs: Array<[number, number]>) {
  const g = mesh.geometry as THREE.BufferGeometry
  const pos = g.getAttribute('position') as THREE.BufferAttribute

  const linePos = new Float32Array(edgePairs.length * 2 * 3) // 每条边 2 个点，每点 3 分量
  const lineGeo = new THREE.BufferGeometry()
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3))

  const line = new THREE.LineSegments(
    lineGeo,
    new THREE.LineBasicMaterial({
      color: 0x00ff00,
      opacity: 0.7,
      transparent: true,
      depthTest: true
    })
  )

  // 关键：让 raycaster 更容易点中线
  // 这个阈值是“世界单位”，你可以按模型大小调
  line.frustumCulled = false

  mesh.add(line)

  // 首次填充
  updateEdgeOverlayPositions(mesh, edgePairs, line)

  return line
}

/** 顶点变化后：把 mesh.position 重新拷贝到 edgeOverlay.position（展开的） */
function updateEdgeOverlayPositions(mesh: THREE.Mesh, edgePairs: Array<[number, number]>, line: THREE.LineSegments) {
  const g = mesh.geometry as THREE.BufferGeometry
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const linePos = (line.geometry.getAttribute('position') as THREE.BufferAttribute)

  let o = 0
  for (let i = 0; i < edgePairs.length; i++) {
    const [a, b] = edgePairs[i]
    // a
    linePos.setXYZ(o++, pos.getX(a), pos.getY(a), pos.getZ(a))
    // b
    linePos.setXYZ(o++, pos.getX(b), pos.getY(b), pos.getZ(b))
  }
  linePos.needsUpdate = true
}

/** 切换模式：只切 visible，不重复 build */
function applyModeVisibility() {
  const isVertex = mode.value === 'vertex'
  pointsOverlay.visible = isVertex
  edgeOverlay.visible = !isVertex

  // 进入某模式时清理另一种选择
  selectedIndex = null
  selectedEdge = null
  handle.visible = false
}

onMounted(() => {
  three = createThreeBase(canvasRef.value!)
  const { scene, raycaster, camera, updateMouseFromEvent, transform } = three

  // demo: 一个盒子
  const base = new THREE.BoxGeometry(150, 150, 150)
  // 这里你原本 weld 的逻辑可以保留（不影响下面结构）
  // 但确保最终是 indexed geometry（BoxGeometry 默认是 indexed）
  mesh = new THREE.Mesh(base, new THREE.MeshNormalMaterial({ side: THREE.DoubleSide }))
  scene.add(mesh)

  // build overlays once
  pointsOverlay = buildPointsOverlay(mesh)

  edgePairs = buildUniqueEdgesFromIndexedGeometry(mesh.geometry as THREE.BufferGeometry)
  edgeOverlay = buildEdgeOverlay(mesh, edgePairs)
  edgeOverlay.visible = false // 默认点模式

  mesh.add(handle)
  applyModeVisibility()

  // raycaster 参数：提高点线命中
  raycaster.params.Line = raycaster.params.Line || { threshold: 1 }
  raycaster.params.Line.threshold = 6 // 世界单位阈值，模型越大可以越大

  const onDown = (ev: PointerEvent) => {
    updateMouseFromEvent(ev)
    raycaster.setFromCamera(three!.mouse, camera)

    if (mode.value === 'vertex') {
      // 点：用 points overlay 拾取
      const hit = raycaster.intersectObject(pointsOverlay, false)[0]
      if (!hit || hit.index == null) return

      selectedIndex = hit.index
      selectedEdge = null

      const g = mesh.geometry as THREE.BufferGeometry
      const pos = g.getAttribute('position') as THREE.BufferAttribute
      handle.position.set(pos.getX(hit.index), pos.getY(hit.index), pos.getZ(hit.index))
      lastHandlePos.copy(handle.position)

      handle.visible = true
      transform.attach(handle)
    } else {
      // 边：用 lineSegments 拾取
      const hit = raycaster.intersectObject(edgeOverlay, false)[0]
      if (!hit || hit.index == null) return

      // hit.index 对应的是第几段线（segment）
      const edge = edgePairs[hit.index]
      if (!edge) return

      selectedEdge = edge
      selectedIndex = null

      const [a, b] = edge
      const g = mesh.geometry as THREE.BufferGeometry
      const pos = g.getAttribute('position') as THREE.BufferAttribute
      const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a)
      const bx = pos.getX(b), by = pos.getY(b), bz = pos.getZ(b)

      // handle 放在边中点
      handle.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2)
      lastHandlePos.copy(handle.position)

      handle.visible = true
      transform.attach(handle)
    }
  }

  canvasRef.value!.addEventListener('pointerdown', onDown)

  transform.addEventListener('objectChange', () => {
    const g = mesh.geometry as THREE.BufferGeometry
    const pos = g.getAttribute('position') as THREE.BufferAttribute

    if (mode.value === 'vertex' && selectedIndex != null) {
      pos.setXYZ(selectedIndex, handle.position.x, handle.position.y, handle.position.z)
      pos.needsUpdate = true
      g.computeVertexNormals()
      updateEdgeOverlayPositions(mesh, edgePairs, edgeOverlay) // 让线跟着变
      return
    }

    if (mode.value === 'edge' && selectedEdge) {
      const [a, b] = selectedEdge

      // delta = 当前 handle - 上一次 handle
      const dx = handle.position.x - lastHandlePos.x
      const dy = handle.position.y - lastHandlePos.y
      const dz = handle.position.z - lastHandlePos.z
      if (dx === 0 && dy === 0 && dz === 0) return

      // 两个端点一起移动
      pos.setXYZ(a, pos.getX(a) + dx, pos.getY(a) + dy, pos.getZ(a) + dz)
      pos.setXYZ(b, pos.getX(b) + dx, pos.getY(b) + dy, pos.getZ(b) + dz)
      pos.needsUpdate = true

      // 更新 lastHandlePos
      lastHandlePos.copy(handle.position)

      g.computeVertexNormals()
      updateEdgeOverlayPositions(mesh, edgePairs, edgeOverlay)
      return
    }
  })

  three.start()

  cleanup.push(() => canvasRef.value!.removeEventListener('pointerdown', onDown))
})

const cleanup: Array<() => void> = []
onBeforeUnmount(() => {
  cleanup.forEach(fn => fn())
  cleanup.length = 0
  three?.dispose()
  three = null
})

const toggleMode = () => {
  mode.value = mode.value === 'vertex' ? 'edge' : 'vertex'
  applyModeVisibility()
}
</script>

<template>
  <div style="width: 800px;">
    <div style="margin-bottom: 8px;">
      <button @click="toggleMode">
        {{ mode === 'vertex' ? '切换到线模式' : '切换到点模式' }}
      </button>
      <div style="margin-top: 8px;">
        当前模式：{{ mode === 'vertex' ? '点模式' : '线模式' }}
      </div>
    </div>
    <canvas ref="canvasRef" style="width: 800px; height: 800px;" />
  </div>
</template>
