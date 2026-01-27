<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import * as THREE from 'three'
import { createThreeBase, type ThreeBase } from '@/composables/useThreeBase'
import { EditableMesh } from './EditableMesh'

const canvasRef = ref<HTMLCanvasElement | null>(null)

let three: ThreeBase | null = null
let solid: THREE.Mesh | null = null
let wire: THREE.Mesh | null = null
let tickRaf = 0

function addSolidAndWire(scene: THREE.Scene, geo: THREE.BufferGeometry) {
  const solid = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color: 0x22cc55, roughness: 0.9, metalness: 0.0 })
  )
  scene.add(solid)

  const wire = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x000000, wireframe: true }))
  scene.add(wire)

  return { solid, wire }
}

function disposeMesh(m: THREE.Mesh | null, disposeGeometry = true) {
  if (!m) return
  // 注意：wire 和 solid 共用 geometry 时，别重复 dispose geometry
  if (disposeGeometry) m.geometry.dispose()
  const mat = m.material
  if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
  else mat.dispose()
}

onMounted(() => {
  const canvas = canvasRef.value!
  three = createThreeBase(canvas)

  const { scene, camera, orbit } = three

  // 你 composable 里已经加了 axes/grid，这里只加灯
  scene.add(new THREE.AmbientLight(0xffffff, 0.7))
  const dir = new THREE.DirectionalLight(0xffffff, 1)
  dir.position.set(300, 500, 400)
  scene.add(dir)

  // 相机位置（你 composable 默认 400,400,400 也行，这里对齐一下）
  camera.position.set(300, 220, 300)
  camera.lookAt(0, 0, 0)
  orbit.target.set(0, 0, 0)

  // 1) 渲染用基础几何体
  const base = new THREE.BoxGeometry(100, 100, 100)

  // 2) 导入到 EditableMesh（编辑用）
  // weld: true 可以把“面分离”的情况合并顶点，建立连续拓扑
  const em = EditableMesh.fromBufferGeometry(base, { weld: true, epsilon: 1e-6 })

  // 3) 演示：算一个 edge loop（打印在控制台）
  const eid = em.findEdgeByVerts(0, 1)
  if (eid != null) {
    const loop = em.getEdgeLoop(eid, { stopAtBoundary: true, maxSteps: 999 })
    console.log('edge loop edgeIds:', loop)
    console.log('edge loop edge count:', loop.length)
  } else {
    console.warn('cannot find edge(0,1)')
  }

  // 4) 导出回 BufferGeometry（渲染用）
  const renderGeo = em.toBufferGeometry()

  // 5) 加到场景
  const M = addSolidAndWire(scene, renderGeo)
  solid = M.solid
  wire = M.wire

  // 旋转更好观察（你 three.loop 里只负责渲染，这里单独做动画）
  const tick = () => {
    tickRaf = requestAnimationFrame(tick)
    if (solid && wire) {
      solid.rotation.y += 0.01
      wire.rotation.y += 0.01
    }
  }
  tick()

  // 开始渲染循环（useThreeBase 内部 render）
  three.start()
})

onBeforeUnmount(() => {
  cancelAnimationFrame(tickRaf)

  // 清理 mesh（wire 和 solid 共用 geometry，所以只 dispose 一次 geometry）
  disposeMesh(wire, false) // 不 dispose geometry
  disposeMesh(solid, true) // dispose geometry
  if (wire && three?.scene) three.scene.remove(wire)
  if (solid && three?.scene) three.scene.remove(solid)

  wire = null
  solid = null

  three?.dispose()
  three = null
})
</script>

<template>
  <div style="width: 800px; height: 800px;">
    <canvas ref="canvasRef" style="width: 800px; height: 800px; display: block;" />
  </div>
</template>
