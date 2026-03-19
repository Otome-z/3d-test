<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import * as THREE from 'three'
import { createThreeBase } from '@/composables/useThreeBase'

type SelectMode = 'vertex' | 'edge' | 'face'

// 教学版拓扑顶点：这里只保留位置和启用状态，方便直接观察删/合并后的结果。
type TopoVertex = {
  id: number
  position: THREE.Vector3
  enabled: boolean
}

// 教学版三角面：verts 存的是三个顶点 id，而不是直接存坐标。
type TopoFace = {
  id: number
  verts: [number, number, number]
  enabled: boolean
}

// 从当前启用中的面临时推导出来的边信息，不持久存储。
type DerivedEdge = {
  key: string
  a: number
  b: number
  faces: number[]
}

const canvasRef = ref<HTMLCanvasElement | null>(null)

let three: ReturnType<typeof createThreeBase> | null = null
let rootGroup: THREE.Group | null = null
let labelSprites: THREE.Sprite[] = []

const mode = ref<SelectMode>('vertex')
const info = reactive({
  selectedVertex: '无',
  selectedEdge: '无',
  selectedFace: '无',
  mergeA: '无',
  mergeB: '无',
  vertexCount: 0,
  faceCount: 0,
  edgeCount: 0,
  lastAction: '点击顶点 / 边 / 面，再执行右侧操作'
})

let topoVertices: TopoVertex[] = []
let topoFaces: TopoFace[] = []
let selectedVertexId: number | null = null
let selectedEdgeKey: string | null = null
let selectedFaceId: number | null = null
let mergeVertexA: number | null = null
let mergeVertexB: number | null = null

// 这些 Map 是“渲染对象 -> 拓扑 id”之间的桥梁，拾取时靠它们反查选中的元素。
const vertexObjects = new Map<number, THREE.Mesh>()
const edgeObjects = new Map<string, THREE.Line>()
const faceObjects = new Map<number, THREE.Mesh>()

const cleanup: Array<() => void> = []

function createInitialTopology() {
  // 用一个简单的金字塔做练习：既有底面，也有侧面，方便演示删/合/拆。
  topoVertices = [
    { id: 0, position: new THREE.Vector3(-90, 0, -90), enabled: true },
    { id: 1, position: new THREE.Vector3(90, 0, -90), enabled: true },
    { id: 2, position: new THREE.Vector3(90, 0, 90), enabled: true },
    { id: 3, position: new THREE.Vector3(-90, 0, 90), enabled: true },
    { id: 4, position: new THREE.Vector3(0, 120, 0), enabled: true }
  ]

  topoFaces = [
    { id: 0, verts: [0, 1, 2], enabled: true },
    { id: 1, verts: [0, 2, 3], enabled: true },
    { id: 2, verts: [0, 1, 4], enabled: true },
    { id: 3, verts: [1, 2, 4], enabled: true },
    { id: 4, verts: [2, 3, 4], enabled: true },
    { id: 5, verts: [3, 0, 4], enabled: true }
  ]
}

function nextVertexId() {
  return topoVertices.length ? Math.max(...topoVertices.map(v => v.id)) + 1 : 0
}

function nextFaceId() {
  return topoFaces.length ? Math.max(...topoFaces.map(f => f.id)) + 1 : 0
}

function getVertex(id: number) {
  return topoVertices.find(v => v.id === id) ?? null
}

function getFace(id: number) {
  return topoFaces.find(f => f.id === id) ?? null
}

function isFaceUsingVertex(face: TopoFace, vertexId: number) {
  return face.verts[0] === vertexId || face.verts[1] === vertexId || face.verts[2] === vertexId
}

function sortEdge(a: number, b: number) {
  return a < b ? [a, b] as [number, number] : [b, a] as [number, number]
}

function edgeKey(a: number, b: number) {
  const [i0, i1] = sortEdge(a, b)
  return `${i0}_${i1}`
}

function deriveEdges() {
  // 从当前所有启用中的三角面反推出唯一边列表，并记录每条边被哪些面使用。
  const map = new Map<string, DerivedEdge>()

  for (const face of topoFaces) {
    if (!face.enabled) continue
    const edges: Array<[number, number]> = [
      [face.verts[0], face.verts[1]],
      [face.verts[1], face.verts[2]],
      [face.verts[2], face.verts[0]]
    ]

    for (const [a, b] of edges) {
      const [i0, i1] = sortEdge(a, b)
      const key = edgeKey(i0, i1)
      const existing = map.get(key)
      if (existing) {
        existing.faces.push(face.id)
      } else {
        map.set(key, { key, a: i0, b: i1, faces: [face.id] })
      }
    }
  }

  return [...map.values()]
}

function disableInvalidFacesAndDeduplicate() {
  // 清理当前拓扑里已经失效的面：包括退化面、引用失效顶点的面、重复面。
  const seen = new Set<string>()

  for (const face of topoFaces) {
    if (!face.enabled) continue

    // 顶点重复后就不再是有效三角面了，例如 merge 后可能出现 [1,1,4]。
    const verts = face.verts
    const unique = new Set(verts)
    if (unique.size < 3) {
      face.enabled = false
      continue
    }

    // 如果面引用了已经被禁用的顶点，这个面也要一起失效。
    const hasDisabledVertex = verts.some(id => !getVertex(id)?.enabled)
    if (hasDisabledVertex) {
      face.enabled = false
      continue
    }

    // 合并/拆分后可能出现重复面，这里按顶点集合去重。
    const key = [...verts].sort((a, b) => a - b).join('_')
    if (seen.has(key)) {
      face.enabled = false
      continue
    }
    seen.add(key)
  }
}

function splitTriangleByEdge(faceVerts: [number, number, number], a: number, b: number, mid: number) {
  // 给定一个三角面和它的一条边，把这条边用中点切开，返回切分后的两个新三角面。
  const [v0, v1, v2] = faceVerts

  // 这个函数假设 mid 已经在边 ab 上，返回“沿 ab 切开”后的两个三角形。
  if ((v0 === a && v1 === b) || (v0 === b && v1 === a)) {
    return [[v0, mid, v2], [mid, v1, v2]] as Array<[number, number, number]>
  }
  if ((v1 === a && v2 === b) || (v1 === b && v2 === a)) {
    return [[v1, mid, v0], [mid, v2, v0]] as Array<[number, number, number]>
  }
  if ((v2 === a && v0 === b) || (v2 === b && v0 === a)) {
    return [[v2, mid, v1], [mid, v0, v1]] as Array<[number, number, number]>
  }

  return [faceVerts]
}

function buildTextLabel(text: string, color: string) {
  // 给顶点和面生成一个 3D 文字标签，用来在场景里直接显示名字。
  const canvas = document.createElement('canvas')
  canvas.width = 160
  canvas.height = 72
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.65)'
  ctx.fillRect(8, 10, 144, 44)
  ctx.strokeStyle = color
  ctx.lineWidth = 3
  ctx.strokeRect(8, 10, 144, 44)
  ctx.fillStyle = color
  ctx.font = 'bold 26px sans-serif'
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
  sprite.scale.set(36, 16, 1)
  sprite.renderOrder = 50
  labelSprites.push(sprite)
  return sprite
}

function clearLabels() {
  // 清理所有文字标签及其贴图资源，避免场景重建时泄漏。
  labelSprites.forEach(sprite => {
    const material = sprite.material as THREE.SpriteMaterial
    material.map?.dispose()
    material.dispose()
  })
  labelSprites = []
}

function resetSelectionIfNeeded() {
  // 拓扑变化后，旧选中项可能已经不存在了，这里统一清掉无效选择。
  if (selectedVertexId != null && !getVertex(selectedVertexId)?.enabled) selectedVertexId = null
  if (selectedFaceId != null && !getFace(selectedFaceId)?.enabled) selectedFaceId = null

  if (selectedEdgeKey != null) {
    const edgeStillExists = deriveEdges().some(edge => edge.key === selectedEdgeKey)
    if (!edgeStillExists) selectedEdgeKey = null
  }

  if (mergeVertexA != null && !getVertex(mergeVertexA)?.enabled) mergeVertexA = null
  if (mergeVertexB != null && !getVertex(mergeVertexB)?.enabled) mergeVertexB = null
}

function rebuildScene() {
  // 根据当前 topoVertices / topoFaces 整体重建可视化场景，包括面、边、点和标签。
  if (!rootGroup) return

  // 这个 demo 不是增量更新，而是每次操作后整套可视化重建，逻辑最直观。
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

  disableInvalidFacesAndDeduplicate()
  resetSelectionIfNeeded()

  for (const face of topoFaces) {
    if (!face.enabled) continue
    const a = getVertex(face.verts[0])!
    const b = getVertex(face.verts[1])!
    const c = getVertex(face.verts[2])!
    const positions = new Float32Array([
      a.position.x, a.position.y, a.position.z,
      b.position.x, b.position.y, b.position.z,
      c.position.x, c.position.y, c.position.z
    ])

    // 面用半透明 Mesh 显示，便于直接点选和观察拆分后的结果。
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.computeVertexNormals()

    const selected = face.id === selectedFaceId
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: selected ? 0xffa94d : 0x74c0fc,
        transparent: true,
        opacity: selected ? 0.55 : 0.24,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    )
    mesh.userData.faceId = face.id
    faceObjects.set(face.id, mesh)
    rootGroup.add(mesh)

    const center = a.position.clone().add(b.position).add(c.position).multiplyScalar(1 / 3)
    const label = buildTextLabel(`F${face.id}`, selected ? '#ffa94d' : '#74c0fc')
    label.position.copy(center).add(new THREE.Vector3(0, 16, 0))
    rootGroup.add(label)
  }

  const edges = deriveEdges()
  for (const edge of edges) {
    const a = getVertex(edge.a)!
    const b = getVertex(edge.b)!
    const selected = edge.key === selectedEdgeKey
    // 边不单独存拓扑，始终由当前面集合反推出来。
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([a.position, b.position]),
      new THREE.LineBasicMaterial({ color: selected ? 0xffec99 : 0xffffff })
    )
    line.userData.edgeKey = edge.key
    edgeObjects.set(edge.key, line)
    rootGroup.add(line)
  }

  for (const vertex of topoVertices) {
    if (!vertex.enabled) continue
    const selected = vertex.id === selectedVertexId
    const mergeColor =
      vertex.id === mergeVertexA ? 0x40c057 : vertex.id === mergeVertexB ? 0xfa5252 : selected ? 0xffd43b : 0xff6b6b

    // merge A / merge B / 当前选中顶点分别用不同颜色提醒。
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(selected ? 8 : 6, 18, 18),
      new THREE.MeshBasicMaterial({ color: mergeColor })
    )
    mesh.position.copy(vertex.position)
    mesh.userData.vertexId = vertex.id
    vertexObjects.set(vertex.id, mesh)
    rootGroup.add(mesh)

    const label = buildTextLabel(`V${vertex.id}`, '#ffffff')
    label.position.copy(vertex.position).add(new THREE.Vector3(0, 18, 0))
    rootGroup.add(label)
  }

  info.selectedVertex = selectedVertexId == null ? '无' : `V${selectedVertexId}`
  info.selectedEdge = selectedEdgeKey == null ? '无' : selectedEdgeKey.replace('_', ' - ')
  info.selectedFace = selectedFaceId == null ? '无' : `F${selectedFaceId}`
  info.mergeA = mergeVertexA == null ? '无' : `V${mergeVertexA}`
  info.mergeB = mergeVertexB == null ? '无' : `V${mergeVertexB}`
  info.vertexCount = topoVertices.filter(v => v.enabled).length
  info.faceCount = topoFaces.filter(f => f.enabled).length
  info.edgeCount = edges.length
}

function resetDemo() {
  // 恢复到最初的金字塔拓扑，同时清空所有选择状态。
  createInitialTopology()
  selectedVertexId = null
  selectedEdgeKey = null
  selectedFaceId = null
  mergeVertexA = null
  mergeVertexB = null
  info.lastAction = '已重置为初始金字塔'
  rebuildScene()
}

function selectFromPointer(ev: PointerEvent) {
  // 根据当前选择模式，从鼠标点击位置拾取顶点、边或面，并更新当前选中状态。
  if (!three) return
  three.updateMouseFromEvent(ev)
  three.raycaster.setFromCamera(three.mouse, three.camera)

  // 根据当前模式只在对应图元集合里做拾取，避免一次点击同时命中多种对象。
  if (mode.value === 'vertex') {
    const hit = three.raycaster.intersectObjects([...vertexObjects.values()], false)[0]
    if (!hit) return
    selectedVertexId = hit.object.userData.vertexId as number
    info.lastAction = `选中了顶点 V${selectedVertexId}`
  } else if (mode.value === 'edge') {
    const hit = three.raycaster.intersectObjects([...edgeObjects.values()], false)[0]
    if (!hit) return
    selectedEdgeKey = hit.object.userData.edgeKey as string
    info.lastAction = `选中了边 ${selectedEdgeKey.replace('_', ' - ')}`
  } else {
    const hit = three.raycaster.intersectObjects([...faceObjects.values()], false)[0]
    if (!hit) return
    selectedFaceId = hit.object.userData.faceId as number
    info.lastAction = `选中了面 F${selectedFaceId}`
  }

  rebuildScene()
}

function deleteSelectedVertex() {
  // 禁用当前选中的顶点，并删除所有引用这个顶点的面。
  if (selectedVertexId == null) return
  const vertex = getVertex(selectedVertexId)
  if (!vertex) return

  // 这里先做“禁用”而不是物理删除，避免重排 id，教学上更容易跟踪变化。
  vertex.enabled = false
  topoFaces.forEach(face => {
    if (face.enabled && isFaceUsingVertex(face, vertex.id)) face.enabled = false
  })

  info.lastAction = `禁用了顶点 V${vertex.id}，并删除了所有引用它的面`
  selectedVertexId = null
  rebuildScene()
}

function deleteSelectedFace() {
  // 删除当前选中的三角面，但不主动改动其他顶点和边。
  if (selectedFaceId == null) return
  const face = getFace(selectedFaceId)
  if (!face) return

  face.enabled = false
  info.lastAction = `删除了面 F${face.id}`
  selectedFaceId = null
  rebuildScene()
}

function setMergeA() {
  // 把当前选中的顶点记成“待合并的第一个顶点”。
  if (selectedVertexId == null) return
  mergeVertexA = selectedVertexId
  info.lastAction = `把 V${selectedVertexId} 设成 merge A`
  rebuildScene()
}

function setMergeB() {
  // 把当前选中的顶点记成“待合并的第二个顶点”。
  if (selectedVertexId == null) return
  mergeVertexB = selectedVertexId
  info.lastAction = `把 V${selectedVertexId} 设成 merge B`
  rebuildScene()
}

function mergeSelectedVertices() {
  // 把两个顶点合并成一个：位置取中点，所有引用 B 的面改成引用 A。
  if (mergeVertexA == null || mergeVertexB == null || mergeVertexA === mergeVertexB) return
  const a = getVertex(mergeVertexA)
  const b = getVertex(mergeVertexB)
  if (!a || !b || !a.enabled || !b.enabled) return

  // 合并策略：把 A 和 B 的位置取中点，然后把所有引用 B 的面改成引用 A。
  a.position.copy(a.position.clone().add(b.position).multiplyScalar(0.5))

  topoFaces.forEach(face => {
    if (!face.enabled) return
    face.verts = face.verts.map(id => (id === b.id ? a.id : id)) as [number, number, number]
  })

  // B 被“吸收”后直接禁用，后续由 disableInvalidFacesAndDeduplicate 清理退化面。
  b.enabled = false
  selectedVertexId = a.id
  info.lastAction = `把 V${mergeVertexA} 和 V${mergeVertexB} 合并成一个顶点`
  mergeVertexA = null
  mergeVertexB = null
  rebuildScene()
}

function insertPointOnSelectedEdge() {
  // 在当前选中边的中点插入一个新顶点，并把使用这条边的面统一切开。
  if (selectedEdgeKey == null) return
  const edges = deriveEdges()
  const edge = edges.find(item => item.key === selectedEdgeKey)
  if (!edge) return

  // 在线段中点创建一个新顶点，再把所有使用这条边的三角面一分为二。
  const a = getVertex(edge.a)!
  const b = getVertex(edge.b)!
  const midId = nextVertexId()
  topoVertices.push({
    id: midId,
    position: a.position.clone().add(b.position).multiplyScalar(0.5),
    enabled: true
  })

  for (const faceId of edge.faces) {
    const face = getFace(faceId)
    if (!face || !face.enabled) continue
    face.enabled = false
    const pieces = splitTriangleByEdge(face.verts, edge.a, edge.b, midId)
    pieces.forEach(piece => {
      topoFaces.push({ id: nextFaceId(), verts: piece, enabled: true })
    })
  }

  selectedVertexId = midId
  info.lastAction = `在边 ${edge.key.replace('_', ' - ')} 中间插入了新点 V${midId}`
  selectedEdgeKey = null
  rebuildScene()
}

function splitSelectedFace() {
  // 把当前选中的三角面沿最长边切开，得到两个新的三角面。
  if (selectedFaceId == null) return
  const face = getFace(selectedFaceId)
  if (!face || !face.enabled) return

  const [aId, bId, cId] = face.verts
  const a = getVertex(aId)!
  const b = getVertex(bId)!
  const c = getVertex(cId)!

  // 这里选“最长边”做切分，是为了让拆分结果更稳定、更容易观察。
  const candidates: Array<{ a: number; b: number; lengthSq: number }> = [
    { a: aId, b: bId, lengthSq: a.position.distanceToSquared(b.position) },
    { a: bId, b: cId, lengthSq: b.position.distanceToSquared(c.position) },
    { a: cId, b: aId, lengthSq: c.position.distanceToSquared(a.position) }
  ]
  candidates.sort((x, y) => y.lengthSq - x.lengthSq)
  const longest = candidates[0]

  const midId = nextVertexId()
  topoVertices.push({
    id: midId,
    position: getVertex(longest.a)!.position.clone().add(getVertex(longest.b)!.position).multiplyScalar(0.5),
    enabled: true
  })

  face.enabled = false
  splitTriangleByEdge(face.verts, longest.a, longest.b, midId).forEach(piece => {
    topoFaces.push({ id: nextFaceId(), verts: piece, enabled: true })
  })

  selectedFaceId = null
  selectedVertexId = midId
  info.lastAction = `沿选中面的最长边插入 V${midId}，把一个面拆成了两个面`
  rebuildScene()
}

onMounted(() => {
  three = createThreeBase(canvasRef.value!)
  const { scene, camera, raycaster, orbit } = three

  camera.position.set(320, 240, 320)
  orbit.target.set(0, 40, 0)
  // 适当增大线拾取阈值，否则直接点线段会有点难点中。
  raycaster.params.Line = raycaster.params.Line || { threshold: 1 }
  raycaster.params.Line.threshold = 10

  scene.add(new THREE.AmbientLight(0xffffff, 0.9))
  const dir = new THREE.DirectionalLight(0xffffff, 1)
  dir.position.set(240, 320, 180)
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
        <button @click="mode = 'vertex'">选顶点</button>
        <button @click="mode = 'edge'" style="margin-left:6px;">选边</button>
        <button @click="mode = 'face'" style="margin-left:6px;">选面</button>
        <span style="margin-left:12px; opacity:0.8;">
          当前模式：{{ mode }}。先点击图元，再执行右侧按钮。
        </span>
      </div>

      <div style="width:800px; height:620px; border:1px solid #2a2a2a; border-radius:10px; overflow:hidden;">
        <canvas ref="canvasRef" style="width:800px; height:620px; display:block;" />
      </div>
    </div>

    <div style="width:380px; display:flex; flex-direction:column; gap:12px;">
      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">当前选择</div>
        <div>顶点：{{ info.selectedVertex }}</div>
        <div>边：{{ info.selectedEdge }}</div>
        <div>面：{{ info.selectedFace }}</div>
        <div style="margin-top:8px;">Merge A：{{ info.mergeA }}</div>
        <div>Merge B：{{ info.mergeB }}</div>
      </div>

      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">拓扑操作</div>
        <button @click="deleteSelectedVertex">删除 / 禁用当前顶点</button>
        <button @click="deleteSelectedFace" style="margin-left:6px;">删除当前面</button>
        <div style="margin-top:10px;">
          <button @click="setMergeA">设为 Merge A</button>
          <button @click="setMergeB" style="margin-left:6px;">设为 Merge B</button>
          <button @click="mergeSelectedVertices" style="margin-left:6px;">执行合并</button>
        </div>
        <div style="margin-top:10px;">
          <button @click="insertPointOnSelectedEdge">边中间插点</button>
          <button @click="splitSelectedFace" style="margin-left:6px;">一个面拆成两个面</button>
        </div>
        <div style="margin-top:10px;">
          <button @click="resetDemo">重置</button>
        </div>
      </div>

      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">当前拓扑</div>
        <div>启用顶点数：{{ info.vertexCount }}</div>
        <div>启用面数：{{ info.faceCount }}</div>
        <div>唯一边数：{{ info.edgeCount }}</div>
        <div style="margin-top:8px; opacity:0.82;">白色是边，蓝色是面，黄色是当前顶点，橙色是当前面。</div>
      </div>

      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">操作说明</div>
        <div>删除顶点：当前实现是“禁用顶点，并删除所有引用它的面”。</div>
        <div>删除面：只禁用当前三角面，其他拓扑保持不动。</div>
        <div>合并顶点：先各选一次顶点，设成 A/B，再执行合并。</div>
        <div>边中插点：会把使用这条边的所有面一起切开。</div>
        <div>拆面：会沿当前三角形的最长边插一个中点，把一个面拆成两个。</div>
      </div>

      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">最近一次操作</div>
        <div>{{ info.lastAction }}</div>
      </div>
    </div>
  </div>
</template>
