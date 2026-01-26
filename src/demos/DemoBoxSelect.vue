<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import * as THREE from 'three'
import { createThreeBase } from '@/composables/useThreeBase'

const canvasRef = ref<HTMLCanvasElement | null>(null)
const selectionBox = ref<HTMLDivElement | null>(null)

let three: ReturnType<typeof createThreeBase> | null = null
const meshes: THREE.Mesh[] = []
const selected: THREE.Object3D[] = []

let isSelecting = false
const startPoint = new THREE.Vector2()

function updateSelection(objects: THREE.Object3D[]) {
  selected.length = 0
  selected.push(...objects)
  // demo：这里只更新选中集合（你也可以加高亮材质）
}

onMounted(() => {
  const canvas = canvasRef.value!
  three = createThreeBase(canvas)
  const { scene, camera, getRect, orbit } = three

  // demo meshes
  for (let x = -2; x <= 2; x++) {
    const geo = new THREE.BoxGeometry(60, 60, 60)
    const mat = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide })
    const m = new THREE.Mesh(geo, mat)
    m.position.set(x * 120, 0, 0)
    meshes.push(m)
    scene.add(m)
  }

  const onDown = (ev: PointerEvent) => {
    isSelecting = true
    orbit.enabled = false
    const rect = getRect()
    startPoint.set(ev.clientX - rect.left, ev.clientY - rect.top)

    if (selectionBox.value) {
      selectionBox.value.style.left = `${startPoint.x}px`
      selectionBox.value.style.top = `${startPoint.y}px`
      selectionBox.value.style.width = `0px`
      selectionBox.value.style.height = `0px`
      selectionBox.value.style.display = `block`
    }
  }

  const onMove = (ev: PointerEvent) => {
    if (!isSelecting || !selectionBox.value) return
    const rect = getRect()
    const cur = new THREE.Vector2(ev.clientX - rect.left, ev.clientY - rect.top)

    const x = Math.min(startPoint.x, cur.x)
    const y = Math.min(startPoint.y, cur.y)
    const w = Math.abs(cur.x - startPoint.x)
    const h = Math.abs(cur.y - startPoint.y)

    selectionBox.value.style.left = `${x}px`
    selectionBox.value.style.top = `${y}px`
    selectionBox.value.style.width = `${w}px`
    selectionBox.value.style.height = `${h}px`
  }

  const onUp = (ev: PointerEvent) => {
    if (!isSelecting) return
    isSelecting = false
    orbit.enabled = true
    if (selectionBox.value) selectionBox.value.style.display = 'none'

    const rect = getRect()
    const endX = ev.clientX - rect.left
    const endY = ev.clientY - rect.top

    const x1 = Math.min(startPoint.x, endX)
    const y1 = Math.min(startPoint.y, endY)
    const x2 = Math.max(startPoint.x, endX)
    const y2 = Math.max(startPoint.y, endY)

    const picked: THREE.Object3D[] = []
    meshes.forEach(obj => {
      const p = obj.position.clone().project(camera)
      const sx = ((p.x + 1) / 2) * rect.width
      const sy = ((-p.y + 1) / 2) * rect.height
      if (sx >= x1 && sx <= x2 && sy >= y1 && sy <= y2) picked.push(obj)
    })
    updateSelection(picked)
  }

  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)

  cleanup.push(() => {
    canvas.removeEventListener('pointerdown', onDown)
    canvas.removeEventListener('pointermove', onMove)
    canvas.removeEventListener('pointerup', onUp)
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
  <div style="position: relative; width: 800px; height: 800px;">
    <div style="margin-bottom: 8px;">拖拽框选（这里只演示框选，不做 Transform）</div>
    <canvas ref="canvasRef" style="width: 800px; height: 800px;" />
    <div
      ref="selectionBox"
      style="position:absolute; border:1px dashed #0ff; pointer-events:none; display:none; left:0; top:0;"
    />
  </div>
</template>
