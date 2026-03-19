<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import * as THREE from 'three'
import { createThreeBase } from '@/composables/useThreeBase'

type SelectMode = 'vertex' | 'edge'

type CutVertex = {
  id: number
  position: THREE.Vector3
}

type CutFace = {
  id: number
  verts: [number, number, number]
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

const mode = ref<SelectMode>('vertex')

const info = reactive({
  selectedVertices: '无',
  selectedEdge: '无',
  vertexList: '',
  indexList: '[]',
  edgeList: '',
  faceList: '',
  lastAction: '先选点或边，再点右侧按钮',
  canSwap: '否'
})

let vertices: CutVertex[] = []
let faces: CutFace[] = []
let boundaryLoop: number[] = []
let selectedVertexIds: number[] = []
let selectedEdgeKey: string | null = null

const vertexObjects = new Map<number, THREE.Mesh>()
const edgeObjects = new Map<string, THREE.Line>()
const cleanup: Array<() => void> = []

function sortEdge(a: number, b: number) {
  return a < b ? [a, b] as [number, number] : [b, a] as [number, number]
}

function edgeKey(a: number, b: number) {
  const [i0, i1] = sortEdge(a, b)
  return `${i0}_${i1}`
}

function getVertex(id: number) {
  return vertices.find(item => item.id === id)!
}

function nextVertexId() {
  return vertices.length ? Math.max(...vertices.map(item => item.id)) + 1 : 0
}

function nextFaceId() {
  return faces.length ? Math.max(...faces.map(item => item.id)) + 1 : 0
}

function createInitialQuad() {
  vertices = [
    { id: 0, position: new THREE.Vector3(-120, 0, -120) },
    { id: 1, position: new THREE.Vector3(120, 0, -120) },
    { id: 2, position: new THREE.Vector3(120, 0, 120) },
    { id: 3, position: new THREE.Vector3(-120, 0, 120) }
  ]
  boundaryLoop = [0, 1, 2, 3]
  faces = []
  selectedVertexIds = []
  selectedEdgeKey = null
}

function buildTextLabel(text: string, color: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 180
  canvas.height = 72
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.65)'
  ctx.fillRect(10, 10, 160, 44)
  ctx.strokeStyle = color
  ctx.lineWidth = 3
  ctx.strokeRect(10, 10, 160, 44)
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
  sprite.scale.set(42, 16, 1)
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

function isBoundaryEdge(a: number, b: number) {
  for (let i = 0; i < boundaryLoop.length; i++) {
    const curr = boundaryLoop[i]
    const next = boundaryLoop[(i + 1) % boundaryLoop.length]
    if ((curr === a && next === b) || (curr === b && next === a)) return true
  }
  return false
}

function deriveEdges() {
  const map = new Map<string, EdgeInfo>()

  for (let i = 0; i < boundaryLoop.length; i++) {
    const a = boundaryLoop[i]
    const b = boundaryLoop[(i + 1) % boundaryLoop.length]
    const [i0, i1] = sortEdge(a, b)
    const key = edgeKey(i0, i1)
    map.set(key, { key, a: i0, b: i1, faceIds: [], kind: 'boundary' })
  }

  for (const face of faces) {
    const triEdges: Array<[number, number]> = [
      [face.verts[0], face.verts[1]],
      [face.verts[1], face.verts[2]],
      [face.verts[2], face.verts[0]]
    ]

    for (const [a, b] of triEdges) {
      const [i0, i1] = sortEdge(a, b)
      const key = edgeKey(i0, i1)
      const existing = map.get(key)
      if (existing) {
        existing.faceIds.push(face.id)
        if (!isBoundaryEdge(i0, i1)) existing.kind = 'internal'
      } else {
        map.set(key, { key, a: i0, b: i1, faceIds: [face.id], kind: 'internal' })
      }
    }
  }

  return [...map.values()]
}

function splitTriangleByEdge(faceVerts: [number, number, number], a: number, b: number, mid: number) {
  const [v0, v1, v2] = faceVerts

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

function setQuadFacesByDiagonal(a: number, b: number) {
  if (boundaryLoop.length !== 4) return false

  const [v0, v1, v2, v3] = boundaryLoop
  const is02 = (a === v0 && b === v2) || (a === v2 && b === v0)
  const is13 = (a === v1 && b === v3) || (a === v3 && b === v1)
  if (!is02 && !is13) return false

  if (is02) {
    faces = [
      { id: 0, verts: [v0, v1, v2] },
      { id: 1, verts: [v0, v2, v3] }
    ]
  } else {
    faces = [
      { id: 0, verts: [v1, v2, v3] },
      { id: 1, verts: [v1, v3, v0] }
    ]
  }

  return true
}

function getCurrentDiagonal() {
  const edges = deriveEdges()
  return edges.find(edge => edge.kind === 'internal') ?? null
}

function connectSelectedVertices() {
  if (selectedVertexIds.length !== 2) return
  const [a, b] = selectedVertexIds
  const ok = setQuadFacesByDiagonal(a, b)
  if (!ok) {
    info.lastAction = '当前两点不能直接作为四边形对角线连边'
    return
  }
  info.lastAction = `按当前两点 V${a} 和 V${b} 连边，并重建了 index / 边关系 / 面关系`
  selectedEdgeKey = edgeKey(a, b)
  rebuildScene()
}

function cutDefaultDiagonal() {
  const ok = setQuadFacesByDiagonal(boundaryLoop[0], boundaryLoop[2])
  if (!ok) return
  selectedEdgeKey = edgeKey(boundaryLoop[0], boundaryLoop[2])
  info.lastAction = '在四边形两个对角点 V0-V2 之间切了一刀'
  rebuildScene()
}

function exchangeDiagonal() {
  const current = getCurrentDiagonal()
  if (!current || boundaryLoop.length !== 4) {
    info.lastAction = '当前不是可交换对角线的四边形状态'
    return
  }

  const [v0, v1, v2, v3] = boundaryLoop
  const is02 = current.key === edgeKey(v0, v2)
  const ok = is02 ? setQuadFacesByDiagonal(v1, v3) : setQuadFacesByDiagonal(v0, v2)
  if (!ok) return

  selectedEdgeKey = is02 ? edgeKey(v1, v3) : edgeKey(v0, v2)
  info.lastAction = `把对角线从 ${current.key.replace('_', ' - ')} 交换成了 ${selectedEdgeKey.replace('_', ' - ')}`
  rebuildScene()
}

function insertMidpointOnSelectedEdge() {
  if (selectedEdgeKey == null) return

  const edge = deriveEdges().find(item => item.key === selectedEdgeKey)
  if (!edge) return

  const midId = nextVertexId()
  const pa = getVertex(edge.a).position
  const pb = getVertex(edge.b).position
  vertices.push({
    id: midId,
    position: pa.clone().add(pb).multiplyScalar(0.5)
  })

  for (let i = 0; i < boundaryLoop.length; i++) {
    const curr = boundaryLoop[i]
    const next = boundaryLoop[(i + 1) % boundaryLoop.length]
    if ((curr === edge.a && next === edge.b) || (curr === edge.b && next === edge.a)) {
      boundaryLoop.splice(i + 1, 0, midId)
      break
    }
  }

  const newFaces: CutFace[] = []
  for (const face of faces) {
    const usesEdge =
      (face.verts.includes(edge.a) && face.verts.includes(edge.b))
    if (!usesEdge) {
      newFaces.push(face)
      continue
    }

    const pieces = splitTriangleByEdge(face.verts, edge.a, edge.b, midId)
    pieces.forEach(piece => {
      newFaces.push({ id: nextFaceId() + newFaces.length, verts: piece })
    })
  }
  faces = newFaces.map((face, index) => ({ ...face, id: index }))

  selectedVertexIds = [midId]
  selectedEdgeKey = null
  info.lastAction = `在边 ${edge.key.replace('_', ' - ')} 的中点插入 V${midId}，同步更新了顶点、index、边和面`
  rebuildScene()
}

function resetDemo() {
  createInitialQuad()
  info.lastAction = '已重置为一个还没切刀的四边形'
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

  for (const face of faces) {
    const a = getVertex(face.verts[0]).position
    const b = getVertex(face.verts[1]).position
    const c = getVertex(face.verts[2]).position
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([
        a.x, a.y, a.z,
        b.x, b.y, b.z,
        c.x, c.y, c.z
      ]), 3)
    )
    geometry.computeVertexNormals()

    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: 0x4dabf7,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    )
    rootGroup.add(mesh)

    const center = a.clone().add(b).add(c).multiplyScalar(1 / 3)
    const label = buildTextLabel(`F${face.id}`, '#4dabf7')
    label.position.copy(center).add(new THREE.Vector3(0, 14, 0))
    rootGroup.add(label)
  }

  for (const edge of deriveEdges()) {
    const a = getVertex(edge.a).position
    const b = getVertex(edge.b).position
    const isSelected = edge.key === selectedEdgeKey
    const color =
      isSelected ? 0xffe066 : edge.kind === 'boundary' ? 0xffffff : 0x40c057

    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([a, b]),
      new THREE.LineBasicMaterial({ color })
    )
    line.userData.edgeKey = edge.key
    edgeObjects.set(edge.key, line)
    rootGroup.add(line)

    const mid = a.clone().add(b).multiplyScalar(0.5)
    const label = buildTextLabel(
      edge.kind === 'boundary' ? `B ${edge.key}` : `E ${edge.key}`,
      edge.kind === 'boundary' ? '#ffffff' : '#40c057'
    )
    label.position.copy(mid).add(new THREE.Vector3(0, 10, 0))
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

  info.selectedVertices =
    selectedVertexIds.length === 0 ? '无' : selectedVertexIds.map(id => `V${id}`).join(', ')
  info.selectedEdge = selectedEdgeKey == null ? '无' : selectedEdgeKey.replace('_', ' - ')
  info.vertexList = vertices.map(v => `V${v.id}: (${v.position.x}, ${v.position.y}, ${v.position.z})`).join('\n')
  info.indexList = `[${faces.flatMap(face => face.verts).join(', ')}]`
  info.edgeList = deriveEdges()
    .map(edge => `${edge.kind === 'boundary' ? 'boundary' : 'internal'} ${edge.key} -> faces[${edge.faceIds.join(', ')}]`)
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
    info.lastAction = `当前吸附到的点：${selectedVertexIds.map(id => `V${id}`).join(', ')}`
  } else {
    const hit = three.raycaster.intersectObjects([...edgeObjects.values()], false)[0]
    if (!hit) return
    selectedEdgeKey = hit.object.userData.edgeKey as string
    info.lastAction = `当前选中了边 ${selectedEdgeKey.replace('_', ' - ')}`
  }

  rebuildScene()
}

onMounted(() => {
  three = createThreeBase(canvasRef.value!)
  const { scene, camera, orbit, raycaster } = three

  camera.position.set(340, 260, 340)
  orbit.target.set(0, 0, 0)
  raycaster.params.Line = raycaster.params.Line || { threshold: 1 }
  raycaster.params.Line.threshold = 10

  scene.add(new THREE.AmbientLight(0xffffff, 0.9))
  const dir = new THREE.DirectionalLight(0xffffff, 1)
  dir.position.set(260, 300, 180)
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
        <span style="margin-left:12px; opacity:0.82;">
          当前模式：{{ mode }}。这个 demo 的核心是修改顶点列表、index、边关系、面关系。
        </span>
      </div>

      <div style="width:800px; height:620px; border:1px solid #2a2a2a; border-radius:10px; overflow:hidden;">
        <canvas ref="canvasRef" style="width:800px; height:620px; display:block;" />
      </div>
    </div>

    <div style="width:400px; display:flex; flex-direction:column; gap:12px;">
      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">可做的版本</div>
        <div>
          <button @click="cutDefaultDiagonal">在四边形两个对角点间切一刀</button>
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
        <div style="margin-top:8px;">
          <button @click="resetDemo">重置</button>
        </div>
      </div>

      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">当前选择</div>
        <div>吸附到的点：{{ info.selectedVertices }}</div>
        <div>当前边：{{ info.selectedEdge }}</div>
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
        <pre style="margin:0; white-space:pre-wrap;">{{ info.faceList || '当前还没有三角面' }}</pre>
      </div>

      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">最近一次操作</div>
        <div>{{ info.lastAction }}</div>
      </div>
    </div>
  </div>
</template>
