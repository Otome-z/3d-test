<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import * as THREE from 'three'
import { createThreeBase } from '@/composables/useThreeBase'

const canvasRef = ref<HTMLCanvasElement | null>(null)

let three: ReturnType<typeof createThreeBase> | null = null
const meshes: THREE.Mesh[] = []
const selected: THREE.Object3D[] = []

// 多选用虚拟中心 gizmo
const virtualControl = new THREE.Object3D()
virtualControl.visible = false
let offsets: THREE.Vector3[] = []

function updateSelection(objects: THREE.Object3D[]) {
  selected.length = 0
  selected.push(...objects)

  if (!three) return
  const { transform } = three

  if (selected.length > 1) {
    const center = new THREE.Vector3()
    selected.forEach(o => center.add(o.position))
    center.multiplyScalar(1 / selected.length)

    virtualControl.position.copy(center)
    virtualControl.rotation.set(0, 0, 0)
    virtualControl.scale.set(1, 1, 1)
    virtualControl.visible = true

    offsets = selected.map(o => o.position.clone().sub(center))
    transform.attach(virtualControl)
  } else {
    virtualControl.visible = false
    transform.attach(selected[0])
  }
}

onMounted(() => {
  const canvas = canvasRef.value!
  three = createThreeBase(canvas)
  const { scene, raycaster, camera, updateMouseFromEvent, transform } = three

  scene.add(virtualControl)

  // demo meshes
  for (let i = -1; i <= 1; i += 2) {
    const geo = new THREE.BoxGeometry(100, 100, 100)
    const mat = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide }) // 内部看也有颜色
    const m = new THREE.Mesh(geo, mat)
    m.position.set(i * 150, 0, 0)
    meshes.push(m)
    scene.add(m)
  }

  // 点击选中
  const onDown = (ev: PointerEvent) => {
    updateMouseFromEvent(ev)
    raycaster.setFromCamera(three!.mouse, camera)
    const hits = raycaster.intersectObjects(meshes, false)
    if (!hits.length) return
    const obj = hits[0].object
    if (ev.ctrlKey) {
      const next = selected.includes(obj) ? selected : [...selected, obj]
      updateSelection(next)
    } else {
      updateSelection([obj])
    }
  }
  canvas.addEventListener('pointerdown', onDown)

  // 多选同步（virtualControl 变换 → 每个对象）
  transform.addEventListener('objectChange', () => {
    if (selected.length <= 1) return
    selected.forEach((o, i) => {
      o.position.copy(virtualControl.position).add(offsets[i])
      o.rotation.copy(virtualControl.rotation)
      o.scale.copy(virtualControl.scale)
    })
  })

  updateSelection([meshes[0]])
  three.start()

  cleanup.push(() => canvas.removeEventListener('pointerdown', onDown))
})

const cleanup: Array<() => void> = []
onBeforeUnmount(() => {
  cleanup.forEach(fn => fn())
  cleanup.length = 0
  three?.dispose()
  three = null
})

const setMode = (mode: 'translate' | 'rotate' | 'scale') => {
  if (!three) return
  three.transform.mode = mode
}
</script>

<template>
  <div style="width: 800px;">
    <div style="margin-bottom: 8px;">
      <button @click="setMode('translate')">平移</button>
      <button @click="setMode('rotate')">旋转</button>
      <button @click="setMode('scale')">缩放</button>
      <span style="margin-left: 10px;">点击选中，Ctrl 多选</span>
    </div>
    <canvas ref="canvasRef" style="width: 800px; height: 800px;" />
  </div>
</template>
