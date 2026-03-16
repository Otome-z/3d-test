<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import * as THREE from 'three'
import { createThreeBase } from '@/composables/useThreeBase'

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

const mode = ref<'vertex' | 'edge'>('vertex')

let mesh!: THREE.Mesh
let pointsOverlay!: THREE.Points
let edgeOverlay!: THREE.LineSegments

// Old code:
// let selectedIndex: number | null = null
// let selectedEdge: [number, number] | null = null
//
// Why not keep it:
// BoxGeometry-like meshes duplicate position indices at the same visual corner.
// If we only edit one index, one drag only moves one copy and the point looks like it needs multiple drags.
let selectedVertexGroup: number[] | null = null

// Old code:
// let selectedFaceGroupIndex: number | null = null
//
// Why change it again:
// "Move the whole face" was still not the expected behavior.
// The desired behavior is: select an outer edge of a logical face, hide the inner triangle diagonal,
// and move only that selected outer edge so the face can deform into a trapezoid.
let selectedEdgeGroups: [number[], number[]] | null = null

let coincidentVertexGroups: number[][] = []
let groupIndexByVertexIndex: number[] = []

// Old code:
// let edgePairs: Array<[number, number]> = []
//
// Why still keep this:
// It is still useful as the full set of visual edges from the indexed geometry.
// But the edge mode overlay only shows boundary edges of merged coplanar faces,
// so inner triangulation diagonals stay hidden and unselectable.
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
    // 这里把它们归到同一个 group，后面拖点/拖边时要整组一起改
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
    // 同组说明是同一个视觉顶点，不应该形成边
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
  pointsOverlay.visible = isVertex
  edgeOverlay.visible = !isVertex

  selectedVertexGroup = null
  selectedEdgeGroups = null
  handle.visible = false
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

  // 所有视觉边，主要作为基础拓扑信息保留
  edgePairs = buildUniqueEdgesFromIndexedGeometry(mesh.geometry as THREE.BufferGeometry, groupIndexByVertexIndex)

  // 把共面的三角形合并成逻辑面，供线模式使用
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

      // Old code:
      // selectedIndex = hit.index
      //
      // Why not keep it:
      // hit.index is only one position index, not the whole visual corner.
      // On a box, one visible corner usually maps to multiple position indices.
      selectedVertexGroup = coincidentVertexGroups[groupIndexByVertexIndex[hit.index]]
      selectedEdgeGroups = null

      const g = mesh.geometry as THREE.BufferGeometry
      const pos = g.getAttribute('position') as THREE.BufferAttribute
      handle.position.set(pos.getX(hit.index), pos.getY(hit.index), pos.getZ(hit.index))
      lastHandlePos.copy(handle.position)

      handle.visible = true
      transform.attach(handle)
      return
    }

    // Old code:
    // const hit = raycaster.intersectObject(edgeOverlay, false)[0]
    // const segmentIndex = Math.floor(hit.index / 2)
    // const edge = edgePairs[segmentIndex]
    //
    // Why not keep it:
    // Edge mode should ignore the inner diagonal from triangulation.
    // We first detect which logical face was clicked on the mesh, then choose the nearest boundary edge on that face.
    const hit = raycaster.intersectObject(mesh, false)[0]
    if (!hit || hit.faceIndex == null) return

    // 先根据命中的三角形，找到它所在的逻辑面
    const faceGroupIndex = triangleToFaceGroup[hit.faceIndex]
    const faceGroup = faceGroups[faceGroupIndex]
    if (!faceGroup || faceGroup.boundaryEdges.length === 0) return

    selectedVertexGroup = null

    const g = mesh.geometry as THREE.BufferGeometry
    const pos = g.getAttribute('position') as THREE.BufferAttribute
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
        // 用户点在面上时，取距离点击点最近的那条外轮廓边作为编辑目标
        minDistanceSq = distanceSq
        nearestEdge = edge
      }
    }

    // Old code:
    // selectedFaceGroupIndex = faceGroupIndex
    // move all vertexGroups of the face
    //
    // Why change it:
    // The expected behavior is not rigid face translation.
    // Only the selected outer edge should move, so the quad can deform into a trapezoid.
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
  }

  canvasRef.value!.addEventListener('pointerdown', onDown)

  transform.addEventListener('objectChange', () => {
    const g = mesh.geometry as THREE.BufferGeometry
    const pos = g.getAttribute('position') as THREE.BufferAttribute

    if (mode.value === 'vertex' && selectedVertexGroup) {
      // Old code:
      // pos.setXYZ(selectedIndex, handle.position.x, handle.position.y, handle.position.z)
      //
      // Why not keep it:
      // Updating only one duplicate index leaves the other copies behind.
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

      // Old code:
      // const movedVertexGroups = faceGroups[selectedFaceGroupIndex].vertexGroups
      // move every vertex on the whole face
      //
      // Why change it:
      // To get the trapezoid effect, only the selected boundary edge should move.
      // The opposite edge stays in place, and adjacent faces deform naturally through shared vertices.
      const [groupA, groupB] = selectedEdgeGroups
      // 只移动被选中边的两个端点组，这样矩形面就会被拉成梯形/平行四边形
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
