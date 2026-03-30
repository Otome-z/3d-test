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
  mesh: THREE.Mesh
  edges: THREE.LineSegments
  markerGroup: THREE.Group
  mirrorPlane: MirrorPlane | null
  mirrorOfId: number | null
  mirroredById: number | null
}

type QuadFace = {
  verts: [number, number, number, number]
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
  lastAction: '点击场景中的物体以选中，然后使用右侧按钮。',
  selectedBounds: '',
  mirrorBounds: ''
})

const cubeFaces: QuadFace[] = [
  { verts: [0, 1, 2, 3] },
  { verts: [4, 7, 6, 5] },
  { verts: [0, 4, 5, 1] },
  { verts: [1, 5, 6, 2] },
  { verts: [2, 6, 7, 3] },
  { verts: [3, 7, 4, 0] }
]

let three: ReturnType<typeof createThreeBase> | null = null
let planeMesh: THREE.Mesh | null = null
const handle = new THREE.Object3D()
const cleanup: Array<() => void> = []

const editableObjects = new Map<number, EditableObject>()
const markerToObjectId = new Map<THREE.Object3D, number>()
let nextObjectId = 1
let selectedObjectId: number | null = null
let selectedVertexId: number | null = null
let isDraggingGizmo = false

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

function buildGeometry(vertices: EditableVertex[]) {
  const positions: number[] = []

  for (const face of cubeFaces) {
    const [a, b, c, d] = face.verts.map(index => vertices[index].position)
    positions.push(
      a.x, a.y, a.z,
      b.x, b.y, b.z,
      c.x, c.y, c.z,
      a.x, a.y, a.z,
      c.x, c.y, c.z,
      d.x, d.y, d.z
    )
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function createEdges(geometry: THREE.BufferGeometry, color: number) {
  return new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color })
  )
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

  console.log({
    hx,hy,hz
  })
  const corners = [
    [-hx, -hy, -hz],
    [hx, -hy, -hz],
    [hx, hy, -hz],
    [-hx, hy, -hz],

    [-hx, hy, hz],
    [-hx, -hy, hz],
    [hx, -hy, hz],
    [hx, hy, hz],


    // [-hx, -hy, hz],
    // [-hx, hy, hz],
    // [hx, hy, hz],
    // [hx, -hy, hz]
  ] as const

  return corners.map(([x, y, z], index) => ({
    id: index,
    position: new THREE.Vector3(center.x + x, center.y + y, center.z + z)
  }))
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

function updateObjectGeometry(object: EditableObject) {
  const nextGeometry = buildGeometry(object.vertices)
  object.mesh.geometry.dispose()
  object.mesh.geometry = nextGeometry

  object.edges.geometry.dispose()
  object.edges.geometry = new THREE.EdgesGeometry(nextGeometry)

  object.vertices.forEach(vertex => {
    const marker = object.markerGroup.children[vertex.id] as THREE.Mesh | undefined
    if (!marker) return
    marker.position.copy(vertex.position)
  })
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
  const selectedBox = selected?.mesh.geometry.boundingBox ?? null
  const mirrorBox = mirror?.mesh.geometry.boundingBox ?? null

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

  const geometry = buildGeometry(options.vertices)
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: options.color,
      metalness: 0.05,
      roughness: 0.7,
      transparent: true,
      opacity: options.role === 'mirror' ? 0.6 : 0.9,
      side: THREE.DoubleSide
    })
  )
  const edges = createEdges(geometry, options.edgeColor)
  const markerGroup = new THREE.Group()

  const object: EditableObject = {
    id: nextObjectId++,
    name: options.name,
    role: options.role,
    vertices: cloneVertices(options.vertices),
    mesh,
    edges,
    markerGroup,
    mirrorPlane: null,
    mirrorOfId: null,
    mirroredById: null
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
    markerToObjectId.set(marker, object.id)
  })

  markerGroup.visible = false
  editableObjects.set(object.id, object)
  three.scene.add(mesh)
  three.scene.add(edges)
  three.scene.add(markerGroup)
  return object
}

function disposeObject(object: EditableObject) {
  editableObjects.delete(object.id)
  object.mesh.geometry.dispose()
  ;(object.mesh.material as THREE.Material).dispose()
  object.edges.geometry.dispose()
  ;(object.edges.material as THREE.Material).dispose()
  object.markerGroup.children.forEach(child => {
    markerToObjectId.delete(child)
    const mesh = child as THREE.Mesh
    mesh.geometry.dispose()
    ;(mesh.material as THREE.Material).dispose()
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

  updateObjectGeometry(partner)
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
    source.mirrorPlane = selectedPlane.value
    existingMirror.mirrorPlane = selectedPlane.value
    existingMirror.name = `${source.name} Mirror`
    info.lastAction = `已重新按 ${planeLabel(selectedPlane.value)} 更新 ${source.name} 的镜像体。`
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
    info.lastAction = `${selected.name} 还没有通过“镜像生成”建立对应镜像，无法进入镜像编辑。`
    syncInfo()
    return
  }

  mirrorEditEnabled.value = true
  info.lastAction = `已进入镜像编辑：${selected.name} 与 ${partner.name} 会保持对称更新。`
  syncInfo()
}

function exitMirrorEdit() {
  mirrorEditEnabled.value = false
  info.lastAction = '已退出镜像编辑。'
  selectedVertexId = null
  handle.visible = false
  three?.transform.detach()
  syncInfo()
}

function applyHandleToVertex() {
  const selected = getSelectedObject()
  if (!selected || selectedVertexId == null) return

  selected.vertices[selectedVertexId].position.copy(handle.position)
  updateObjectGeometry(selected)

  if (mirrorEditEnabled.value) {
    const partner = getMirrorPartner(selected)
    const plane = selected.mirrorPlane ?? partner?.mirrorPlane ?? null
    if (partner && plane) {
      partner.vertices[selectedVertexId].position.copy(reflectPoint(handle.position, plane))
      updateObjectGeometry(partner)
    }
  }

  syncInfo()
}

function resetDemo() {
  const objects = [...editableObjects.values()]
  objects.forEach(disposeObject)
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
      const markerHits = raycaster.intersectObjects(selected?.markerGroup.children ?? [], false)
      const markerHit = markerHits[0]
      if (markerHit) {
        selectVertex(markerHit.object.userData.vertexId as number)
        return
      }
    }

    const meshHits = raycaster.intersectObjects(
      [...editableObjects.values()].flatMap(object => [object.mesh]),
      false
    )
    const meshHit = meshHits[0]
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
  markerToObjectId.clear()

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
          当前镜像基准面：{{ info.selectedPlaneLabel }}，都以世界原点处的基准面为镜像面。
        </span>
      </div>

      <div style="margin-bottom:8px; line-height:1.8;">
        <button @click="generateMirror">镜像生成</button>
        <button @click="enterMirrorEdit" style="margin-left:6px;">镜像编辑</button>
        <button @click="exitMirrorEdit" style="margin-left:6px;">退出镜像编辑</button>
        <button @click="resetDemo" style="margin-left:6px;">重置</button>
      </div>

      <div style="width:800px; height:620px; border:1px solid #2a2a2a; border-radius:10px; overflow:hidden;">
        <canvas ref="canvasRef" style="width:800px; height:620px; display:block;" />
      </div>
    </div>

    <div style="width:420px; display:flex; flex-direction:column; gap:12px;">
      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">操作流程</div>
        <div>1. 先点上方按钮选择世界镜像面：YZ / XZ / XY。</div>
        <div>2. 再点击场景中的物体，然后点“镜像生成”。</div>
        <div>3. 如果该物体已有镜像，再点“镜像编辑”，拖动顶点时两边会同步更新。</div>
        <div>4. 如果没有对应镜像，点击“镜像编辑”会直接提示。</div>
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
        <div style="font-weight:700; margin-bottom:10px;">最近操作</div>
        <div>{{ info.lastAction }}</div>
      </div>
    </div>
  </div>
</template>
