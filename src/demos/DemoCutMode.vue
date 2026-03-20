<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import * as THREE from 'three'
import { createThreeBase } from '@/composables/useThreeBase'

type SelectMode = 'vertex' | 'edge' | 'face'

type TopoVertex = {
  id: number
  position: THREE.Vector3
}

type TopoFace = {
  id: number
  verts: number[]
}

type EdgeInfo = {
  key: string
  a: number
  b: number
  faceIds: number[]
  kind: 'boundary' | 'internal'
}

const canvasRef = ref<HTMLCanvasElement | null>(null)

let three: ReturnType<typeof createThreeBase> | null = null
let rootGroup: THREE.Group | null = null
let labelSprites: THREE.Sprite[] = []

const mode = ref<SelectMode>('face')
const extrudeDistance = ref(60)
const insetRatio = ref(0.68)
const bevelInsetRatio = ref(0.82)
const bevelHeight = ref(14)

const info = reactive({
  selectedVertices: '无',
  selectedEdge: '无',
  selectedFace: '无',
  vertexList: '',
  indexList: '[]',
  edgeList: '',
  faceList: '',
  stageSummary: '第四阶段：进入真正的拓扑编辑。当前重点放在 Cut / Extrude / Inset / Bevel 简化版。',
  lastAction: '先选择点 / 边 / 面，再执行右侧操作。',
  canSwap: '否'
})

let vertices: TopoVertex[] = []
let faces: TopoFace[] = []
let selectedVertexIds: number[] = []
let selectedEdgeKey: string | null = null
let selectedFaceId: number | null = null

const vertexObjects = new Map<number, THREE.Mesh>()
const edgeObjects = new Map<string, THREE.Line>()
const faceObjects = new Map<number, THREE.Mesh>()
const cleanup: Array<() => void> = []

function sortEdge(a: number, b: number) {
  return a < b ? [a, b] as [number, number] : [b, a] as [number, number]
}

function edgeKey(a: number, b: number) {
  const [i0, i1] = sortEdge(a, b)
  return `${i0}_${i1}`
}

function nextVertexId() {
  return vertices.length ? Math.max(...vertices.map(item => item.id)) + 1 : 0
}

function nextFaceId() {
  return faces.length ? Math.max(...faces.map(item => item.id)) + 1 : 0
}

function getVertex(id: number) {
  return vertices.find(item => item.id === id) ?? null
}

function getFace(id: number) {
  return faces.find(item => item.id === id) ?? null
}

function createInitialTopology() {
  vertices = [
    { id: 0, position: new THREE.Vector3(-120, 0, -120) },
    { id: 1, position: new THREE.Vector3(120, 0, -120) },
    { id: 2, position: new THREE.Vector3(120, 0, 120) },
    { id: 3, position: new THREE.Vector3(-120, 0, 120) }
  ]

  faces = [
    { id: 0, verts: [0, 1, 2, 3] }
  ]

  selectedVertexIds = []
  selectedEdgeKey = null
  selectedFaceId = 0
}

function buildTextLabel(text: string, color: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 220
  canvas.height = 76
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.68)'
  ctx.fillRect(12, 12, 196, 48)
  ctx.strokeStyle = color
  ctx.lineWidth = 3
  ctx.strokeRect(12, 12, 196, 48)
  ctx.fillStyle = color
  ctx.font = 'bold 24px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, canvas.width / 2, canvas.height / 2)

  const texture = new THREE.CanvasTexture(canvas)
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false
    })
  )
  sprite.scale.set(48, 16, 1)
  sprite.renderOrder = 50
  labelSprites.push(sprite)
  return sprite
}

function clearLabels() {
  labelSprites.forEach(sprite => {
    const material = sprite.material as THREE.SpriteMaterial
    material.map?.dispose()
    material.dispose()
  })
  labelSprites = []
}

function deriveEdges() {
  const map = new Map<string, EdgeInfo>()

  for (const face of faces) {
    for (let i = 0; i < face.verts.length; i++) {
      const a = face.verts[i]
      const b = face.verts[(i + 1) % face.verts.length]
      const [i0, i1] = sortEdge(a, b)
      const key = edgeKey(i0, i1)
      const existing = map.get(key)
      if (existing) {
        existing.faceIds.push(face.id)
      } else {
        map.set(key, { key, a: i0, b: i1, faceIds: [face.id], kind: 'boundary' })
      }
    }
  }

  return [...map.values()].map(item => ({
    ...item,
    kind: item.faceIds.length > 1 ? 'internal' : 'boundary'
  }))
}

function getFaceNormal(face: TopoFace) {
  const normal = new THREE.Vector3()
  for (let i = 0; i < face.verts.length; i++) {
    const curr = getVertex(face.verts[i])!.position
    const next = getVertex(face.verts[(i + 1) % face.verts.length])!.position
    normal.x += (curr.y - next.y) * (curr.z + next.z)
    normal.y += (curr.z - next.z) * (curr.x + next.x)
    normal.z += (curr.x - next.x) * (curr.y + next.y)
  }
  if (normal.lengthSq() < 1e-6 && face.verts.length >= 3) {
    const a = getVertex(face.verts[0])!.position
    const b = getVertex(face.verts[1])!.position
    const c = getVertex(face.verts[2])!.position
    normal.copy(b.clone().sub(a).cross(c.clone().sub(a)))
  }
  return normal.normalize()
}

function getFaceCenter(face: TopoFace) {
  const center = new THREE.Vector3()
  face.verts.forEach(id => center.add(getVertex(id)!.position))
  return center.multiplyScalar(1 / face.verts.length)
}

function buildFaceGeometry(face: TopoFace) {
  const triangleCount = Math.max(0, face.verts.length - 2)
  const positions = new Float32Array(triangleCount * 9)

  for (let i = 1; i < face.verts.length - 1; i++) {
    const a = getVertex(face.verts[0])!.position
    const b = getVertex(face.verts[i])!.position
    const c = getVertex(face.verts[i + 1])!.position
    const offset = (i - 1) * 9
    positions.set([
      a.x, a.y, a.z,
      b.x, b.y, b.z,
      c.x, c.y, c.z
    ], offset)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return geometry
}

function setSelectedFace(id: number | null) {
  selectedFaceId = id
  if (id != null) {
    const face = getFace(id)
    if (face) {
      selectedEdgeKey = null
      selectedVertexIds = face.verts.slice(0, Math.min(face.verts.length, 2))
    }
  }
}

function getCurrentDiagonal() {
  const edge = selectedEdgeKey
    ? deriveEdges().find(item => item.key === selectedEdgeKey && item.kind === 'internal')
    : null
  if (edge) return edge
  return deriveEdges().find(item => item.kind === 'internal') ?? null
}

function splitQuadFaceByDiagonal(faceId: number, a: number, b: number) {
  const face = getFace(faceId)
  if (!face || face.verts.length !== 4) return false

  const [v0, v1, v2, v3] = face.verts
  const is02 = (a === v0 && b === v2) || (a === v2 && b === v0)
  const is13 = (a === v1 && b === v3) || (a === v3 && b === v1)
  if (!is02 && !is13) return false

  faces = faces.filter(item => item.id !== faceId)
  if (is02) {
    faces.push(
      { id: faceId, verts: [v0, v1, v2] },
      { id: nextFaceId(), verts: [v0, v2, v3] }
    )
    selectedEdgeKey = edgeKey(v0, v2)
  } else {
    faces.push(
      { id: faceId, verts: [v1, v2, v3] },
      { id: nextFaceId(), verts: [v1, v3, v0] }
    )
    selectedEdgeKey = edgeKey(v1, v3)
  }

  return true
}

function faceContainsVertices(face: TopoFace, a: number, b: number) {
  return face.verts.includes(a) && face.verts.includes(b)
}

function areAdjacentInFace(face: TopoFace, a: number, b: number) {
  for (let i = 0; i < face.verts.length; i++) {
    const curr = face.verts[i]
    const next = face.verts[(i + 1) % face.verts.length]
    if ((curr === a && next === b) || (curr === b && next === a)) return true
  }
  return false
}

function connectSelectedVertices() {
  if (selectedVertexIds.length !== 2) return
  const [a, b] = selectedVertexIds
  const quad = faces.find(face => face.verts.length === 4 && faceContainsVertices(face, a, b))
  if (!quad || areAdjacentInFace(quad, a, b)) {
    info.lastAction = '当前这两个点不能直接作为同一个四边形的对角线。'
    return
  }

  const ok = splitQuadFaceByDiagonal(quad.id, a, b)
  if (!ok) {
    info.lastAction = '连边失败，当前只支持在单个四边形内连接对角点。'
    return
  }

  info.lastAction = `把 V${a} 和 V${b} 连成了一条对角线，同时重建了 index / 边关系 / 面关系。`
  rebuildScene()
}

function cutDefaultDiagonal() {
  const face = getFace(selectedFaceId ?? -1) ?? faces.find(item => item.verts.length === 4) ?? null
  if (!face || face.verts.length !== 4) {
    info.lastAction = '请先选中一个四边形面。'
    return
  }

  const [a, , c] = face.verts
  selectedVertexIds = [a, c]
  const ok = splitQuadFaceByDiagonal(face.id, a, c)
  if (!ok) return

  info.lastAction = `在四边形 F${face.id} 的两个对角点之间切了一刀。`
  rebuildScene()
}

function findBoundaryCycleFromTwoTriangles(faceA: TopoFace, faceB: TopoFace, shared: string) {
  const map = new Map<number, Set<number>>()

  const addBoundaryEdge = (a: number, b: number) => {
    if (edgeKey(a, b) === shared) return
    if (!map.has(a)) map.set(a, new Set())
    if (!map.has(b)) map.set(b, new Set())
    map.get(a)!.add(b)
    map.get(b)!.add(a)
  }

  for (const face of [faceA, faceB]) {
    for (let i = 0; i < face.verts.length; i++) {
      const a = face.verts[i]
      const b = face.verts[(i + 1) % face.verts.length]
      addBoundaryEdge(a, b)
    }
  }

  const start = [...map.keys()][0]
  if (start == null) return null

  const order = [start]
  let prev = -1
  let current = start
  while (order.length < 4) {
    const neighbors = [...(map.get(current) ?? [])]
    const next = neighbors.find(item => item !== prev)
    if (next == null) return null
    order.push(next)
    prev = current
    current = next
  }

  return order
}

function exchangeDiagonal() {
  const current = getCurrentDiagonal()
  if (!current || current.faceIds.length !== 2) {
    info.lastAction = '当前没有可交换的内部对角线。'
    return
  }

  const faceA = getFace(current.faceIds[0])
  const faceB = getFace(current.faceIds[1])
  if (!faceA || !faceB || faceA.verts.length !== 3 || faceB.verts.length !== 3) {
    info.lastAction = '交换对角线目前只支持两个三角形组成的四边形。'
    return
  }

  const order = findBoundaryCycleFromTwoTriangles(faceA, faceB, current.key)
  if (!order) {
    info.lastAction = '没能恢复出四边形边界顺序。'
    return
  }

  const [v0, v1, v2, v3] = order
  faces = faces.filter(item => item.id !== faceA.id && item.id !== faceB.id)

  if (current.key === edgeKey(v0, v2)) {
    faces.push(
      { id: faceA.id, verts: [v1, v2, v3] },
      { id: faceB.id, verts: [v1, v3, v0] }
    )
    selectedEdgeKey = edgeKey(v1, v3)
  } else {
    faces.push(
      { id: faceA.id, verts: [v0, v1, v2] },
      { id: faceB.id, verts: [v0, v2, v3] }
    )
    selectedEdgeKey = edgeKey(v0, v2)
  }

  selectedFaceId = null
  info.lastAction = `把内部对角线 ${current.key.replace('_', ' - ')} 翻成了 ${selectedEdgeKey.replace('_', ' - ')}。`
  rebuildScene()
}

function insertMidpointOnSelectedEdge() {
  if (selectedEdgeKey == null) return

  const edge = deriveEdges().find(item => item.key === selectedEdgeKey)
  if (!edge) return

  const midId = nextVertexId()
  const pa = getVertex(edge.a)!.position
  const pb = getVertex(edge.b)!.position
  vertices.push({
    id: midId,
    position: pa.clone().add(pb).multiplyScalar(0.5)
  })

  faces = faces.map(face => {
    if (!faceContainsVertices(face, edge.a, edge.b)) return face
    const nextVerts: number[] = []
    let inserted = false
    for (let i = 0; i < face.verts.length; i++) {
      const curr = face.verts[i]
      const next = face.verts[(i + 1) % face.verts.length]
      nextVerts.push(curr)
      if (!inserted && ((curr === edge.a && next === edge.b) || (curr === edge.b && next === edge.a))) {
        nextVerts.push(midId)
        inserted = true
      }
    }
    return inserted ? { ...face, verts: nextVerts } : face
  })

  selectedVertexIds = [midId]
  selectedEdgeKey = null
  info.lastAction = `在边 ${edge.key.replace('_', ' - ')} 的中点插入了 V${midId}，顶点、index、边关系和面关系都随之更新。`
  rebuildScene()
}

function extrudeFace(faceId: number, distance: number) {
  const face = getFace(faceId)
  if (!face) return null

  const normal = getFaceNormal(face)
  if (normal.lengthSq() < 1e-6) return null

  const newVertexIds = face.verts.map(id => {
    const v = getVertex(id)!.position
    const newId = nextVertexId()
    vertices.push({
      id: newId,
      position: v.clone().addScaledVector(normal, distance)
    })
    return newId
  })

  const topFaceId = nextFaceId()
  faces.push({ id: topFaceId, verts: newVertexIds })
  for (let i = 0; i < face.verts.length; i++) {
    const a = face.verts[i]
    const b = face.verts[(i + 1) % face.verts.length]
    const na = newVertexIds[i]
    const nb = newVertexIds[(i + 1) % newVertexIds.length]
    faces.push({ id: nextFaceId(), verts: [a, b, nb, na] })
  }

  return topFaceId
}

function extrudeSelectedFace() {
  if (selectedFaceId == null) return
  const topFaceId = extrudeFace(selectedFaceId, extrudeDistance.value)
  if (topFaceId == null) {
    info.lastAction = '挤出失败，当前面法线无效。'
    return
  }

  setSelectedFace(topFaceId)
  info.lastAction = `沿面法线挤出了 ${extrudeDistance.value}，复制了一层点并生成了侧面。`
  rebuildScene()
}

function insetFace(faceId: number, ratio: number) {
  const face = getFace(faceId)
  if (!face) return null

  const center = getFaceCenter(face)
  const innerIds = face.verts.map(id => {
    const pos = getVertex(id)!.position
    const newId = nextVertexId()
    vertices.push({
      id: newId,
      position: center.clone().lerp(pos, ratio)
    })
    return newId
  })

  faces = faces.filter(item => item.id !== faceId)
  for (let i = 0; i < face.verts.length; i++) {
    const outerA = face.verts[i]
    const outerB = face.verts[(i + 1) % face.verts.length]
    const innerA = innerIds[i]
    const innerB = innerIds[(i + 1) % innerIds.length]
    faces.push({ id: nextFaceId(), verts: [outerA, outerB, innerB, innerA] })
  }

  const innerFaceId = nextFaceId()
  faces.push({ id: innerFaceId, verts: innerIds })
  return innerFaceId
}

function insetSelectedFace() {
  if (selectedFaceId == null) return
  const innerFaceId = insetFace(selectedFaceId, insetRatio.value)
  if (innerFaceId == null) return

  setSelectedFace(innerFaceId)
  info.lastAction = `对 F${innerFaceId} 的来源面做了 inset，形成了内圈，并连接了外圈与内圈。`
  rebuildScene()
}

function insetAndExtrudeSelectedFace() {
  if (selectedFaceId == null) return
  const innerFaceId = insetFace(selectedFaceId, insetRatio.value)
  if (innerFaceId == null) return

  const topFaceId = extrudeFace(innerFaceId, extrudeDistance.value)
  if (topFaceId == null) return

  setSelectedFace(topFaceId)
  info.lastAction = `先 inset 再 extrude，已经能看到比较明显的建模层次。`
  rebuildScene()
}

function bevelSelectedFaceSimple() {
  if (selectedFaceId == null) return
  const innerFaceId = insetFace(selectedFaceId, bevelInsetRatio.value)
  if (innerFaceId == null) return

  const topFaceId = extrudeFace(innerFaceId, bevelHeight.value)
  if (topFaceId == null) return

  setSelectedFace(topFaceId)
  info.lastAction = '执行了简化版 bevel：先轻微 inset，再给一个很小的高度过渡。'
  rebuildScene()
}

function resetDemo() {
  createInitialTopology()
  info.lastAction = '已重置为一个最基础的四边形拓扑起点。'
  rebuildScene()
}

function rebuildScene() {
  if (!rootGroup) return

  while (rootGroup.children.length) {
    const child = rootGroup.children[0]
    rootGroup.remove(child)

    if (child instanceof THREE.Mesh) {
      child.geometry.dispose()
      const mat = child.material
      if (Array.isArray(mat)) mat.forEach(item => item.dispose())
      else mat.dispose()
    }

    if (child instanceof THREE.Line) {
      child.geometry.dispose()
      const mat = child.material
      if (Array.isArray(mat)) mat.forEach(item => item.dispose())
      else mat.dispose()
    }
  }

  clearLabels()
  vertexObjects.clear()
  edgeObjects.clear()
  faceObjects.clear()

  for (const face of faces) {
    const selected = face.id === selectedFaceId
    const mesh = new THREE.Mesh(
      buildFaceGeometry(face),
      new THREE.MeshBasicMaterial({
        color: selected ? 0xff922b : 0x4dabf7,
        transparent: true,
        opacity: selected ? 0.5 : 0.24,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    )
    mesh.userData.faceId = face.id
    faceObjects.set(face.id, mesh)
    rootGroup.add(mesh)

    const label = buildTextLabel(`F${face.id}`, selected ? '#ff922b' : '#4dabf7')
    label.position.copy(getFaceCenter(face)).add(new THREE.Vector3(0, 16, 0))
    rootGroup.add(label)
  }

  const edges = deriveEdges()
  for (const edge of edges) {
    const a = getVertex(edge.a)!.position
    const b = getVertex(edge.b)!.position
    const selected = edge.key === selectedEdgeKey
    const color = selected ? 0xffe066 : edge.kind === 'internal' ? 0x40c057 : 0xffffff
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([a, b]),
      new THREE.LineBasicMaterial({ color })
    )
    line.userData.edgeKey = edge.key
    edgeObjects.set(edge.key, line)
    rootGroup.add(line)

    const label = buildTextLabel(
      edge.kind === 'internal' ? `E ${edge.key}` : `B ${edge.key}`,
      edge.kind === 'internal' ? '#40c057' : '#ffffff'
    )
    label.position.copy(a.clone().add(b).multiplyScalar(0.5)).add(new THREE.Vector3(0, 10, 0))
    rootGroup.add(label)
  }

  for (const vertex of vertices) {
    const selected = selectedVertexIds.includes(vertex.id)
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(selected ? 8 : 6, 18, 18),
      new THREE.MeshBasicMaterial({ color: selected ? 0xffd43b : 0xff6b6b })
    )
    mesh.position.copy(vertex.position)
    mesh.userData.vertexId = vertex.id
    vertexObjects.set(vertex.id, mesh)
    rootGroup.add(mesh)

    const label = buildTextLabel(`V${vertex.id}`, '#ffffff')
    label.position.copy(vertex.position).add(new THREE.Vector3(0, 18, 0))
    rootGroup.add(label)
  }

  info.selectedVertices = selectedVertexIds.length ? selectedVertexIds.map(id => `V${id}`).join(', ') : '无'
  info.selectedEdge = selectedEdgeKey == null ? '无' : selectedEdgeKey.replace('_', ' - ')
  info.selectedFace = selectedFaceId == null ? '无' : `F${selectedFaceId}`
  info.vertexList = vertices.map(v => `V${v.id}: (${v.position.x.toFixed(1)}, ${v.position.y.toFixed(1)}, ${v.position.z.toFixed(1)})`).join('\n')
  info.indexList = `[${faces.flatMap(face => face.verts).join(', ')}]`
  info.edgeList = edges
    .map(edge => `${edge.kind} ${edge.key} -> faces[${edge.faceIds.join(', ')}]`)
    .join('\n')
  info.faceList = faces.map(face => `F${face.id}: [${face.verts.join(', ')}]`).join('\n')
  info.canSwap = getCurrentDiagonal() ? '是' : '否'
}

function selectFromPointer(ev: PointerEvent) {
  if (!three) return
  three.updateMouseFromEvent(ev)
  three.raycaster.setFromCamera(three.mouse, three.camera)

  if (mode.value === 'vertex') {
    const hit = three.raycaster.intersectObjects([...vertexObjects.values()], false)[0]
    if (!hit) return
    const vertexId = hit.object.userData.vertexId as number
    if (selectedVertexIds.includes(vertexId)) {
      selectedVertexIds = selectedVertexIds.filter(id => id !== vertexId)
    } else if (selectedVertexIds.length < 2) {
      selectedVertexIds = [...selectedVertexIds, vertexId]
    } else {
      selectedVertexIds = [selectedVertexIds[1], vertexId]
    }
    selectedEdgeKey = null
    info.lastAction = `当前吸附到的点：${selectedVertexIds.map(id => `V${id}`).join(', ') || '无'}`
  } else if (mode.value === 'edge') {
    const hit = three.raycaster.intersectObjects([...edgeObjects.values()], false)[0]
    if (!hit) return
    selectedEdgeKey = hit.object.userData.edgeKey as string
    info.lastAction = `当前选中了边 ${selectedEdgeKey.replace('_', ' - ')}`
  } else {
    const hit = three.raycaster.intersectObjects([...faceObjects.values()], false)[0]
    if (!hit) return
    setSelectedFace(hit.object.userData.faceId as number)
    info.lastAction = `当前选中了面 F${selectedFaceId}`
  }

  rebuildScene()
}

onMounted(() => {
  three = createThreeBase(canvasRef.value!)
  const { scene, camera, orbit, raycaster } = three

  camera.position.set(360, 280, 360)
  orbit.target.set(0, 40, 0)
  raycaster.params.Line = raycaster.params.Line || { threshold: 1 }
  raycaster.params.Line.threshold = 10

  scene.add(new THREE.AmbientLight(0xffffff, 0.92))
  const dir = new THREE.DirectionalLight(0xffffff, 1)
  dir.position.set(260, 320, 180)
  scene.add(dir)

  rootGroup = new THREE.Group()
  scene.add(rootGroup)

  resetDemo()

  const onDown = (ev: PointerEvent) => selectFromPointer(ev)
  canvasRef.value!.addEventListener('pointerdown', onDown)
  cleanup.push(() => canvasRef.value?.removeEventListener('pointerdown', onDown))

  three.start()
})

onBeforeUnmount(() => {
  cleanup.forEach(fn => fn())
  cleanup.length = 0
  clearLabels()
  three?.dispose()
  three = null
  rootGroup = null
})
</script>

<template>
  <div style="display:flex; gap:16px; align-items:flex-start; flex-wrap:wrap;">
    <div style="width:820px;">
      <div style="margin-bottom:8px; line-height:1.7;">
        <button @click="mode = 'vertex'">选点</button>
        <button @click="mode = 'edge'" style="margin-left:6px;">选边</button>
        <button @click="mode = 'face'" style="margin-left:6px;">选面</button>
        <span style="margin-left:12px; opacity:0.82;">
          当前模式：{{ mode }}。这个 demo 现在不只是 cut，而是“第四阶段拓扑编辑”教学沙盒。
        </span>
      </div>

      <div style="width:800px; height:620px; border:1px solid #2a2a2a; border-radius:10px; overflow:hidden;">
        <canvas ref="canvasRef" style="width:800px; height:620px; display:block;" />
      </div>
    </div>

    <div style="width:420px; display:flex; flex-direction:column; gap:12px;">
      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">第四阶段</div>
        <div>{{ info.stageSummary }}</div>
        <div style="margin-top:8px; opacity:0.82;">
          重点观察：顶点列表、index、边关系、面关系如何随着操作一起变化。
        </div>
      </div>

      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">Cut / 拓扑切分</div>
        <div>
          <button @click="cutDefaultDiagonal">四边形对角切一刀</button>
        </div>
        <div style="margin-top:8px;">
          <button @click="exchangeDiagonal">交换对角线</button>
          <span style="margin-left:8px; opacity:0.75;">当前可交换：{{ info.canSwap }}</span>
        </div>
        <div style="margin-top:8px;">
          <button @click="connectSelectedVertices">两点吸附后连边</button>
        </div>
        <div style="margin-top:8px;">
          <button @click="insertMidpointOnSelectedEdge">从边中点切开</button>
        </div>
      </div>

      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">Extrude</div>
        <div>距离：{{ extrudeDistance }}</div>
        <input v-model.number="extrudeDistance" type="range" min="10" max="180" step="2" style="width:100%;" />
        <div style="margin-top:8px;">
          <button @click="extrudeSelectedFace">版本 1 / 2：选面后沿法线挤出</button>
        </div>
        <div style="margin-top:8px;">
          <button @click="insetAndExtrudeSelectedFace">版本 3：Inset + Extrude</button>
        </div>
      </div>

      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">Inset / Bevel 简化版</div>
        <div>Inset 比例：{{ insetRatio.toFixed(2) }}</div>
        <input v-model.number="insetRatio" type="range" min="0.2" max="0.92" step="0.02" style="width:100%;" />
        <div style="margin-top:8px;">
          <button @click="insetSelectedFace">对选中面做 Inset</button>
        </div>
        <div style="margin-top:10px;">Bevel 内收：{{ bevelInsetRatio.toFixed(2) }}</div>
        <input v-model.number="bevelInsetRatio" type="range" min="0.6" max="0.95" step="0.01" style="width:100%;" />
        <div style="margin-top:10px;">Bevel 高度：{{ bevelHeight }}</div>
        <input v-model.number="bevelHeight" type="range" min="4" max="40" step="1" style="width:100%;" />
        <div style="margin-top:8px;">
          <button @click="bevelSelectedFaceSimple">简化版 Bevel</button>
        </div>
      </div>

      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">当前选择</div>
        <div>点：{{ info.selectedVertices }}</div>
        <div>边：{{ info.selectedEdge }}</div>
        <div>面：{{ info.selectedFace }}</div>
      </div>

      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">顶点列表</div>
        <pre style="margin:0; white-space:pre-wrap;">{{ info.vertexList }}</pre>
      </div>

      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">Index</div>
        <pre style="margin:0; white-space:pre-wrap;">{{ info.indexList }}</pre>
      </div>

      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">边关系</div>
        <pre style="margin:0; white-space:pre-wrap;">{{ info.edgeList || '当前还没有边关系数据' }}</pre>
      </div>

      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">面关系</div>
        <pre style="margin:0; white-space:pre-wrap;">{{ info.faceList || '当前还没有面数据' }}</pre>
      </div>

      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">操作说明</div>
        <div>Cut：先用选点或选边模式，再执行切分、翻对角线、中点切边。</div>
        <div>Extrude：选中一个面，沿法线复制一层点，生成侧面，形成新的体块。</div>
        <div>Inset：把一个面向中心缩小，自动生成内圈和连接环。</div>
        <div>Bevel 简化版：本质上是轻微 inset 后再给一点高度过渡，不追求 Blender 级复杂度。</div>
      </div>

      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">最近一次操作</div>
        <div>{{ info.lastAction }}</div>
      </div>

      <div>
        <button @click="resetDemo">重置</button>
      </div>
    </div>
  </div>
</template>
