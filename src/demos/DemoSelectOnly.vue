<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import * as THREE from 'three'
import { createThreeBase } from '@/composables/useThreeBase'

const canvasRef = ref<HTMLCanvasElement | null>(null)

let three: ReturnType<typeof createThreeBase> | null = null

// 场景里的可选物体
const meshes: THREE.Mesh[] = []

// 当前选中集合（只存 Mesh）
const selected: THREE.Mesh[] = []

// 多选时的虚拟控制器（TransformControls attach 到它）
const virtualControl = new THREE.Object3D()
virtualControl.visible = false

// 多选偏移量：每个对象相对中心点的 offset（用于同步移动/缩放/旋转）
let offsets: THREE.Vector3[] = []

/** 选中高亮：用 emissive 做最直观 */
function setSelected(mesh: THREE.Mesh, value: boolean) {
  const mat = mesh.material as THREE.MeshStandardMaterial
  mat.emissive.setHex(value ? 0x004444 : 0x000000) // 选中时自发光=0x004444(青绿色)，未选中=0x000000(黑色/无自发光)
}

/** 清空选择 + 解除 gizmo */
function clearSelection() {
  selected.forEach(m => setSelected(m, false))
  selected.length = 0
  offsets = []
  virtualControl.visible = false
  three?.transform.detach()
}

/**
 * 更新选择集合，并决定 TransformControls attach 到谁：
 * - 单选：attach 到该 mesh
 * - 多选：attach 到 virtualControl（中心 gizmo）
 */
function updateSelection(next: THREE.Mesh[]) {
  // 1) 清掉旧选中高亮
  selected.forEach(m => setSelected(m, false))
  selected.length = 0

  // 2) 设置新选中高亮
  next.forEach(m => {
    selected.push(m)
    setSelected(m, true)
  })

  if (!three) return

  // 3) attach gizmo
  if (selected.length === 0) {
    clearSelection()
    return
  }

  if (selected.length === 1) {
    virtualControl.visible = false
    offsets = [new THREE.Vector3()] // 占位（单选其实不用）
    three.transform.attach(selected[0])
    return
  }

  // 多选：计算中心点，让 gizmo 在中心
  const center = new THREE.Vector3()
  selected.forEach(o => center.add(o.position))
  center.multiplyScalar(1 / selected.length)

  virtualControl.position.copy(center)
  virtualControl.rotation.set(0, 0, 0)
  virtualControl.scale.set(1, 1, 1)
  virtualControl.visible = true

  offsets = selected.map(o => o.position.clone().sub(center))
  three.transform.attach(virtualControl)
}

onMounted(() => {
  three = createThreeBase(canvasRef.value!)
  const { scene, raycaster, camera, updateMouseFromEvent, transform } = three

  // 光照（StandardMaterial 需要灯光）
  scene.add(new THREE.AmbientLight(0xffffff, 0.6)) // 环境光(颜色，光强度)
  const dir = new THREE.DirectionalLight(0xffffff, 0.6)// 平行光(颜色，光强度)
  dir.position.set(300, 400, 200)
  scene.add(dir)

  // 把 virtualControl 放进场景（多选时 attach 用）
  scene.add(virtualControl)

  // 创建 5 个立方体
  for (let i = -2; i <= 2; i++) {
    const geo = new THREE.BoxGeometry(80, 80, 80)
    const mat = new THREE.MeshStandardMaterial({
      color: 0x999999,
      emissive: 0x000000,
      side: THREE.DoubleSide // 相机进到内部看也有颜色
    })
    const m = new THREE.Mesh(geo, mat)
    m.position.set(i * 120, 0, 0)
    meshes.push(m)
    scene.add(m)
  }

  /**
   * 点击选择逻辑（带 Ctrl 多选）
   * 注意：TransformControls 拖动时会触发 pointerdown，
   * 但 createThreeBase 里已经在 dragging-changed 里禁用了 orbit；
   * 这里我们再判断：如果正在拖动 gizmo，就不要改选择。
   */
  let isDraggingGizmo = false
  transform.addEventListener('dragging-changed', (e: any) => {
    isDraggingGizmo = e.value
  })

  const onPointerDown = (ev: PointerEvent) => {
    if (isDraggingGizmo) return

    updateMouseFromEvent(ev)
    raycaster.setFromCamera(three!.mouse, camera)
    const hits = raycaster.intersectObjects(meshes, false)

    // 点空白：清空选择
    if (!hits.length) {
      clearSelection()
      return
    }

    const hitMesh = hits[0].object as THREE.Mesh

    // Ctrl：切换该物体的选中状态
    if (ev.ctrlKey) {
      if (selected.includes(hitMesh)) {
        updateSelection(selected.filter(m => m !== hitMesh))
      } else {
        updateSelection([...selected, hitMesh])
      }
    } else {
      // 普通点击：单选
      updateSelection([hitMesh])
    }
  }

  canvasRef.value!.addEventListener('pointerdown', onPointerDown)

  /**
   * 多选同步：
   * 当 transform attach 在 virtualControl 上时，
   * 你拖动/旋转/缩放的是 virtualControl，所以要把它的变化同步到每个选中对象。
   */
  transform.addEventListener('objectChange', () => {
    if (selected.length <= 1) return
    if (transform.object !== virtualControl) return

    selected.forEach((o, i) => {
      // 位置：中心点 + 每个对象的偏移
      o.position.copy(virtualControl.position).add(offsets[i])

      // 旋转/缩放：这个 demo 先做“全部跟随同一旋转/缩放”
      // 如果你要更像 Max 的“保持相对朝向”，会涉及初始旋转差的缓存
      o.rotation.copy(virtualControl.rotation)
      o.scale.copy(virtualControl.scale)
    })
  })

  // 默认先选中一个，方便你一进来就验证 gizmo
  updateSelection([meshes[0]])

  three.start()

  cleanup.push(() => canvasRef.value!.removeEventListener('pointerdown', onPointerDown))
})

const cleanup: Array<() => void> = []
onBeforeUnmount(() => {
  cleanup.forEach(fn => fn())
  cleanup.length = 0

  meshes.forEach(m => {
    ;(m.geometry as THREE.BufferGeometry).dispose()
    ;(m.material as THREE.Material).dispose()
  })

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
      <span style="margin-left: 10px;">
        点击单选｜Ctrl+点击多选/取消｜点空白清空
      </span>
    </div>

    <canvas ref="canvasRef" style="width: 800px; height: 800px;" />
  </div>
</template>
