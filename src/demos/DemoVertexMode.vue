<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import * as THREE from 'three'
import { createThreeBase } from '@/composables/useThreeBase'

type EditMode = 'vertex' | 'edge' | 'face'

type FaceGroup = {
  // 合并后的逻辑面法线，用来判断哪些三角形属于同一个平面
  normal: THREE.Vector3
  // 平面方程常量项，配合法线做共面判断
  planeConstant: number
  // 这个逻辑面包含的三角形索引
  triangles: number[]
  // 这个逻辑面涉及到哪些“视觉顶点组”
  vertexGroups: number[]
  // 逻辑面的外轮廓边，内部三角对角线不会出现在这里
  boundaryEdges: Array<[number, number]>
}

type EdgeOverlayEntry = {
  // 这条可见边属于哪个逻辑面
  faceGroupIndex: number
  // 边的两个端点，存的是“视觉顶点组 id”
  edge: [number, number]
}

const canvasRef = ref<HTMLCanvasElement | null>(null)
let three: ReturnType<typeof createThreeBase> | null = null

const handle = new THREE.Object3D()
handle.visible = false

const mode = ref<EditMode>('vertex')

let mesh!: THREE.Mesh
let pointsOverlay!: THREE.Points
let edgeOverlay!: THREE.LineSegments

// 旧逻辑：
// let selectedIndex: number | null = null
// let selectedEdge: [number, number] | null = null
//
// 改动原因：
// BoxGeometry 这类几何为了保留每个面的法线/UV，同一个视觉顶点通常会拆成多个 position 索引。
// 如果只记录单个 index，那么拖一次只会移动其中一份数据，看起来就像同一个点要拖很多次。
let selectedVertexGroup: number[] | null = null

// 线模式：只移动被点击外轮廓边的两个端点组，这样矩形面可以被拖成梯形。
let selectedEdgeGroups: [number[], number[]] | null = null

// 面模式：移动整个逻辑面的所有顶点组，这样正方体可以被拖成长方体。
let selectedFaceGroupIndex: number | null = null

let coincidentVertexGroups: number[][] = []
let groupIndexByVertexIndex: number[] = []

// 保留所有视觉边的基础拓扑信息
let edgePairs: Array<[number, number]> = []
// 共面的三角形会被合并成一个逻辑面，例如 BoxGeometry 的一个矩形面其实由两个三角形组成
let faceGroups: FaceGroup[] = []
// triangle faceIndex -> 逻辑面索引，点击 mesh 面时要靠它找到所属逻辑面
let triangleToFaceGroup: number[] = []
// 真正渲染到 edgeOverlay 上的边列表，只包含逻辑面的外轮廓边
let edgeOverlayEntries: EdgeOverlayEntry[] = []

const lastHandlePos = new THREE.Vector3()
const cleanup: Array<() => void> = []

function getVertexPositionKey(x: number, y: number, z: number) {
  // 用坐标字符串把“同一位置的多个索引”归并到同一组
  return `${x.toFixed(6)}_${y.toFixed(6)}_${z.toFixed(6)}`
}

function buildCoincidentVertexGroups(g: THREE.BufferGeometry) {
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const keyToGroup = new Map<string, number>()
  const groups: number[][] = []
  const vertexToGroup = new Array<number>(pos.count)

  for (let i = 0; i < pos.count; i++) {
    // BufferGeometry 的 position 里，同一个视觉点可能出现多次
    // 这里把它们归到同一个 group，后面拖点/拖边/拖面时要整组一起改
    const key = getVertexPositionKey(pos.getX(i), pos.getY(i), pos.getZ(i))
    let groupIndex = keyToGroup.get(key)
    if (groupIndex == null) {
      groupIndex = groups.length
      keyToGroup.set(key, groupIndex)
      groups.push([])
    }

    groups[groupIndex].push(i)
    vertexToGroup[i] = groupIndex
  }

  return { groups, vertexToGroup }
}

function buildUniqueEdgesFromIndexedGeometry(g: THREE.BufferGeometry, vertexToGroup: number[]) {
  const index = g.getIndex()
  if (!index) return []

  const pairs: Array<[number, number]> = []
  const seen = new Set<string>()

  const addEdge = (a: number, b: number) => {
    const ga = vertexToGroup[a]
    const gb = vertexToGroup[b]
    if (ga === gb) return

    const i0 = Math.min(ga, gb)
    const i1 = Math.max(ga, gb)
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

function buildFaceGroups(g: THREE.BufferGeometry, vertexToGroup: number[]) {
  const index = g.getIndex()
  if (!index) return { faceGroups: [], triangleToFaceGroup: [] }

  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const triangleCount = index.count / 3
  const triangles: Array<{
    verts: [number, number, number]
    edges: Array<[number, number]>
    normal: THREE.Vector3
    planeConstant: number
  }> = []
  const edgeToTriangles = new Map<string, number[]>()
  const tmpA = new THREE.Vector3()
  const tmpB = new THREE.Vector3()
  const tmpC = new THREE.Vector3()
  const ab = new THREE.Vector3()
  const ac = new THREE.Vector3()
  const planeEpsilon = 1e-5

  const sortEdge = (a: number, b: number): [number, number] => (a < b ? [a, b] : [b, a])

  for (let t = 0; t < triangleCount; t++) {
    // 先把每个三角形转换成“视觉顶点组”的表达，方便后面按逻辑面合并
    const ia = index.getX(t * 3)
    const ib = index.getX(t * 3 + 1)
    const ic = index.getX(t * 3 + 2)
    const va = vertexToGroup[ia]
    const vb = vertexToGroup[ib]
    const vc = vertexToGroup[ic]

    tmpA.set(pos.getX(ia), pos.getY(ia), pos.getZ(ia))
    tmpB.set(pos.getX(ib), pos.getY(ib), pos.getZ(ib))
    tmpC.set(pos.getX(ic), pos.getY(ic), pos.getZ(ic))

    const normal = ab.subVectors(tmpB, tmpA).cross(ac.subVectors(tmpC, tmpA)).normalize().clone()
    const planeConstant = normal.dot(tmpA)
    const edges: Array<[number, number]> = [
      sortEdge(va, vb),
      sortEdge(vb, vc),
      sortEdge(vc, va)
    ]

    triangles.push({
      verts: [va, vb, vc],
      edges,
      normal,
      planeConstant
    })

    for (const edge of edges) {
      // 记录每条边被哪些三角形使用，后面可以找出内部边和外轮廓边
      const key = `${edge[0]}_${edge[1]}`
      const list = edgeToTriangles.get(key) ?? []
      list.push(t)
      edgeToTriangles.set(key, list)
    }
  }

  const triangleToGroup = new Array<number>(triangleCount).fill(-1)
  const groups: FaceGroup[] = []

  const areCoplanar = (a: number, b: number) => {
    const ta = triangles[a]
    const tb = triangles[b]
    // 法线几乎一致且平面常量接近，就认为这两个三角形属于同一个平面
    return ta.normal.dot(tb.normal) > 1 - planeEpsilon && Math.abs(ta.planeConstant - tb.planeConstant) < planeEpsilon
  }

  for (let t = 0; t < triangleCount; t++) {
    if (triangleToGroup[t] !== -1) continue

    const groupIndex = groups.length
    const queue = [t]
    const triangleIndices: number[] = []
    const vertexSet = new Set<number>()
    const edgeCount = new Map<string, [number, number, number]>()
    triangleToGroup[t] = groupIndex

    while (queue.length) {
      const current = queue.pop()!
      const tri = triangles[current]
      triangleIndices.push(current)

      for (const vertexGroup of tri.verts) {
        vertexSet.add(vertexGroup)
      }

      for (const edge of tri.edges) {
        const key = `${edge[0]}_${edge[1]}`
        const existing = edgeCount.get(key)
        if (existing) {
          existing[2] += 1
        } else {
          edgeCount.set(key, [edge[0], edge[1], 1])
        }

        for (const neighbor of edgeToTriangles.get(key) ?? []) {
          if (neighbor === current || triangleToGroup[neighbor] !== -1) continue
          if (!areCoplanar(current, neighbor)) continue
          // 共面且共享边的三角形，会被并到同一个逻辑面里
          triangleToGroup[neighbor] = groupIndex
          queue.push(neighbor)
        }
      }
    }

    groups.push({
      normal: triangles[t].normal.clone(),
      planeConstant: triangles[t].planeConstant,
      triangles: triangleIndices,
      vertexGroups: Array.from(vertexSet),
      // 只保留只被一个三角形使用的边，这些边就是外轮廓边
      // 被两个三角形共享的那条边，就是矩形面中间的对角线，会在这里被排除掉
      boundaryEdges: Array.from(edgeCount.values())
        .filter(([, , count]) => count === 1)
        .map(([a, b]) => [a, b] as [number, number])
    })
  }

  return { faceGroups: groups, triangleToFaceGroup: triangleToGroup }
}

function buildPointsOverlay(mesh: THREE.Mesh) {
  const g = mesh.geometry as THREE.BufferGeometry
  const ptsGeo = new THREE.BufferGeometry()
  // 点模式直接复用 mesh 的 position，这样顶点一变，点位会自动跟着更新
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

function buildEdgeOverlay(mesh: THREE.Mesh, entries: EdgeOverlayEntry[]) {
  const linePos = new Float32Array(entries.length * 2 * 3)
  const lineGeo = new THREE.BufferGeometry()
  // 线模式自己维护一份展开后的线段坐标，只画逻辑面的外轮廓边
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

  line.frustumCulled = false
  mesh.add(line)
  updateEdgeOverlayPositions(mesh, entries, line)
  return line
}

function updateEdgeOverlayPositions(mesh: THREE.Mesh, entries: EdgeOverlayEntry[], line: THREE.LineSegments) {
  const g = mesh.geometry as THREE.BufferGeometry
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const linePos = line.geometry.getAttribute('position') as THREE.BufferAttribute

  let o = 0
  for (let i = 0; i < entries.length; i++) {
    const [groupA, groupB] = entries[i].edge
    // 每个 group 取第一个索引即可，因为同组索引在正常状态下代表同一个视觉点
    const a = coincidentVertexGroups[groupA][0]
    const b = coincidentVertexGroups[groupB][0]

    linePos.setXYZ(o++, pos.getX(a), pos.getY(a), pos.getZ(a))
    linePos.setXYZ(o++, pos.getX(b), pos.getY(b), pos.getZ(b))
  }

  linePos.needsUpdate = true
}

function applyModeVisibility() {
  const isVertex = mode.value === 'vertex'
  const isEdge = mode.value === 'edge'

  pointsOverlay.visible = isVertex
  edgeOverlay.visible = isEdge

  selectedVertexGroup = null
  selectedEdgeGroups = null
  selectedFaceGroupIndex = null
  handle.visible = false
}

function setMode(nextMode: EditMode) {
  mode.value = nextMode
  applyModeVisibility()
}

onMounted(() => {
  three = createThreeBase(canvasRef.value!)
  const { scene, raycaster, camera, updateMouseFromEvent, transform } = three

  const base = new THREE.BoxGeometry(150, 150, 150)
  mesh = new THREE.Mesh(base, new THREE.MeshNormalMaterial({ side: THREE.DoubleSide }))
  scene.add(mesh)

  pointsOverlay = buildPointsOverlay(mesh)

  const groupedVertices = buildCoincidentVertexGroups(mesh.geometry as THREE.BufferGeometry)
  coincidentVertexGroups = groupedVertices.groups
  groupIndexByVertexIndex = groupedVertices.vertexToGroup

  edgePairs = buildUniqueEdgesFromIndexedGeometry(mesh.geometry as THREE.BufferGeometry, groupIndexByVertexIndex)

  const groupedFaces = buildFaceGroups(mesh.geometry as THREE.BufferGeometry, groupIndexByVertexIndex)
  faceGroups = groupedFaces.faceGroups
  triangleToFaceGroup = groupedFaces.triangleToFaceGroup
  edgeOverlayEntries = faceGroups.flatMap((faceGroup, faceGroupIndex) =>
    faceGroup.boundaryEdges.map(edge => ({ faceGroupIndex, edge }))
  )

  edgeOverlay = buildEdgeOverlay(mesh, edgeOverlayEntries)
  edgeOverlay.visible = false

  mesh.add(handle)
  applyModeVisibility()

  raycaster.params.Line = raycaster.params.Line || { threshold: 1 }
  raycaster.params.Line.threshold = 6

  const onDown = (ev: PointerEvent) => {
    updateMouseFromEvent(ev)
    raycaster.setFromCamera(three!.mouse, camera)

    if (mode.value === 'vertex') {
      const hit = raycaster.intersectObject(pointsOverlay, false)[0]
      if (!hit || hit.index == null) return

      // 旧逻辑：
      // selectedIndex = hit.index
      //
      // 改动原因：
      // hit.index 只是当前命中的那一个 position 索引，不是“视觉上的那个点”。
      // 对 box 这种模型，一个角点往往对应 3 份索引，所以这里要取整组。
      selectedVertexGroup = coincidentVertexGroups[groupIndexByVertexIndex[hit.index]]
      selectedEdgeGroups = null
      selectedFaceGroupIndex = null

      const g = mesh.geometry as THREE.BufferGeometry
      const pos = g.getAttribute('position') as THREE.BufferAttribute
      handle.position.set(pos.getX(hit.index), pos.getY(hit.index), pos.getZ(hit.index))
      lastHandlePos.copy(handle.position)

      handle.visible = true
      transform.attach(handle)
      return
    }

    const hit = raycaster.intersectObject(mesh, false)[0]
    if (!hit || hit.faceIndex == null) return

    // 先根据命中的三角形，找到它所在的逻辑面
    const faceGroupIndex = triangleToFaceGroup[hit.faceIndex]
    const faceGroup = faceGroups[faceGroupIndex]
    if (!faceGroup) return

    const g = mesh.geometry as THREE.BufferGeometry
    const pos = g.getAttribute('position') as THREE.BufferAttribute

    if (mode.value === 'edge') {
      // 线模式不直接拾取三角形边线，而是先找到逻辑面，再取距离点击点最近的外轮廓边。
      const localHitPoint = mesh.worldToLocal(hit.point.clone())
      let nearestEdge = faceGroup.boundaryEdges[0]
      let minDistanceSq = Infinity

      for (const edge of faceGroup.boundaryEdges) {
        const a = coincidentVertexGroups[edge[0]][0]
        const b = coincidentVertexGroups[edge[1]][0]
        const start = new THREE.Vector3(pos.getX(a), pos.getY(a), pos.getZ(a))
        const end = new THREE.Vector3(pos.getX(b), pos.getY(b), pos.getZ(b))
        const closest = new THREE.Line3(start, end).closestPointToPoint(localHitPoint, true, new THREE.Vector3())
        const distanceSq = closest.distanceToSquared(localHitPoint)

        if (distanceSq < minDistanceSq) {
          minDistanceSq = distanceSq
          nearestEdge = edge
        }
      }

      selectedVertexGroup = null
      selectedFaceGroupIndex = null
      selectedEdgeGroups = [
        coincidentVertexGroups[nearestEdge[0]],
        coincidentVertexGroups[nearestEdge[1]]
      ]

      const a = coincidentVertexGroups[nearestEdge[0]][0]
      const b = coincidentVertexGroups[nearestEdge[1]][0]
      const ax = pos.getX(a)
      const ay = pos.getY(a)
      const az = pos.getZ(a)
      const bx = pos.getX(b)
      const by = pos.getY(b)
      const bz = pos.getZ(b)

      handle.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2)
      lastHandlePos.copy(handle.position)
      handle.visible = true
      transform.attach(handle)
      return
    }

    // 面模式：直接选中整个逻辑面，把控制器放到逻辑面中心。
    selectedVertexGroup = null
    selectedEdgeGroups = null
    selectedFaceGroupIndex = faceGroupIndex

    const center = new THREE.Vector3()
    for (const vertexGroup of faceGroup.vertexGroups) {
      const vertexIndex = coincidentVertexGroups[vertexGroup][0]
      center.add(new THREE.Vector3(pos.getX(vertexIndex), pos.getY(vertexIndex), pos.getZ(vertexIndex)))
    }
    center.multiplyScalar(1 / faceGroup.vertexGroups.length)

    handle.position.copy(center)
    lastHandlePos.copy(handle.position)
    handle.visible = true
    transform.attach(handle)
  }

  canvasRef.value!.addEventListener('pointerdown', onDown)

  transform.addEventListener('objectChange', () => {
    const g = mesh.geometry as THREE.BufferGeometry
    const pos = g.getAttribute('position') as THREE.BufferAttribute

    if (mode.value === 'vertex' && selectedVertexGroup) {
      // 旧逻辑：
      // pos.setXYZ(selectedIndex, handle.position.x, handle.position.y, handle.position.z)
      //
      // 改动原因：
      // 这里只改一个索引会导致同一个视觉顶点只移动一部分，剩余重复索引还留在原位。
      for (const index of selectedVertexGroup) {
        pos.setXYZ(index, handle.position.x, handle.position.y, handle.position.z)
      }

      pos.needsUpdate = true
      g.computeVertexNormals()
      updateEdgeOverlayPositions(mesh, edgeOverlayEntries, edgeOverlay)
      return
    }

    if (mode.value === 'edge' && selectedEdgeGroups) {
      const dx = handle.position.x - lastHandlePos.x
      const dy = handle.position.y - lastHandlePos.y
      const dz = handle.position.z - lastHandlePos.z
      if (dx === 0 && dy === 0 && dz === 0) return

      // 线模式：只移动被选中边的两个端点组，这样矩形面会被拉成梯形/平行四边形。
      const [groupA, groupB] = selectedEdgeGroups
      for (const index of groupA) {
        pos.setXYZ(index, pos.getX(index) + dx, pos.getY(index) + dy, pos.getZ(index) + dz)
      }

      for (const index of groupB) {
        pos.setXYZ(index, pos.getX(index) + dx, pos.getY(index) + dy, pos.getZ(index) + dz)
      }

      pos.needsUpdate = true
      lastHandlePos.copy(handle.position)
      g.computeVertexNormals()
      updateEdgeOverlayPositions(mesh, edgeOverlayEntries, edgeOverlay)
      return
    }

    if (mode.value === 'face' && selectedFaceGroupIndex != null) {
      const dx = handle.position.x - lastHandlePos.x
      const dy = handle.position.y - lastHandlePos.y
      const dz = handle.position.z - lastHandlePos.z
      if (dx === 0 && dy === 0 && dz === 0) return

      // 面模式：移动整个逻辑面的所有顶点组。
      // 对立方体来说，拖动正面会让它整体前后伸缩，正方体就能变成长方体。
      const movedVertexGroups = faceGroups[selectedFaceGroupIndex].vertexGroups
      for (const vertexGroup of movedVertexGroups) {
        for (const index of coincidentVertexGroups[vertexGroup]) {
          pos.setXYZ(index, pos.getX(index) + dx, pos.getY(index) + dy, pos.getZ(index) + dz)
        }
      }

      pos.needsUpdate = true
      lastHandlePos.copy(handle.position)
      g.computeVertexNormals()
      updateEdgeOverlayPositions(mesh, edgeOverlayEntries, edgeOverlay)
    }
  })

  three.start()
  cleanup.push(() => canvasRef.value!.removeEventListener('pointerdown', onDown))
})

onBeforeUnmount(() => {
  cleanup.forEach(fn => fn())
  cleanup.length = 0
  three?.dispose()
  three = null
})
</script>

<template>
  <div style="width: 800px;">
    <div style="margin-bottom: 8px;">
      <button @click="setMode('vertex')">点模式</button>
      <button @click="setMode('edge')" style="margin-left: 8px;">线模式</button>
      <button @click="setMode('face')" style="margin-left: 8px;">面模式</button>
      <div style="margin-top: 8px;">
        当前模式：{{ mode === 'vertex' ? '点模式' : mode === 'edge' ? '线模式' : '面模式' }}
      </div>
    </div>
    <canvas ref="canvasRef" style="width: 800px; height: 800px;" />
  </div>
</template>
