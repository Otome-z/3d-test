<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import * as THREE from 'three'
import { createThreeBase } from '@/composables/useThreeBase'

const canvasRef = ref<HTMLCanvasElement | null>(null)
let three: ReturnType<typeof createThreeBase> | null = null

const handle = new THREE.Object3D()
handle.visible = false

const mode = ref<'vertex' | 'edge'>('vertex')

let mesh!: THREE.Mesh
let pointsOverlay!: THREE.Points
let edgeOverlay!: THREE.LineSegments

let selectedVertexGroup: number[] | null = null
let selectedEdgeGroups: [number[], number[]] | null = null

let coincidentVertexGroups: number[][] = []
let groupIndexByVertexIndex: number[] = []
let edgePairs: Array<[number, number]> = []

const lastHandlePos = new THREE.Vector3()
const cleanup: Array<() => void> = []

function getVertexPositionKey(x: number, y: number, z: number) {
  return `${x.toFixed(6)}_${y.toFixed(6)}_${z.toFixed(6)}`
}

function buildCoincidentVertexGroups(g: THREE.BufferGeometry) {
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const keyToGroup = new Map<string, number>()
  const groups: number[][] = []
  const vertexToGroup = new Array<number>(pos.count)

  for (let i = 0; i < pos.count; i++) {
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

function buildPointsOverlay(mesh: THREE.Mesh) {
  const g = mesh.geometry as THREE.BufferGeometry
  const ptsGeo = new THREE.BufferGeometry()
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

function buildEdgeOverlay(mesh: THREE.Mesh, edgePairs: Array<[number, number]>) {
  const linePos = new Float32Array(edgePairs.length * 2 * 3)
  const lineGeo = new THREE.BufferGeometry()
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
  updateEdgeOverlayPositions(mesh, edgePairs, line)
  return line
}

function updateEdgeOverlayPositions(mesh: THREE.Mesh, edgePairs: Array<[number, number]>, line: THREE.LineSegments) {
  const g = mesh.geometry as THREE.BufferGeometry
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const linePos = line.geometry.getAttribute('position') as THREE.BufferAttribute

  let o = 0
  for (let i = 0; i < edgePairs.length; i++) {
    const [groupA, groupB] = edgePairs[i]
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
  edgePairs = buildUniqueEdgesFromIndexedGeometry(mesh.geometry as THREE.BufferGeometry, groupIndexByVertexIndex)
  edgeOverlay = buildEdgeOverlay(mesh, edgePairs)
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

    const hit = raycaster.intersectObject(edgeOverlay, false)[0]
    if (!hit || hit.index == null) return

    const edge = edgePairs[hit.index]
    if (!edge) return

    selectedEdgeGroups = [coincidentVertexGroups[edge[0]], coincidentVertexGroups[edge[1]]]
    selectedVertexGroup = null

    const a = coincidentVertexGroups[edge[0]][0]
    const b = coincidentVertexGroups[edge[1]][0]
    const g = mesh.geometry as THREE.BufferGeometry
    const pos = g.getAttribute('position') as THREE.BufferAttribute
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
      for (const index of selectedVertexGroup) {
        pos.setXYZ(index, handle.position.x, handle.position.y, handle.position.z)
      }

      pos.needsUpdate = true
      g.computeVertexNormals()
      updateEdgeOverlayPositions(mesh, edgePairs, edgeOverlay)
      return
    }

    if (mode.value === 'edge' && selectedEdgeGroups) {
      const [groupA, groupB] = selectedEdgeGroups
      const dx = handle.position.x - lastHandlePos.x
      const dy = handle.position.y - lastHandlePos.y
      const dz = handle.position.z - lastHandlePos.z
      if (dx === 0 && dy === 0 && dz === 0) return

      for (const index of groupA) {
        pos.setXYZ(index, pos.getX(index) + dx, pos.getY(index) + dy, pos.getZ(index) + dz)
      }

      for (const index of groupB) {
        pos.setXYZ(index, pos.getX(index) + dx, pos.getY(index) + dy, pos.getZ(index) + dz)
      }

      pos.needsUpdate = true
      lastHandlePos.copy(handle.position)
      g.computeVertexNormals()
      updateEdgeOverlayPositions(mesh, edgePairs, edgeOverlay)
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
