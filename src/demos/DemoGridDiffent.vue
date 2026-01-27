<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import SubdivisionModifier from './SubdivisionModifier' // ✅ default import

const canvasRef = ref<HTMLCanvasElement | null>(null)

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let orbit: OrbitControls | null = null
let raf = 0

let L: { solid: THREE.Mesh; wire: THREE.Mesh } | null = null
let R: { solid: THREE.Mesh; wire: THREE.Mesh } | null = null

function subdivide(bg: THREE.BufferGeometry, iterations = 2) {
  const mod = new SubdivisionModifier(iterations, {
    split: true,
    uvSmooth: false,
    preserveEdges: false,
    flatOnly: false,
  })

  const out = mod.modify(bg.clone())
  out.computeVertexNormals()
  return out
}

// 右边：手写“面分离立方体”，并统一用另一条对角线切（放大差异）
function makeFaceSeparatedCubeFlipDiag(size = 1) {
  const s = size / 2
  const verts = new Float32Array([
    // +Z
    -s, +s, +s, +s, +s, +s, +s, -s, +s, -s, -s, +s,
    // -Z
    +s, +s, -s, -s, +s, -s, -s, -s, -s, +s, -s, -s,
    // -X
    -s, +s, -s, -s, +s, +s, -s, -s, +s, -s, -s, -s,
    // +X
    +s, +s, +s, +s, +s, -s, +s, -s, -s, +s, -s, +s,
    // +Y
    -s, +s, -s, +s, +s, -s, +s, +s, +s, -s, +s, +s,
    // -Y
    -s, -s, +s, +s, -s, +s, +s, -s, -s, -s, -s, -s,
  ])

  // 每面 4 点：a b c d
  // 统一用“对角线 b-d”：(a,b,d) + (b,c,d)
  const idx: number[] = []
  for (let face = 0; face < 6; face++) {
    const base = face * 4
    idx.push(base + 0, base + 1, base + 3, base + 1, base + 2, base + 3)
  }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(verts, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

function addSolidAndWire(_scene: THREE.Scene, geo: THREE.BufferGeometry, color: number, x: number) {
  const solid = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.0 })
  )
  solid.position.set(x, 0, 0)
  _scene.add(solid)

  const wire = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ color: 0x000000, wireframe: true })
  )
  wire.position.copy(solid.position)
  _scene.add(wire)

  return { solid, wire }
}

function resizeToCanvas() {
  if (!renderer || !camera) return
  const canvas = renderer.domElement

  const width = canvas.clientWidth
  const height = canvas.clientHeight
  if (width === 0 || height === 0) return

  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const needResize = canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)

  if (needResize) {
    renderer.setPixelRatio(dpr)
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }
}

function disposeObject3D(obj: THREE.Object3D) {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose?.()
    const mat = (mesh as any).material
    if (mat) {
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose?.())
      else mat.dispose?.()
    }
  })
}

onMounted(() => {
  const canvas = canvasRef.value!
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0xf5f5f5)

  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
  camera.position.set(4, 3, 4)
  camera.lookAt(0, 0, 0)

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false)

  orbit = new OrbitControls(camera, renderer.domElement)
  orbit.enableDamping = true
  orbit.target.set(0, 0, 0)

  // lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.6))
  const dir = new THREE.DirectionalLight(0xffffff, 1.0)
  dir.position.set(3, 5, 4)
  scene.add(dir)

  // 左：BoxGeometry
  const leftBase = new THREE.BoxGeometry(1, 1, 1)
  const leftSmooth = subdivide(leftBase, 2)
  L = addSolidAndWire(scene, leftSmooth, 0x22cc55, -1.8)

  // 右：面分离 + 翻对角线
  const rightBase = makeFaceSeparatedCubeFlipDiag(1)
  const rightSmooth = subdivide(rightBase, 2)
  R = addSolidAndWire(scene, rightSmooth, 0xff3344, +1.8)

  const animate = () => {
    raf = requestAnimationFrame(animate)
    resizeToCanvas()
    orbit?.update()

    if (L && R) {
      L.solid.rotation.y += 0.01
      L.wire.rotation.y += 0.01
      R.solid.rotation.y += 0.01
      R.wire.rotation.y += 0.01
    }

    renderer!.render(scene!, camera!)
  }

  animate()
  window.addEventListener('resize', resizeToCanvas)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', resizeToCanvas)
  cancelAnimationFrame(raf)

  if (scene) disposeObject3D(scene)

  orbit?.dispose()
  renderer?.dispose()

  L = null
  R = null
  orbit = null
  renderer = null
  camera = null
  scene = null
})
</script>

<template>
  <div style="width: 800px;">
    <canvas ref="canvasRef" style="width: 800px; height: 800px;" />
  </div>
</template>
