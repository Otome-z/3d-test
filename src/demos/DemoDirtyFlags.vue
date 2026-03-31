<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import * as THREE from 'three'
import { createThreeBase } from '@/composables/useThreeBase'

type EditableVertex = {
  id: number
  position: THREE.Vector3
}

type EditableMeshBuffer = {
  vertices: EditableVertex[]
  geometry: THREE.BufferGeometry
  geometryPosition: THREE.BufferAttribute
  edgeGeometry: THREE.BufferGeometry
  edgePosition: THREE.BufferAttribute
  mesh: THREE.Mesh
  edges: THREE.LineSegments
  markerGroup: THREE.Group
  dirtyVertexIds: Set<number>
  topologyDirty: boolean
}

const canvasRef = ref<HTMLCanvasElement | null>(null)
const autoFlush = ref(true)

const info = reactive({
  selectedVertex: '未选择',
  dirtyVertices: '[]',
  topologyDirty: 'false',
  flushCount: 0,
  selectedBounds: '',
  lastAction: '点击顶点后拖动，观察脏标记和 flush 的变化。'
})

const cubeFaces: Array<[number, number, number, number]> = [
  [0, 1, 2, 3],
  [4, 7, 6, 5],
  [0, 4, 5, 1],
  [1, 5, 6, 2],
  [2, 6, 7, 3],
  [3, 7, 4, 0]
]

const cubeEdges: Array<[number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7]
]

const meshIndex = cubeFaces.flatMap(([a, b, c, d]) => [a, b, c, a, c, d])
const edgeIndex = cubeEdges.flatMap(([a, b]) => [a, b])

let three: ReturnType<typeof createThreeBase> | null = null
let editableMesh: EditableMeshBuffer | null = null
const handle = new THREE.Object3D()
const cleanup: Array<() => void> = []

let selectedVertexId: number | null = null
let isDraggingGizmo = false

function createVertices() {
  const center = new THREE.Vector3(0, 40, 0)
  const size = new THREE.Vector3(120, 120, 120)
  const hx = size.x / 2
  const hy = size.y / 2
  const hz = size.z / 2
  const corners = [
    [-hx, -hy, -hz],
    [hx, -hy, -hz],
    [hx, hy, -hz],
    [-hx, hy, -hz],

    
    // [-hx, -hy, hz],
    // [-hx, hy, hz],
    // [hx, hy, hz],
    // [hx, -hy, hz],
    
    [-hx, hy, hz],
    [-hx, -hy, hz],
    [hx, -hy, hz],
    [hx, hy, hz],

  ] as const

  return corners.map(([x, y, z], index) => ({
    id: index,
    position: new THREE.Vector3(center.x + x, center.y + y, center.z + z)
  }))
}

function fillVertexPositionArray(target: Float32Array, vertices: EditableVertex[]) {
  let offset = 0
  for (const vertex of vertices) {
    target[offset++] = vertex.position.x
    target[offset++] = vertex.position.y
    target[offset++] = vertex.position.z
  }

  // vertices.forEach((vertex, index) => {
  //   attribute.setXYZ(index, vertex.position.x, vertex.position.y, vertex.position.z)
  // })
}

function createIndexedGeometry(vertices: EditableVertex[], index: number[]) {
  const geometry = new THREE.BufferGeometry()
  const positions = new Float32Array(vertices.length * 3)
  fillVertexPositionArray(positions, vertices)
  const position = new THREE.BufferAttribute(positions, 3)
  position.setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('position', position)
  geometry.setIndex(index)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return { geometry, position }
}

function writeVertexToAttribute(attribute: THREE.BufferAttribute, vertexId: number, position: THREE.Vector3) {
  attribute.setXYZ(vertexId, position.x, position.y, position.z)
}

function createEditableMeshBuffer() {
  if (!three) throw new Error('three is not ready')

  const vertices = createVertices()
  const meshData = createIndexedGeometry(vertices, meshIndex)
  meshData.geometry.computeVertexNormals()
  const edgeData = createIndexedGeometry(vertices, edgeIndex)

  const mesh = new THREE.Mesh(
    meshData.geometry,
    new THREE.MeshStandardMaterial({
      color: 0x74c0fc,
      metalness: 0.05,
      roughness: 0.72,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide
    })
  )

  const edges = new THREE.LineSegments(
    edgeData.geometry,
    new THREE.LineBasicMaterial({ color: 0xffffff })
  )

  const markerGroup = new THREE.Group()
  vertices.forEach(vertex => {
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(7, 18, 18),
      new THREE.MeshBasicMaterial({ color: 0xff6b6b })
    )
    marker.position.copy(vertex.position)
    marker.userData.vertexId = vertex.id
    markerGroup.add(marker)
  })

  const result: EditableMeshBuffer = {
    vertices,
    geometry: meshData.geometry,
    geometryPosition: meshData.position,
    edgeGeometry: edgeData.geometry,
    edgePosition: edgeData.position,
    mesh,
    edges,
    markerGroup,
    dirtyVertexIds: new Set(),
    topologyDirty: false
  }

  three.scene.add(mesh)
  three.scene.add(edges)
  three.scene.add(markerGroup)
  return result
}

function updateMarkerColors() {
  if (!editableMesh) return

  editableMesh.markerGroup.children.forEach((child, index) => {
    const marker = child as THREE.Mesh
    const material = marker.material as THREE.MeshBasicMaterial
    const isSelected = selectedVertexId === index
    const isDirty = editableMesh.dirtyVertexIds.has(index)
    material.color.setHex(isSelected ? 0xffd43b : isDirty ? 0x40c057 : 0xff6b6b)
  })
}

function updateBoundsText() {
  if (!editableMesh) return
  const box = editableMesh.geometry.boundingBox
  info.selectedBounds = box
    ? `min(${box.min.x.toFixed(1)}, ${box.min.y.toFixed(1)}, ${box.min.z.toFixed(1)}) / max(${box.max.x.toFixed(1)}, ${box.max.y.toFixed(1)}, ${box.max.z.toFixed(1)})`
    : ''
}

function syncInfo() {
  info.selectedVertex = selectedVertexId == null ? '未选择' : `V${selectedVertexId}`
  info.dirtyVertices = editableMesh ? `[${[...editableMesh.dirtyVertexIds].join(', ')}]` : '[]'
  info.topologyDirty = editableMesh?.topologyDirty ? 'true' : 'false'
  updateBoundsText()
  updateMarkerColors()
}

function selectVertex(vertexId: number) {
  if (!editableMesh || !three) return
  selectedVertexId = vertexId
  handle.position.copy(editableMesh.vertices[vertexId].position)
  handle.visible = true
  three.transform.attach(handle)
  info.lastAction = `已选择顶点 V${vertexId}。拖动后会先打脏标记，再 flush 到 GPU buffer。`
  syncInfo()
}

function markVerticesDirty(vertexIds: number[]) {
  if (!editableMesh) return
  vertexIds.forEach(id => editableMesh.dirtyVertexIds.add(id))
}

function markTopologyDirty() {
  if (!editableMesh) return
  editableMesh.topologyDirty = true
  editableMesh.dirtyVertexIds.clear()
  info.lastAction = '已标记 topology dirty。下一次 flush 会整块重写 position buffer。'
  syncInfo()
}

function flushDirtyGeometry() {
  if (!editableMesh) return

  if (editableMesh.topologyDirty) {
    fillVertexPositionArray(editableMesh.geometryPosition.array as Float32Array, editableMesh.vertices)
    fillVertexPositionArray(editableMesh.edgePosition.array as Float32Array, editableMesh.vertices)
    editableMesh.geometryPosition.needsUpdate = true
    editableMesh.edgePosition.needsUpdate = true
    editableMesh.geometry.computeVertexNormals()
    editableMesh.geometry.computeBoundingBox()
    editableMesh.geometry.computeBoundingSphere()
    editableMesh.edgeGeometry.computeBoundingBox()
    editableMesh.edgeGeometry.computeBoundingSphere()
    editableMesh.topologyDirty = false
  } else if (editableMesh.dirtyVertexIds.size > 0) {
    editableMesh.dirtyVertexIds.forEach(vertexId => {
      const vertex = editableMesh.vertices[vertexId]
      writeVertexToAttribute(editableMesh.geometryPosition, vertexId, vertex.position)
      writeVertexToAttribute(editableMesh.edgePosition, vertexId, vertex.position)
    })
    editableMesh.geometryPosition.needsUpdate = true
    editableMesh.edgePosition.needsUpdate = true
    editableMesh.geometry.computeVertexNormals()
    editableMesh.geometry.computeBoundingBox()
    editableMesh.geometry.computeBoundingSphere()
    editableMesh.edgeGeometry.computeBoundingBox()
    editableMesh.edgeGeometry.computeBoundingSphere()
  } else {
    info.lastAction = '当前没有 dirty 数据，不需要 flush。'
    syncInfo()
    return
  }

  editableMesh.dirtyVertexIds.clear()
  editableMesh.vertices.forEach(vertex => {
    const marker = editableMesh?.markerGroup.children[vertex.id] as THREE.Mesh | undefined
    if (marker) marker.position.copy(vertex.position)
  })

  info.flushCount += 1
  info.lastAction = `已执行 flush #${info.flushCount}：把 dirty 数据同步到了 BufferGeometry。`
  syncInfo()
}

function applyHandleToVertex() {
  if (!editableMesh || selectedVertexId == null) return

  editableMesh.vertices[selectedVertexId].position.copy(handle.position)
  markVerticesDirty([selectedVertexId])
  info.lastAction = `顶点 V${selectedVertexId} 已变化，现在只是逻辑数据变了；是否写回 GPU 取决于 flush。`

  if (autoFlush.value) {
    flushDirtyGeometry()
    return
  }

  syncInfo()
}

function randomDeform() {
  if (!editableMesh) return

  editableMesh.vertices.forEach(vertex => {
    vertex.position.x += THREE.MathUtils.randFloatSpread(20)
    vertex.position.y += THREE.MathUtils.randFloatSpread(20)
    vertex.position.z += THREE.MathUtils.randFloatSpread(20)
  })
  markTopologyDirty()
}

function resetDemo() {
  if (!editableMesh) return

  editableMesh.vertices = createVertices()
  fillVertexPositionArray(editableMesh.geometryPosition.array as Float32Array, editableMesh.vertices)
  fillVertexPositionArray(editableMesh.edgePosition.array as Float32Array, editableMesh.vertices)
  editableMesh.geometryPosition.needsUpdate = true
  editableMesh.edgePosition.needsUpdate = true
  editableMesh.geometry.computeVertexNormals()
  editableMesh.geometry.computeBoundingBox()
  editableMesh.geometry.computeBoundingSphere()
  editableMesh.edgeGeometry.computeBoundingBox()
  editableMesh.edgeGeometry.computeBoundingSphere()
  editableMesh.dirtyVertexIds.clear()
  editableMesh.topologyDirty = false
  editableMesh.vertices.forEach(vertex => {
    const marker = editableMesh?.markerGroup.children[vertex.id] as THREE.Mesh | undefined
    if (marker) marker.position.copy(vertex.position)
  })

  selectedVertexId = null
  handle.visible = false
  three?.transform.detach()
  info.flushCount = 0
  info.lastAction = '已重置为初始立方体。'
  syncInfo()
}

onMounted(() => {
  three = createThreeBase(canvasRef.value!)
  const { scene, camera, orbit, raycaster, updateMouseFromEvent, transform } = three

  camera.position.set(320, 220, 320)
  orbit.target.set(0, 40, 0)

  scene.add(new THREE.AmbientLight(0xffffff, 1))
  const dir = new THREE.DirectionalLight(0xffffff, 1.1)
  dir.position.set(260, 320, 180)
  scene.add(dir)

  scene.add(handle)
  handle.visible = false

  editableMesh = createEditableMeshBuffer()
  syncInfo()

  transform.mode = 'translate'
  transform.addEventListener('dragging-changed', (event: any) => {
    isDraggingGizmo = event.value
  })
  transform.addEventListener('objectChange', () => {
    applyHandleToVertex()
  })

  const onPointerDown = (event: PointerEvent) => {
    if (!editableMesh || !three || isDraggingGizmo) return

    updateMouseFromEvent(event)
    raycaster.setFromCamera(three.mouse, camera)
    const markerHit = raycaster.intersectObjects(editableMesh.markerGroup.children, false)[0]

    if (!markerHit) {
      selectedVertexId = null
      handle.visible = false
      three.transform.detach()
      info.lastAction = '已取消顶点选择。'
      syncInfo()
      return
    }

    selectVertex(markerHit.object.userData.vertexId as number)
  }

  canvasRef.value!.addEventListener('pointerdown', onPointerDown)
  cleanup.push(() => canvasRef.value?.removeEventListener('pointerdown', onPointerDown))

  three.start()
})

onBeforeUnmount(() => {
  cleanup.forEach(fn => fn())
  cleanup.length = 0

  if (editableMesh) {
    editableMesh.geometry.dispose()
    editableMesh.edgeGeometry.dispose()
    ;(editableMesh.mesh.material as THREE.Material).dispose()
    ;(editableMesh.edges.material as THREE.Material).dispose()
    editableMesh.markerGroup.children.forEach(child => {
      const marker = child as THREE.Mesh
      marker.geometry.dispose()
      ;(marker.material as THREE.Material).dispose()
    })
    editableMesh.mesh.parent?.remove(editableMesh.mesh)
    editableMesh.edges.parent?.remove(editableMesh.edges)
    editableMesh.markerGroup.parent?.remove(editableMesh.markerGroup)
    editableMesh = null
  }

  three?.dispose()
  three = null
})
</script>

<template>
  <div style="display:flex; gap:16px; align-items:flex-start; flex-wrap:wrap;">
    <div style="width:820px;">
      <div style="margin-bottom:8px; line-height:1.8;">
        <button @click="flushDirtyGeometry">手动 Flush</button>
        <button @click="markTopologyDirty" style="margin-left:6px;">标记 Topology Dirty</button>
        <button @click="randomDeform" style="margin-left:6px;">随机整体变形</button>
        <button @click="resetDemo" style="margin-left:6px;">重置</button>
      </div>

      <div style="margin-bottom:8px; line-height:1.8;">
        <label style="display:flex; align-items:center; gap:8px;">
          <input v-model="autoFlush" type="checkbox" />
          <span>拖动顶点后自动 Flush</span>
        </label>
      </div>

      <div style="margin-bottom:8px; opacity:0.82; line-height:1.7;">
        红点是普通顶点，黄点是当前选中顶点，绿点表示“这个顶点已经 dirty，但还没 flush”。
      </div>

      <div style="width:800px; height:620px; border:1px solid #2a2a2a; border-radius:10px; overflow:hidden;">
        <canvas ref="canvasRef" style="width:800px; height:620px; display:block;" />
      </div>
    </div>

    <div style="width:420px; display:flex; flex-direction:column; gap:12px;">
      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">这页专门看什么</div>
        <div>1. 顶点先改逻辑数据，不一定立刻写回 BufferGeometry。</div>
        <div>2. dirtyVertexIds 只记录“哪些点脏了”。</div>
        <div>3. topologyDirty 表示“这次不要局部更新，要整块刷新”。</div>
        <div>4. flush 才是把 dirty 数据真正同步到 GPU buffer 的动作。</div>
      </div>

      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">当前状态</div>
        <div>选中顶点：{{ info.selectedVertex }}</div>
        <div>dirtyVertexIds：{{ info.dirtyVertices }}</div>
        <div>topologyDirty：{{ info.topologyDirty }}</div>
        <div>flush 次数：{{ info.flushCount }}</div>
        <div>包围盒：{{ info.selectedBounds }}</div>
      </div>

      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">建议你这样试</div>
        <div>先关闭“自动 Flush”。</div>
        <div>拖一个顶点，观察 dirtyVertexIds 变化。</div>
        <div>此时再点“手动 Flush”，理解“打脏”和“真正同步”是两步。</div>
        <div>再点“随机整体变形”，观察 topology dirty 的作用。</div>
      </div>

      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">最近操作</div>
        <div>{{ info.lastAction }}</div>
      </div>
    </div>
  </div>
</template>
