<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import * as THREE from 'three'
import { createThreeBase } from '@/composables/useThreeBase'

type MirrorPlane = 'yz' | 'xz' | 'xy'
type ObjectRole = 'source' | 'mirror'

type EditableVertex = {
  id: number
  position: THREE.Vector3
}

type EditableObject = {
  id: number
  name: string
  role: ObjectRole
  vertices: EditableVertex[]
  geometry: THREE.BufferGeometry
  geometryPosition: THREE.BufferAttribute
  edgeGeometry: THREE.BufferGeometry
  edgePosition: THREE.BufferAttribute
  mesh: THREE.Mesh
  edges: THREE.LineSegments
  markerGroup: THREE.Group
  mirrorPlane: MirrorPlane | null
  mirrorOfId: number | null
  mirroredById: number | null
  dirtyVertexIds: Set<number>
  topologyDirty: boolean
}

const canvasRef = ref<HTMLCanvasElement | null>(null)
const selectedPlane = ref<MirrorPlane>('yz')
const keepSourceVisible = ref(true)
const mirrorEditEnabled = ref(false)

const info = reactive({
  selectedPlaneLabel: 'YZ 面（x = 0）',
  selectedObject: '未选择',
  selectedVertex: '未选择',
  mirrorState: '先选择镜像面，再选择物体生成镜像。',
  mirrorPair: '暂无镜像关系',
  lastAction: '点击场景中的物体进行选择，再使用右侧镜像操作。',
  selectedBounds: '',
  mirrorBounds: ''
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
let planeMesh: THREE.Mesh | null = null
const handle = new THREE.Object3D()
const cleanup: Array<() => void> = []

const editableObjects = new Map<number, EditableObject>()
let nextObjectId = 1
let selectedObjectId: number | null = null
let selectedVertexId: number | null = null
let isDraggingGizmo = false
let infoDirty = false

function planeLabel(plane: MirrorPlane) {
  if (plane === 'yz') return 'YZ 面（x = 0）'
  if (plane === 'xz') return 'XZ 面（y = 0）'
  return 'XY 面（z = 0）'
}

function axisLabel(plane: MirrorPlane) {
  if (plane === 'yz') return 'X'
  if (plane === 'xz') return 'Y'
  return 'Z'
}

function reflectPoint(point: THREE.Vector3, plane: MirrorPlane) {
  if (plane === 'yz') return new THREE.Vector3(-point.x, point.y, point.z)
  if (plane === 'xz') return new THREE.Vector3(point.x, -point.y, point.z)
  return new THREE.Vector3(point.x, point.y, -point.z)
}

function cloneVertices(vertices: EditableVertex[]) {
  return vertices.map(vertex => ({
    id: vertex.id,
    position: vertex.position.clone()
  }))
}

function createCuboidVertices(center: THREE.Vector3, size: THREE.Vector3) {
  const hx = size.x / 2
  const hy = size.y / 2
  const hz = size.z / 2
  const corners = [
    [-hx, -hy, -hz],
    [hx, -hy, -hz],
    [hx, hy, -hz],
    [-hx, hy, -hz],
    [-hx, -hy, hz],
    [-hx, hy, hz],
    [hx, hy, hz],
    [hx, -hy, hz],
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

function getObjectById(id: number | null) {
  return id == null ? null : editableObjects.get(id) ?? null
}

function getSelectedObject() {
  return getObjectById(selectedObjectId)
}

function getMirrorPartner(object: EditableObject | null) {
  if (!object) return null
  if (object.role === 'source') return getObjectById(object.mirroredById)
  return getObjectById(object.mirrorOfId)
}

function getSourceObject(object: EditableObject | null) {
  if (!object) return null
  if (object.role === 'source') return object
  return getObjectById(object.mirrorOfId)
}

function markInfoDirty() {
  infoDirty = true
}

function markObjectVerticesDirty(object: EditableObject, vertexIds: number[]) {
  vertexIds.forEach(id => object.dirtyVertexIds.add(id))
  markInfoDirty()
}

function markObjectTopologyDirty(object: EditableObject) {
  object.topologyDirty = true
  object.dirtyVertexIds.clear()
  markInfoDirty()
}

function flushObjectGeometry(object: EditableObject) {
  if (object.topologyDirty) {
    fillVertexPositionArray(object.geometryPosition.array as Float32Array, object.vertices)
    fillVertexPositionArray(object.edgePosition.array as Float32Array, object.vertices)
    object.geometryPosition.needsUpdate = true
    object.edgePosition.needsUpdate = true
    object.geometry.computeVertexNormals()
    object.geometry.computeBoundingBox()
    object.geometry.computeBoundingSphere()
    object.edgeGeometry.computeBoundingBox()
    object.edgeGeometry.computeBoundingSphere()
    object.topologyDirty = false
  } else if (object.dirtyVertexIds.size > 0) {
    object.dirtyVertexIds.forEach(vertexId => {
      const logicalVertex = object.vertices[vertexId]
      writeVertexToAttribute(object.geometryPosition, vertexId, logicalVertex.position)
      writeVertexToAttribute(object.edgePosition, vertexId, logicalVertex.position)
    })
    object.geometryPosition.needsUpdate = true
    object.edgePosition.needsUpdate = true
    object.geometry.computeVertexNormals()
    object.geometry.computeBoundingBox()
    object.geometry.computeBoundingSphere()
    object.edgeGeometry.computeBoundingBox()
    object.edgeGeometry.computeBoundingSphere()
  } else {
    return
  }

  object.dirtyVertexIds.clear()
  object.vertices.forEach(vertex => {
    const marker = object.markerGroup.children[vertex.id] as THREE.Mesh | undefined
    if (marker) marker.position.copy(vertex.position)
  })
}

function flushDirtyGeometry() {
  editableObjects.forEach(object => flushObjectGeometry(object))
}

function setMarkerColors(object: EditableObject) {
  object.markerGroup.children.forEach((child, index) => {
    const marker = child as THREE.Mesh
    const material = marker.material as THREE.MeshBasicMaterial
    const active = selectedObjectId === object.id && selectedVertexId === index
    material.color.setHex(active ? 0xffd43b : object.role === 'source' ? 0xff6b6b : 0x74c0fc)
  })
}

function updateObjectVisualState(object: EditableObject) {
  const material = object.mesh.material as THREE.MeshStandardMaterial
  const selected = selectedObjectId === object.id

  if (object.role === 'source') {
    material.emissive.setHex(selected ? 0x5c2a2a : 0x000000)
    material.opacity = selected ? 1 : 0.9
  } else {
    material.emissive.setHex(selected ? 0x16324a : 0x000000)
    material.opacity = selected ? 0.85 : 0.6
  }

  const edgeMaterial = object.edges.material as THREE.LineBasicMaterial
  edgeMaterial.color.setHex(selected ? 0xffd43b : object.role === 'source' ? 0xffffff : 0xb5f2ff)
}

function refreshAllMarkerStyles() {
  editableObjects.forEach(object => {
    object.markerGroup.visible = mirrorEditEnabled.value && selectedObjectId === object.id
    updateObjectVisualState(object)
    setMarkerColors(object)
  })
}

function updateBoundsText() {
  const selected = getSelectedObject()
  const mirror = getMirrorPartner(selected)
  const selectedBox = selected?.geometry.boundingBox ?? null
  const mirrorBox = mirror?.geometry.boundingBox ?? null

  info.selectedBounds = selectedBox
    ? `min(${selectedBox.min.x.toFixed(1)}, ${selectedBox.min.y.toFixed(1)}, ${selectedBox.min.z.toFixed(1)}) / max(${selectedBox.max.x.toFixed(1)}, ${selectedBox.max.y.toFixed(1)}, ${selectedBox.max.z.toFixed(1)})`
    : '未选择'

  info.mirrorBounds = mirrorBox
    ? `min(${mirrorBox.min.x.toFixed(1)}, ${mirrorBox.min.y.toFixed(1)}, ${mirrorBox.min.z.toFixed(1)}) / max(${mirrorBox.max.x.toFixed(1)}, ${mirrorBox.max.y.toFixed(1)}, ${mirrorBox.max.z.toFixed(1)})`
    : '暂无镜像体'
}

function updateMirrorStateText() {
  const selected = getSelectedObject()
  const mirror = getMirrorPartner(selected)

  if (!selected) {
    info.mirrorState = '先选择镜像面，再点击一个物体。'
  } else if (!mirror) {
    info.mirrorState = `当前选中 ${selected.name}，可沿 ${planeLabel(selectedPlane.value)} 生成镜像。`
  } else if (mirrorEditEnabled.value) {
    info.mirrorState = `镜像编辑中：拖动 ${selected.name} 的顶点时，会同步更新 ${mirror.name}。`
  } else {
    const plane = selected.mirrorPlane ?? mirror.mirrorPlane ?? selectedPlane.value
    info.mirrorState = `${selected.name} 与 ${mirror.name} 已通过 ${planeLabel(plane)} 建立镜像关系。`
  }
}

function updateMirrorPairText() {
  const selected = getSelectedObject()
  const mirror = getMirrorPartner(selected)
  if (!selected || !mirror) {
    info.mirrorPair = '暂无镜像关系'
    return
  }

  const plane = selected.mirrorPlane ?? mirror.mirrorPlane ?? selectedPlane.value
  info.mirrorPair = `${selected.name} <-> ${mirror.name} / ${planeLabel(plane)}`
}

function syncInfo() {
  if (infoDirty) {
    flushDirtyGeometry()
    infoDirty = false
  }

  const selected = getSelectedObject()
  info.selectedObject = selected ? selected.name : '未选择'
  info.selectedVertex = selectedVertexId == null ? '未选择' : `V${selectedVertexId}`
  updateMirrorPairText()
  updateMirrorStateText()
  updateBoundsText()
  refreshAllMarkerStyles()
}

function selectObject(objectId: number) {
  selectedObjectId = objectId
  selectedVertexId = null
  handle.visible = false
  three?.transform.detach()
  info.lastAction = `已选择 ${getObjectById(objectId)?.name ?? '物体'}。`
  syncInfo()
}

function clearSelection() {
  selectedObjectId = null
  selectedVertexId = null
  handle.visible = false
  mirrorEditEnabled.value = false
  three?.transform.detach()
  info.lastAction = '已清空选择。'
  syncInfo()
}

function selectVertex(vertexId: number) {
  const object = getSelectedObject()
  if (!object || !three) return

  selectedVertexId = vertexId
  handle.position.copy(object.vertices[vertexId].position)
  handle.visible = true
  three.transform.attach(handle)
  info.lastAction = `已选择 ${object.name} 的顶点 V${vertexId}，现在可以拖动编辑。`
  syncInfo()
}

function createEditableObject(options: {
  name: string
  role: ObjectRole
  vertices: EditableVertex[]
  color: number
  edgeColor: number
}) {
  if (!three) throw new Error('three is not ready')

  const meshData = createIndexedGeometry(options.vertices, meshIndex)
  meshData.geometry.computeVertexNormals()
  const edgeData = createIndexedGeometry(options.vertices, edgeIndex)

  const mesh = new THREE.Mesh(
    meshData.geometry,
    new THREE.MeshStandardMaterial({
      color: options.color,
      metalness: 0.05,
      roughness: 0.7,
      transparent: true,
      opacity: options.role === 'mirror' ? 0.6 : 0.9,
      side: THREE.DoubleSide
    })
  )
  const edges = new THREE.LineSegments(
    edgeData.geometry,
    new THREE.LineBasicMaterial({ color: options.edgeColor })
  )
  const markerGroup = new THREE.Group()

  const object: EditableObject = {
    id: nextObjectId++,
    name: options.name,
    role: options.role,
    vertices: cloneVertices(options.vertices),
    geometry: meshData.geometry,
    geometryPosition: meshData.position,
    edgeGeometry: edgeData.geometry,
    edgePosition: edgeData.position,
    mesh,
    edges,
    markerGroup,
    mirrorPlane: null,
    mirrorOfId: null,
    mirroredById: null,
    dirtyVertexIds: new Set(),
    topologyDirty: false
  }

  mesh.userData.objectId = object.id
  edges.userData.objectId = object.id

  object.vertices.forEach(vertex => {
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(6, 16, 16),
      new THREE.MeshBasicMaterial({ color: options.role === 'source' ? 0xff6b6b : 0x74c0fc })
    )
    marker.position.copy(vertex.position)
    marker.userData.vertexId = vertex.id
    marker.userData.objectId = object.id
    markerGroup.add(marker)
  })

  markerGroup.visible = false
  editableObjects.set(object.id, object)
  three.scene.add(mesh)
  three.scene.add(edges)
  three.scene.add(markerGroup)
  markObjectTopologyDirty(object)
  return object
}

function disposeObject(object: EditableObject) {
  editableObjects.delete(object.id)
  object.geometry.dispose()
  object.edgeGeometry.dispose()
  ;(object.mesh.material as THREE.Material).dispose()
  ;(object.edges.material as THREE.Material).dispose()

  object.markerGroup.children.forEach(child => {
    const marker = child as THREE.Mesh
    marker.geometry.dispose()
    ;(marker.material as THREE.Material).dispose()
  })

  object.mesh.parent?.remove(object.mesh)
  object.edges.parent?.remove(object.edges)
  object.markerGroup.parent?.remove(object.markerGroup)
}

function createInitialObjects() {
  const samples = [
    {
      name: 'Box A',
      center: new THREE.Vector3(45, 60, 40),
      size: new THREE.Vector3(90, 120, 80),
      color: 0xff8787,
      edgeColor: 0xffffff
    },
    {
      name: 'Box B',
      center: new THREE.Vector3(-130, 110, 120),
      size: new THREE.Vector3(80, 90, 110),
      color: 0x69db7c,
      edgeColor: 0xe9ecef
    }
  ]

  samples.forEach(sample => {
    createEditableObject({
      name: sample.name,
      role: 'source',
      vertices: createCuboidVertices(sample.center, sample.size),
      color: sample.color,
      edgeColor: sample.edgeColor
    })
  })
}

function updatePlaneMesh() {
  if (!planeMesh) return

  planeMesh.rotation.set(0, 0, 0)
  if (selectedPlane.value === 'yz') {
    planeMesh.rotation.y = Math.PI / 2
  } else if (selectedPlane.value === 'xz') {
    planeMesh.rotation.x = Math.PI / 2
  }

  info.selectedPlaneLabel = planeLabel(selectedPlane.value)
}

function applyMirrorToObject(object: EditableObject, plane: MirrorPlane) {
  const partner = getMirrorPartner(object)
  if (!partner) return

  object.vertices.forEach((vertex, index) => {
    partner.vertices[index].position.copy(reflectPoint(vertex.position, plane))
  })

  markObjectTopologyDirty(partner)
  partner.mirrorPlane = plane
  object.mirrorPlane = plane
}

function generateMirror() {
  const selected = getSelectedObject()
  if (!selected) {
    info.lastAction = '请先选中一个物体，再执行镜像生成。'
    syncInfo()
    return
  }

  const source = getSourceObject(selected)
  if (!source) return
  const existingMirror = getMirrorPartner(source)

  if (existingMirror && selectedObjectId === existingMirror.id) {
    selectedObjectId = source.id
  }

  if (existingMirror) {
    applyMirrorToObject(source, selectedPlane.value)
    existingMirror.name = `${source.name} Mirror`
    info.lastAction = `已按 ${planeLabel(selectedPlane.value)} 更新 ${source.name} 的镜像体。`
  } else {
    const mirroredVertices = source.vertices.map(vertex => ({
      id: vertex.id,
      position: reflectPoint(vertex.position, selectedPlane.value)
    }))

    const mirror = createEditableObject({
      name: `${source.name} Mirror`,
      role: 'mirror',
      vertices: mirroredVertices,
      color: 0x74c0fc,
      edgeColor: 0xb5f2ff
    })

    source.mirroredById = mirror.id
    source.mirrorPlane = selectedPlane.value
    mirror.mirrorOfId = source.id
    mirror.mirrorPlane = selectedPlane.value
    info.lastAction = `已沿 ${planeLabel(selectedPlane.value)} 为 ${source.name} 生成镜像体 ${mirror.name}。`
  }

  syncInfo()
}

function enterMirrorEdit() {
  const selected = getSelectedObject()
  if (!selected) {
    info.lastAction = '请先选择一个物体，再进入镜像编辑。'
    syncInfo()
    return
  }

  const partner = getMirrorPartner(selected)
  if (!partner) {
    mirrorEditEnabled.value = false
    info.lastAction = `${selected.name} 还没有建立对应镜像，无法进入镜像编辑。`
    syncInfo()
    return
  }

  mirrorEditEnabled.value = true
  info.lastAction = `已进入镜像编辑：${selected.name} 与 ${partner.name} 会保持对称更新。`
  syncInfo()
}

function exitMirrorEdit() {
  mirrorEditEnabled.value = false
  selectedVertexId = null
  handle.visible = false
  three?.transform.detach()
  info.lastAction = '已退出镜像编辑。'
  syncInfo()
}

function applyHandleToVertex() {
  const selected = getSelectedObject()
  if (!selected || selectedVertexId == null) return

  selected.vertices[selectedVertexId].position.copy(handle.position)
  markObjectVerticesDirty(selected, [selectedVertexId])

  if (mirrorEditEnabled.value) {
    const partner = getMirrorPartner(selected)
    const plane = selected.mirrorPlane ?? partner?.mirrorPlane ?? null
    if (partner && plane) {
      partner.vertices[selectedVertexId].position.copy(reflectPoint(handle.position, plane))
      markObjectVerticesDirty(partner, [selectedVertexId])
    }
  }

  syncInfo()
}

function resetDemo() {
  ;[...editableObjects.values()].forEach(disposeObject)
  selectedObjectId = null
  selectedVertexId = null
  mirrorEditEnabled.value = false
  nextObjectId = 1
  handle.visible = false
  three?.transform.detach()
  createInitialObjects()
  info.lastAction = '已重置示例。先选镜像面，再选中物体测试镜像生成和镜像编辑。'
  syncInfo()
}

watch(selectedPlane, () => {
  updatePlaneMesh()
  const selected = getSelectedObject()
  if (selected && !getMirrorPartner(selected)) {
    info.lastAction = `镜像基准面已切换为 ${planeLabel(selectedPlane.value)}。`
  }
  syncInfo()
})

watch(keepSourceVisible, () => {
  editableObjects.forEach(object => {
    if (object.role === 'source') {
      object.mesh.visible = keepSourceVisible.value
      object.edges.visible = keepSourceVisible.value
      if (!keepSourceVisible.value && selectedObjectId === object.id) {
        object.markerGroup.visible = false
      }
    }
  })
  refreshAllMarkerStyles()
})

onMounted(() => {
  three = createThreeBase(canvasRef.value!)
  const { scene, camera, orbit, raycaster, updateMouseFromEvent, transform } = three

  camera.position.set(360, 260, 360)
  orbit.target.set(0, 40, 0)

  scene.add(new THREE.AmbientLight(0xffffff, 1))
  const dir = new THREE.DirectionalLight(0xffffff, 1.1)
  dir.position.set(260, 320, 180)
  scene.add(dir)

  planeMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(520, 520),
    new THREE.MeshBasicMaterial({
      color: 0x40c057,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false
    })
  )
  scene.add(planeMesh)

  scene.add(handle)
  handle.visible = false

  createInitialObjects()
  updatePlaneMesh()
  syncInfo()

  transform.mode = 'translate'
  transform.showX = true
  transform.showY = true
  transform.showZ = true
  transform.addEventListener('dragging-changed', (event: any) => {
    isDraggingGizmo = event.value
  })
  transform.addEventListener('objectChange', () => {
    applyHandleToVertex()
  })

  const onPointerDown = (event: PointerEvent) => {
    if (!three || isDraggingGizmo) return

    updateMouseFromEvent(event)
    raycaster.setFromCamera(three.mouse, camera)

    if (mirrorEditEnabled.value && selectedObjectId != null) {
      const selected = getSelectedObject()
      const markerHit = raycaster.intersectObjects(selected?.markerGroup.children ?? [], false)[0]
      if (markerHit) {
        selectVertex(markerHit.object.userData.vertexId as number)
        return
      }
    }

    const meshHit = raycaster.intersectObjects(
      [...editableObjects.values()].map(object => object.mesh),
      false
    )[0]

    if (!meshHit) {
      clearSelection()
      return
    }

    selectObject(meshHit.object.userData.objectId as number)
  }

  canvasRef.value!.addEventListener('pointerdown', onPointerDown)
  cleanup.push(() => canvasRef.value?.removeEventListener('pointerdown', onPointerDown))

  three.start()
})

onBeforeUnmount(() => {
  cleanup.forEach(fn => fn())
  cleanup.length = 0

  ;[...editableObjects.values()].forEach(disposeObject)
  editableObjects.clear()

  if (planeMesh) {
    planeMesh.geometry.dispose()
    ;(planeMesh.material as THREE.Material).dispose()
    planeMesh.parent?.remove(planeMesh)
    planeMesh = null
  }

  three?.dispose()
  three = null
})
</script>

<template>
  <div style="display:flex; gap:16px; align-items:flex-start; flex-wrap:wrap;">
    <div style="width:820px;">
      <div style="margin-bottom:8px; line-height:1.8;">
        <button @click="selectedPlane = 'yz'">镜像面：YZ</button>
        <button @click="selectedPlane = 'xz'" style="margin-left:6px;">镜像面：XZ</button>
        <button @click="selectedPlane = 'xy'" style="margin-left:6px;">镜像面：XY</button>
        <span style="margin-left:12px; opacity:0.82;">
          当前镜像基准面：{{ info.selectedPlaneLabel }}，都以世界原点处的基准面作为镜像面。
        </span>
      </div>

      <div style="margin-bottom:8px; line-height:1.8;">
        <button @click="generateMirror">镜像生成</button>
        <button @click="enterMirrorEdit" style="margin-left:6px;">镜像编辑</button>
        <button @click="exitMirrorEdit" style="margin-left:6px;">退出镜像编辑</button>
        <button @click="resetDemo" style="margin-left:6px;">重置</button>
      </div>

      <div style="margin-bottom:8px; opacity:0.82; line-height:1.7;">
        这版底层已经改成“索引缓冲 + 脏顶点更新”。拖动时只更新变脏的顶点 attribute，不再反复 dispose / new geometry。
      </div>

      <div style="width:800px; height:620px; border:1px solid #2a2a2a; border-radius:10px; overflow:hidden;">
        <canvas ref="canvasRef" style="width:800px; height:620px; display:block;" />
      </div>
    </div>

    <div style="width:420px; display:flex; flex-direction:column; gap:12px;">
      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">操作流程</div>
        <div>1. 先选择世界镜像面：YZ / XZ / XY。</div>
        <div>2. 点击场景中的物体，然后点击“镜像生成”。</div>
        <div>3. 如果该物体已有镜像，再点击“镜像编辑”。</div>
        <div>4. 进入镜像编辑后，点击顶点并拖动，两边对应点会同步更新。</div>
      </div>

      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">显示控制</div>
        <label style="display:flex; align-items:center; gap:8px;">
          <input v-model="keepSourceVisible" type="checkbox" />
          <span>显示原始物体</span>
        </label>
        <div style="margin-top:8px; opacity:0.82;">镜像对称轴：{{ axisLabel(selectedPlane) }} 轴方向取反</div>
        <div style="margin-top:4px; opacity:0.82;">{{ info.mirrorState }}</div>
      </div>

      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">当前状态</div>
        <div>当前物体：{{ info.selectedObject }}</div>
        <div>当前顶点：{{ info.selectedVertex }}</div>
        <div>镜像关系：{{ info.mirrorPair }}</div>
        <div>当前物体包围盒：{{ info.selectedBounds }}</div>
        <div>镜像物体包围盒：{{ info.mirrorBounds }}</div>
      </div>

      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">这版底层重点</div>
        <div>固定拓扑时：只更新 position attribute。</div>
        <div>整体变化时：标记 topology dirty，然后整块刷新 buffer。</div>
        <div>索引缓冲复用：mesh 和 edges 的 index 都固定复用。</div>
      </div>

      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">最近操作</div>
        <div>{{ info.lastAction }}</div>
      </div>
    </div>
  </div>
</template>
