<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import * as THREE from 'three'
import { createThreeBase } from '@/composables/useThreeBase'

const canvasRef = ref<HTMLCanvasElement | null>(null)

let three: ReturnType<typeof createThreeBase> | null = null

// 用于操作顶点或边的句柄（显示在鼠标点击的位置）
const handle = new THREE.Object3D()
handle.visible = false // 默认隐藏，只有在选择时显示
let selectedIndex: number | null = null // 记录当前选中的顶点的索引
let selectedEdge: number[] | null = null // 记录选中的边（两个顶点的索引）

// 当前选择的模式（点模式或线模式）
const mode = ref<'vertex' | 'edge'>('vertex') 

// 场景中的几何数据（点和边）
let mesh: THREE.Mesh
let lineSegments: THREE.LineSegments

/** 
 * 把几何体按位置合并，确保共享顶点（去重）
 * @param geometry 要处理的 BufferGeometry
 * @param epsilon 容差，用来判断两个顶点是否位置相同
 * @returns 合并后的 BufferGeometry
 */
function weldGeometryByPosition(geometry: THREE.BufferGeometry, epsilon = 1e-6) {
  const src = geometry.clone() // 克隆原始几何体，以便不修改原数据
  const pos = src.getAttribute('position') as THREE.BufferAttribute // 获取顶点位置
  const indexAttr = src.getIndex() // 获取索引（如果是 indexed geometry）

  const expanded: number[] = []
  // 如果有索引（indexed geometry），按索引扩展顶点
  if (indexAttr) {
    const idx = indexAttr.array as ArrayLike<number>
    for (let i = 0; i < idx.length; i++) {
      const vi = idx[i]
      expanded.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi))
    }
  } else {
    // 如果没有索引，直接展开顶点数据
    for (let i = 0; i < pos.count; i++) expanded.push(pos.getX(i), pos.getY(i), pos.getZ(i))
  }

  const inv = 1 / epsilon
  const keyOf = (x: number, y: number, z: number) =>
    `${Math.round(x * inv)},${Math.round(y * inv)},${Math.round(z * inv)}` // 用位置哈希化顶点

  const map = new Map<string, number>() // 存储位置哈希 -> 新索引的映射
  const newPos: number[] = []
  const newIdx: number[] = []

  for (let i = 0; i < expanded.length; i += 3) {
    const x = expanded[i], y = expanded[i + 1], z = expanded[i + 2]
    const key = keyOf(x, y, z) // 获取顶点的哈希值
    let ni = map.get(key)
    if (ni == null) {
      ni = newPos.length / 3 // 如果这个位置是新的，则生成一个新索引
      map.set(key, ni)
      newPos.push(x, y, z) // 添加新顶点
    }
    newIdx.push(ni) // 使用新的索引
  }

  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(newPos, 3)) // 设置顶点位置
  out.setIndex(newIdx) // 设置索引

  out.computeVertexNormals() // 计算法线
  return out
}

/** 
 * 给 Mesh 添加顶点点阵的 overlay，作为顶点的可视化（主要用于 vertex 模式）
 * @param mesh 要添加点阵 overlay 的 mesh
 */
function buildPointsOverlay(mesh: THREE.Mesh) {
  const g = mesh.geometry as THREE.BufferGeometry
  const ptsGeo = new THREE.BufferGeometry()
  // 共享原始 geometry 的位置属性
  ptsGeo.setAttribute('position', g.getAttribute('position') as THREE.BufferAttribute)

  const pts = new THREE.Points(
    ptsGeo,
    new THREE.PointsMaterial({
      size: 10, // 设置点的大小
      sizeAttenuation: false, // 不根据距离衰减
      color: 0xffcc00, // 点的颜色
      depthTest: false, // 点永远显示在最上层
      depthWrite: false // 防止点被遮挡
    })
  )
  pts.renderOrder = 10 // 确保点在物体上方渲染
  pts.frustumCulled = false // 防止裁剪
  pts.userData.owner = mesh // 设置点阵的所有者
  mesh.add(pts) // 将点阵加入到 Mesh 中
  mesh.userData.points = pts // 记录点阵对象
}

/**
 * 给 Mesh 添加线段显示，作为顶点之间的连线（主要用于 vertex 模式）
 * @param mesh 要添加线段显示的 mesh
 */
function buildLineOverlay(mesh: THREE.Mesh) {
  const g = mesh.geometry as THREE.BufferGeometry
  const edges = new THREE.EdgesGeometry(g) // 获取几何体的边缘
  const line = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({
      color: 0x00ff00, // 线的颜色
      opacity: 0.5,
      transparent: true
    })
  )
  mesh.add(line) // 将线段加入到 Mesh 中
}

onMounted(() => {
  // 初始化三维场景
  three = createThreeBase(canvasRef.value!)
  const { scene, raycaster, camera, updateMouseFromEvent, transform } = three

  // 创建一个 BoxGeometry，并将其顶点合并
  const base = new THREE.BoxGeometry(150, 150, 150)
  const welded = weldGeometryByPosition(base, 1e-6) // 合并顶点，去重
  base.dispose() // 清理原几何体

  // 创建 Mesh
  mesh = new THREE.Mesh(welded, new THREE.MeshNormalMaterial({ side: THREE.DoubleSide }))
  scene.add(mesh)

  buildPointsOverlay(mesh) // 为 Mesh 添加点阵 overlay
  buildLineOverlay(mesh) // 为 Mesh 添加线段 overlay

  // 将操作句柄挂在 Mesh 下
  mesh.add(handle)

  /** 
   * 监听 pointerdown 事件，当点击时选择顶点或边并显示操作句柄（handle）
   * 通过 raycaster 进行拾取
   */
  const onDown = (ev: PointerEvent) => {
    if (mode.value === 'vertex') {
      // 在点模式下选择顶点
      const pts = mesh.userData.points as THREE.Points
      updateMouseFromEvent(ev) // 更新鼠标坐标
      raycaster.setFromCamera(three!.mouse, camera) // 使用 raycaster 进行射线投射
      const hit = raycaster.intersectObject(pts, false)[0] // 拾取到的第一个顶点
      if (!hit || hit.index == null) return // 如果没有命中或没有索引，返回

      selectedIndex = hit.index // 记录当前选中的顶点索引
      const pos = (mesh.geometry as THREE.BufferGeometry).getAttribute('position') as THREE.BufferAttribute
      handle.position.set(pos.getX(hit.index), pos.getY(hit.index), pos.getZ(hit.index)) // 将操作句柄放到点击的顶点位置
      handle.visible = true // 显示操作句柄
      transform.attach(handle) // 将操作句柄附加到 TransformControls
    } else if (mode.value === 'edge') {
      // 在边模式下选择边（连接两个顶点）
      const edges = mesh.geometry.getIndex() // 获取索引
      const edgeCount = edges ? edges.count / 2 : 0
      for (let i = 0; i < edgeCount; i++) {
        // 假设每个边有两个顶点
        const startIdx = edges.getX(i * 2)
        const endIdx = edges.getX(i * 2 + 1)
        const posStart = mesh.geometry.getAttribute('position') as THREE.BufferAttribute
        const posEnd = mesh.geometry.getAttribute('position') as THREE.BufferAttribute
        const start = new THREE.Vector3(posStart.getX(startIdx), posStart.getY(startIdx), posStart.getZ(startIdx))
        const end = new THREE.Vector3(posEnd.getX(endIdx), posEnd.getY(endIdx), posEnd.getZ(endIdx))

        const dist = start.distanceTo(end)
        if (dist < 10) { // 如果距离足够近，选择这条边
          selectedEdge = [startIdx, endIdx]
          break
        }
      }
    }
  }
  canvasRef.value!.addEventListener('pointerdown', onDown)

  // 拖动写回
  transform.addEventListener('objectChange', () => {
    if (mode.value === 'vertex' && selectedIndex != null) {
      // 点模式：写回顶点位置
      const g = mesh.geometry as THREE.BufferGeometry
      const pos = g.getAttribute('position') as THREE.BufferAttribute
      pos.setXYZ(selectedIndex, handle.position.x, handle.position.y, handle.position.z)
      pos.needsUpdate = true // 需要更新 geometry
      g.computeVertexNormals() // 重新计算法线
    }
    // 如果你需要在边模式下进行更多的操作（如拖动边），可以在这里处理
  })

  three.start()

  cleanup.push(() => canvasRef.value!.removeEventListener('pointerdown', onDown))
})

const cleanup: Array<() => void> = []
onBeforeUnmount(() => {
  cleanup.forEach(fn => fn()) // 清理事件监听器
  cleanup.length = 0
  three?.dispose() // 释放资源
  three = null
})

const toggleMode = () => {
  mode.value = mode.value === 'vertex' ? 'edge' : 'vertex'
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
