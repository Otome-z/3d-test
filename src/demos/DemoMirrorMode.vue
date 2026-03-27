<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import * as THREE from 'three'
import { createThreeBase } from '@/composables/useThreeBase'

type LogicalVertex = {
  id: number
  position: THREE.Vector3
  seam: boolean
}

type QuadFace = {
  name: string
  verts: [number, number, number, number]
  seam?: boolean
}

const canvasRef = ref<HTMLCanvasElement | null>(null)

const mirrorEditEnabled = ref(false)
const generatedVisible = ref(false)
const keepHalfVisible = ref(true)

const info = reactive({
  selectedVertex: 'none',
  mirrorState: 'mirror result hidden',
  halfBounds: '',
  fullBounds: '',
  lastAction: 'Select a vertex on the right-half cuboid, then drag the gizmo to edit it.'
})

let three: ReturnType<typeof createThreeBase> | null = null
let halfMesh: THREE.Mesh | null = null
let halfEdges: THREE.LineSegments | null = null
let fullMesh: THREE.Mesh | null = null
let fullEdges: THREE.LineSegments | null = null
let mirrorPlaneMesh: THREE.Mesh | null = null
let markerGroup: THREE.Group | null = null
const vertexMarkers = new Map<number, THREE.Mesh>()
const handle = new THREE.Object3D()
const cleanup: Array<() => void> = []

let isDraggingGizmo = false
let selectedVertexId: number | null = null
let logicalVertices: LogicalVertex[] = []
let generatedGeometry: THREE.BufferGeometry | null = null

const halfFaces: QuadFace[] = [
  { name: 'seam', verts: [0, 3, 2, 1], seam: true },
  { name: 'outer', verts: [4, 5, 6, 7] },
  { name: 'bottom', verts: [0, 4, 7, 3] },
  { name: 'top', verts: [1, 2, 6, 5] },
  { name: 'back', verts: [0, 1, 5, 4] },
  { name: 'front', verts: [3, 7, 6, 2] }
]

function createInitialVertices() {
  logicalVertices = [
    { id: 0, position: new THREE.Vector3(0, -60, -60), seam: true },
    { id: 1, position: new THREE.Vector3(0, 60, -60), seam: true },
    { id: 2, position: new THREE.Vector3(0, 60, 60), seam: true },
    { id: 3, position: new THREE.Vector3(0, -60, 60), seam: true },
    { id: 4, position: new THREE.Vector3(90, -60, -60), seam: false },
    { id: 5, position: new THREE.Vector3(90, 60, -60), seam: false },
    { id: 6, position: new THREE.Vector3(90, 60, 60), seam: false },
    { id: 7, position: new THREE.Vector3(90, -60, 60), seam: false }
  ]
}

function getLogicalVertex(id: number) {
  return logicalVertices.find(item => item.id === id)!
}

function buildGeometryFromFaces(faces: QuadFace[]) {
  const positions: number[] = []

  for (const face of faces) {
    const [a, b, c, d] = face.verts.map(id => getLogicalVertex(id).position)
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

function mirrorGeometryX(source: THREE.BufferGeometry) {
  const mirrored = source.clone()
  const position = mirrored.getAttribute('position') as THREE.BufferAttribute

  for (let i = 0; i < position.count; i++) {
    position.setXYZ(i, -position.getX(i), position.getY(i), position.getZ(i))
  }

  for (let i = 0; i < position.count; i += 3) {
    for (let k = 0; k < position.itemSize; k++) {
      const temp = position.array[(i + 1) * position.itemSize + k]
      position.array[(i + 1) * position.itemSize + k] = position.array[(i + 2) * position.itemSize + k]
      position.array[(i + 2) * position.itemSize + k] = temp
    }
  }

  position.needsUpdate = true
  mirrored.computeVertexNormals()
  mirrored.computeBoundingBox()
  mirrored.computeBoundingSphere()
  return mirrored
}

function mergePositions(geometries: THREE.BufferGeometry[]) {
  const chunks = geometries.map(item => Array.from((item.getAttribute('position') as THREE.BufferAttribute).array as ArrayLike<number>))
  const positions = chunks.flat()
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function buildHalfGeometry() {
  return buildGeometryFromFaces(halfFaces)
}

function buildFullGeometry() {
  const visibleHalf = buildGeometryFromFaces(halfFaces.filter(face => !face.seam))
  const mirroredHalf = mirrorGeometryX(visibleHalf)
  const merged = mergePositions([visibleHalf, mirroredHalf])
  visibleHalf.dispose()
  mirroredHalf.dispose()
  return merged
}

function createEdges(geometry: THREE.BufferGeometry, color: number, opacity = 1) {
  return new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity })
  )
}

function disposeRenderable(object: THREE.Object3D | null) {
  if (!object) return

  object.traverse(item => {
    if (!(item instanceof THREE.Mesh || item instanceof THREE.LineSegments)) return
    item.geometry.dispose()
    const material = item.material
    if (Array.isArray(material)) material.forEach(entry => entry.dispose())
    else material.dispose()
  })

  object.parent?.remove(object)
}

function updateMarkerPositions() {
  logicalVertices.forEach(vertex => {
    const marker = vertexMarkers.get(vertex.id)
    if (!marker) return
    marker.position.copy(vertex.position)
    const material = marker.material as THREE.MeshBasicMaterial
    material.color.setHex(
      selectedVertexId === vertex.id ? 0xffd43b : vertex.seam ? 0x40c057 : 0xff6b6b
    )
  })
}

function updateBoundsText() {
  if (!halfMesh) return

  const halfBox = halfMesh.geometry.boundingBox
  info.halfBounds = halfBox
    ? `min(${halfBox.min.x.toFixed(1)}, ${halfBox.min.y.toFixed(1)}, ${halfBox.min.z.toFixed(1)}) / max(${halfBox.max.x.toFixed(1)}, ${halfBox.max.y.toFixed(1)}, ${halfBox.max.z.toFixed(1)})`
    : ''

  const fullBox = generatedGeometry?.boundingBox ?? null
  info.fullBounds = fullBox
    ? `min(${fullBox.min.x.toFixed(1)}, ${fullBox.min.y.toFixed(1)}, ${fullBox.min.z.toFixed(1)}) / max(${fullBox.max.x.toFixed(1)}, ${fullBox.max.y.toFixed(1)}, ${fullBox.max.z.toFixed(1)})`
    : 'not generated'
}

function refreshHalfMesh() {
  if (!halfMesh || !halfEdges) return

  const nextGeometry = buildHalfGeometry()
  halfMesh.geometry.dispose()
  halfMesh.geometry = nextGeometry

  disposeRenderable(halfEdges)
  halfEdges = createEdges(nextGeometry, 0xffffff)
  halfMesh.parent?.add(halfEdges)

  updateMarkerPositions()
  updateBoundsText()
}

function refreshGeneratedGeometry() {
  if (!fullMesh || !fullEdges) return

  const nextGeometry = buildFullGeometry()
  generatedGeometry?.dispose()
  generatedGeometry = nextGeometry.clone()

  fullMesh.geometry.dispose()
  fullMesh.geometry = nextGeometry

  disposeRenderable(fullEdges)
  fullEdges = createEdges(nextGeometry, 0xffec99, 0.9)
  fullMesh.parent?.add(fullEdges)

  generatedVisible.value = true
  updateBoundsText()
}

function syncVisibleState() {
  if (!halfMesh || !halfEdges || !fullMesh || !fullEdges || !markerGroup) return

  fullMesh.visible = generatedVisible.value
  fullEdges.visible = generatedVisible.value
  halfMesh.visible = keepHalfVisible.value || !generatedVisible.value
  halfEdges.visible = keepHalfVisible.value || !generatedVisible.value
  markerGroup.visible = true

  info.mirrorState = mirrorEditEnabled.value
    ? 'mirror edit ON: dragging the right-half updates the mirrored left-half in real time'
    : generatedVisible.value
      ? 'mirror edit OFF: editing only changes the right-half; the full result stays at the last generated state'
      : 'mirror result hidden'
}

function selectVertex(id: number) {
  if (!three) return

  selectedVertexId = id
  const vertex = getLogicalVertex(id)
  handle.position.copy(vertex.position)
  handle.visible = true
  three.transform.attach(handle)
  info.selectedVertex = `V${id}${vertex.seam ? ' (seam)' : ''}`
  info.lastAction = `Selected V${id}. Drag the gizmo to edit the half cuboid.`
  updateMarkerPositions()
}

function clearSelection() {
  selectedVertexId = null
  info.selectedVertex = 'none'
  handle.visible = false
  three?.transform.detach()
  updateMarkerPositions()
}

function applyHandleToLogicalVertex() {
  if (selectedVertexId == null) return

  const vertex = getLogicalVertex(selectedVertexId)
  if (vertex.seam) {
    vertex.position.set(0, handle.position.y, handle.position.z)
  } else {
    vertex.position.set(Math.max(16, handle.position.x), handle.position.y, handle.position.z)
  }

  handle.position.copy(vertex.position)
  refreshHalfMesh()

  if (mirrorEditEnabled.value) {
    refreshGeneratedGeometry()
  }
}

function generateMirroredModel() {
  refreshGeneratedGeometry()
  syncVisibleState()
  info.lastAction = 'Generated a full mirrored cuboid from the current right-half model.'
}

function clearMirroredModel() {
  generatedVisible.value = false
  syncVisibleState()
  info.fullBounds = 'not generated'
  info.lastAction = 'Cleared the mirrored full model. You are editing only the right-half now.'
}

function resetDemo() {
  createInitialVertices()
  clearSelection()
  mirrorEditEnabled.value = false
  generatedVisible.value = false
  keepHalfVisible.value = true
  refreshHalfMesh()
  syncVisibleState()
  info.lastAction = 'Reset to the initial half cuboid. Generate a mirror again when needed.'
}

watch([mirrorEditEnabled, keepHalfVisible], () => {
  if (mirrorEditEnabled.value) {
    refreshGeneratedGeometry()
  }
  syncVisibleState()
})

onMounted(() => {
  three = createThreeBase(canvasRef.value!)
  const { scene, camera, orbit, raycaster, updateMouseFromEvent, transform } = three

  camera.position.set(320, 220, 320)
  orbit.target.set(20, 0, 0)

  scene.add(new THREE.AmbientLight(0xffffff, 1))
  const dir = new THREE.DirectionalLight(0xffffff, 1.2)
  dir.position.set(260, 320, 180)
  scene.add(dir)

  scene.add(handle)
  handle.visible = false

  mirrorPlaneMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(280, 220),
    new THREE.MeshBasicMaterial({
      color: 0x40c057,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false
    })
  )
  mirrorPlaneMesh.rotation.y = Math.PI / 2
  scene.add(mirrorPlaneMesh)

  halfMesh = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshStandardMaterial({
      color: 0x4dabf7,
      metalness: 0.04,
      roughness: 0.72,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide
    })
  )
  scene.add(halfMesh)

  halfEdges = createEdges(new THREE.BoxGeometry(1, 1, 1), 0xffffff)
  scene.add(halfEdges)

  fullMesh = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshStandardMaterial({
      color: 0xffd43b,
      metalness: 0.02,
      roughness: 0.5,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  )
  scene.add(fullMesh)

  fullEdges = createEdges(new THREE.BoxGeometry(1, 1, 1), 0xffec99, 0.9)
  scene.add(fullEdges)

  markerGroup = new THREE.Group()
  scene.add(markerGroup)

  createInitialVertices()

  logicalVertices.forEach(vertex => {
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(vertex.seam ? 6 : 7, 18, 18),
      new THREE.MeshBasicMaterial({ color: vertex.seam ? 0x40c057 : 0xff6b6b })
    )
    marker.userData.vertexId = vertex.id
    markerGroup!.add(marker)
    vertexMarkers.set(vertex.id, marker)
  })

  transform.mode = 'translate'
  transform.addEventListener('dragging-changed', (event: any) => {
    isDraggingGizmo = event.value
  })
  transform.addEventListener('objectChange', () => {
    applyHandleToLogicalVertex()
  })

  const onPointerDown = (event: PointerEvent) => {
    if (!three || isDraggingGizmo) return

    updateMouseFromEvent(event)
    raycaster.setFromCamera(three.mouse, camera)
    const hit = raycaster.intersectObjects([...vertexMarkers.values()], false)[0]
    if (!hit) {
      clearSelection()
      return
    }

    selectVertex(hit.object.userData.vertexId as number)
  }

  canvasRef.value!.addEventListener('pointerdown', onPointerDown)
  cleanup.push(() => canvasRef.value?.removeEventListener('pointerdown', onPointerDown))

  refreshHalfMesh()
  syncVisibleState()
  three.start()
})

onBeforeUnmount(() => {
  cleanup.forEach(fn => fn())
  cleanup.length = 0

  generatedGeometry?.dispose()
  disposeRenderable(halfEdges)
  disposeRenderable(fullEdges)
  disposeRenderable(halfMesh)
  disposeRenderable(fullMesh)
  disposeRenderable(mirrorPlaneMesh)
  disposeRenderable(markerGroup)

  vertexMarkers.clear()
  three?.dispose()
  three = null
})
</script>

<template>
  <div style="display:flex; gap:16px; align-items:flex-start; flex-wrap:wrap;">
    <div style="width:820px;">
      <div style="margin-bottom:8px; line-height:1.7;">
        <button @click="generateMirroredModel">生成完整镜像体</button>
        <button @click="clearMirroredModel" style="margin-left:6px;">隐藏完整体</button>
        <button @click="resetDemo" style="margin-left:6px;">重置</button>
        <span style="margin-left:12px; opacity:0.82;">当前只编辑右半边，镜像平面固定在 X = 0。</span>
      </div>

      <div style="width:800px; height:620px; border:1px solid #2a2a2a; border-radius:10px; overflow:hidden;">
        <canvas ref="canvasRef" style="width:800px; height:620px; display:block;" />
      </div>
    </div>

    <div style="width:420px; display:flex; flex-direction:column; gap:12px;">
      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">镜像模式</div>
        <label style="display:flex; align-items:center; gap:8px;">
          <input v-model="mirrorEditEnabled" type="checkbox" />
          <span>进入镜像编辑</span>
        </label>
        <label style="display:flex; align-items:center; gap:8px; margin-top:8px;">
          <input v-model="keepHalfVisible" type="checkbox" />
          <span>显示右半边原模型</span>
        </label>
        <div style="margin-top:8px; opacity:0.82;">{{ info.mirrorState }}</div>
      </div>

      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">编辑说明</div>
        <div>红点是可编辑的外侧顶点，绿点是中线缝合顶点。</div>
        <div>选中一个点后，用 gizmo 拖动它，就能把半个长方体改成别的形状。</div>
        <div>开启“镜像编辑”后，左半边会实时跟随右半边同步更新。</div>
        <div>关闭“镜像编辑”后，你仍然可以继续改右半边，但左半边只保留上次生成的结果。</div>
      </div>

      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">当前状态</div>
        <div>选中顶点：{{ info.selectedVertex }}</div>
        <div>右半边包围盒：{{ info.halfBounds }}</div>
        <div>完整体包围盒：{{ info.fullBounds }}</div>
      </div>

      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">最近一次操作</div>
        <div>{{ info.lastAction }}</div>
      </div>
    </div>
  </div>
</template>
