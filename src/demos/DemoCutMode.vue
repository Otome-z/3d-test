<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import * as THREE from 'three'
import { createThreeBase } from '@/composables/useThreeBase'

const canvasRef = ref<HTMLCanvasElement | null>(null)
let three: ReturnType<typeof createThreeBase> | null = null

let mesh: THREE.Mesh
let cutFirst: number | null = null

const preview = new THREE.Line(
  new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({ color: 0xff00ff, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false })
)
preview.visible = false
preview.renderOrder = 20
preview.frustumCulled = false
preview.raycast = () => {}

function pickSnappedVertex(ev: PointerEvent, mesh: THREE.Mesh, snapDist = 14) {
  if (!three) return null
  const { raycaster, camera, updateMouseFromEvent } = three

  updateMouseFromEvent(ev)
  raycaster.setFromCamera(three.mouse, camera)
  const hit = raycaster.intersectObject(mesh, false)[0]
  if (!hit || hit.faceIndex == null) return null

  const g = mesh.geometry as THREE.BufferGeometry
  const idx = g.getIndex()
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  if (!idx) return null

  const tri = hit.faceIndex
  const ia = (idx.array as any)[tri * 3 + 0] as number
  const ib = (idx.array as any)[tri * 3 + 1] as number
  const ic = (idx.array as any)[tri * 3 + 2] as number

  const a = new THREE.Vector3(pos.getX(ia), pos.getY(ia), pos.getZ(ia)).applyMatrix4(mesh.matrixWorld)
  const b = new THREE.Vector3(pos.getX(ib), pos.getY(ib), pos.getZ(ib)).applyMatrix4(mesh.matrixWorld)
  const c = new THREE.Vector3(pos.getX(ic), pos.getY(ic), pos.getZ(ic)).applyMatrix4(mesh.matrixWorld)

  const p = hit.point
  const da = p.distanceTo(a), db = p.distanceTo(b), dc = p.distanceTo(c)

  let v = ia, d = da
  if (db < d) { d = db; v = ib }
  if (dc < d) { d = dc; v = ic }
  return d <= snapDist ? v : null
}

function updatePreview(v1: number, v2: number) {
  const g = mesh.geometry as THREE.BufferGeometry
  const pos = g.getAttribute('position') as THREE.BufferAttribute

  const p1 = new THREE.Vector3(pos.getX(v1), pos.getY(v1), pos.getZ(v1))
  const p2 = new THREE.Vector3(pos.getX(v2), pos.getY(v2), pos.getZ(v2))

  const arr = new Float32Array([p1.x, p1.y, p1.z, p2.x, p2.y, p2.z])
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3))

  preview.geometry.dispose()
  preview.geometry = geo
}

function turnDiagonalTo(geometry: THREE.BufferGeometry, v1: number, v2: number) {
  const idx = geometry.getIndex()
  if (!idx) return false

  const arr = Array.from(idx.array as ArrayLike<number>)
  const triCount = arr.length / 3

  const candidates: number[] = []
  for (let t = 0; t < triCount; t++) {
    const a = arr[t * 3 + 0], b = arr[t * 3 + 1], c = arr[t * 3 + 2]
    if ([a, b, c].includes(v1) || [a, b, c].includes(v2)) candidates.push(t)
  }

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const t1 = candidates[i], t2 = candidates[j]
      const A = [arr[t1 * 3 + 0], arr[t1 * 3 + 1], arr[t1 * 3 + 2]]
      const B = [arr[t2 * 3 + 0], arr[t2 * 3 + 1], arr[t2 * 3 + 2]]

      const shared = A.filter(x => B.includes(x))
      if (shared.length !== 2) continue

      const union = Array.from(new Set([...A, ...B]))
      if (union.length !== 4) continue
      if (!union.includes(v1) || !union.includes(v2)) continue

      const others = union.filter(x => x !== v1 && x !== v2)
      if (others.length !== 2) continue
      const o1 = others[0], o2 = others[1]

      const pos = geometry.getAttribute('position') as THREE.BufferAttribute
      const p = (k: number) => new THREE.Vector3(pos.getX(k), pos.getY(k), pos.getZ(k))

      const refN = new THREE.Vector3()
      refN.copy(p(A[1]).sub(p(A[0]))).cross(p(A[2]).sub(p(A[0]))).normalize()

      const tri1 = [v1, o1, v2]
      const n1 = new THREE.Vector3().copy(p(tri1[1]).sub(p(tri1[0]))).cross(p(tri1[2]).sub(p(tri1[0]))).normalize()
      if (n1.dot(refN) < 0) [tri1[1], tri1[2]] = [tri1[2], tri1[1]]

      const tri2 = [v1, v2, o2]
      const n2 = new THREE.Vector3().copy(p(tri2[1]).sub(p(tri2[0]))).cross(p(tri2[2]).sub(p(tri2[0]))).normalize()
      if (n2.dot(refN) < 0) [tri2[1], tri2[2]] = [tri2[2], tri2[1]]

      arr[t1 * 3 + 0] = tri1[0]; arr[t1 * 3 + 1] = tri1[1]; arr[t1 * 3 + 2] = tri1[2]
      arr[t2 * 3 + 0] = tri2[0]; arr[t2 * 3 + 1] = tri2[1]; arr[t2 * 3 + 2] = tri2[2]

      geometry.setIndex(arr)
      geometry.computeVertexNormals()
      return true
    }
  }
  return false
}

onMounted(() => {
  three = createThreeBase(canvasRef.value!)
  const { scene } = three

  // 用一个 Plane 更容易观察“对角线翻转”
  const geo = new THREE.PlaneGeometry(250, 250, 1, 1)
  geo.rotateX(-Math.PI / 2)

  // 让它 indexed（PlaneGeometry 默认就是 indexed，但这里保持一致）
  mesh = new THREE.Mesh(geo, new THREE.MeshNormalMaterial({ side: THREE.DoubleSide }))
  scene.add(mesh)

  mesh.add(preview)

  const onDown = (ev: PointerEvent) => {
    const v = pickSnappedVertex(ev, mesh, 18)
    if (v == null) return

    if (cutFirst == null) {
      cutFirst = v
      preview.visible = true
      updatePreview(v, v)
      return
    }

    if (v === cutFirst) return
    turnDiagonalTo(mesh.geometry as THREE.BufferGeometry, cutFirst, v)
    cutFirst = null
    preview.visible = false
  }

  const onMove = (ev: PointerEvent) => {
    if (cutFirst == null) return
    const v = pickSnappedVertex(ev, mesh, 24)
    if (v == null) return
    updatePreview(cutFirst, v)
  }

  canvasRef.value!.addEventListener('pointerdown', onDown)
  canvasRef.value!.addEventListener('pointermove', onMove)

  cleanup.push(() => {
    canvasRef.value!.removeEventListener('pointerdown', onDown)
    canvasRef.value!.removeEventListener('pointermove', onMove)
  })

  three.start()
})

const cleanup: Array<() => void> = []
onBeforeUnmount(() => {
  cleanup.forEach(fn => fn())
  cleanup.length = 0
  three?.dispose()
  three = null
})
</script>

<template>
  <div style="width: 800px;">
    <div style="margin-bottom: 8px;">Cut Demo：点两次（两个对角点）→ 翻转对角线</div>
    <canvas ref="canvasRef" style="width: 800px; height: 800px;" />
  </div>
</template>
