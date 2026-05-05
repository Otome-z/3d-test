<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const container = ref<HTMLElement | null>(null)

let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let renderer: THREE.WebGLRenderer
let controls: OrbitControls
let animationId: number

// Mesh parameters
const Nx = 16 // Number of longitudinal wires
const Nz = 18 // Number of transverse wires
const spacingX = 1.0
const spacingZ = 1.0
const radius = 0.15
const crimpAmp = 0.28 // Amplitude of transverse crimp

const startX = -((Nx - 1) * spacingX) / 2
const startZ = -((Nz - 1) * spacingZ) / 2

// Macro surface function (Gaussian bump)
function surfaceY(x: number, z: number): number {
  return 3.0 * Math.exp(-(x * x + z * z) / 25)
}

// Easing for sine wave (flattens tops and bottoms slightly)
function easeCrimp(t: number): number {
  return Math.sin(t) // simple sine
}

onMounted(() => {
  if (!container.value) return

  // Scene
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0xf5f5f5)

  // Camera
  camera = new THREE.PerspectiveCamera(45, container.value.clientWidth / container.value.clientHeight, 0.1, 1000)
  camera.position.set(20, 20, 20)

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(container.value.clientWidth, container.value.clientHeight)
  renderer.setPixelRatio(window.devicePixelRatio)
  container.value.appendChild(renderer.domElement)

  // Controls
  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.target.set(0, 0, 0)

  // Lights
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
  scene.add(ambientLight)

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8)
  dirLight.position.set(10, 20, 10)
  dirLight.castShadow = true
  scene.add(dirLight)

  const fillLight = new THREE.DirectionalLight(0xffffff, 0.4)
  fillLight.position.set(-10, 10, -10)
  scene.add(fillLight)

  // Materials
  const materialLong = new THREE.MeshStandardMaterial({
    color: 0x999999, // Gray for longitudinal wires
    roughness: 0.4,
    metalness: 0.5
  })

  const materialWhite = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.3,
    metalness: 0.1
  })

  const materialGrey = new THREE.MeshStandardMaterial({
    color: 0xaaaaaa,
    roughness: 0.4,
    metalness: 0.4
  })

  const materialYellow = new THREE.MeshStandardMaterial({
    color: 0xffd700,
    roughness: 0.3,
    metalness: 0.2
  })

  // 1. Longitudinal wires (straight down z axis, bending with macro surface)
  const lengthZ = Nz * spacingZ + 6 // Extends out further
  const startLongZ = -lengthZ / 2
  for (let i = 0; i < Nx; i++) {
    const x = startX + i * spacingX
    const points = []
    const steps = 150

    for (let k = 0; k <= steps; k++) {
      const z = startLongZ + (k / steps) * lengthZ
      const y = surfaceY(x, z)
      points.push(new THREE.Vector3(x, y, z))
    }

    const curve = new THREE.CatmullRomCurve3(points)
    const geometry = new THREE.TubeGeometry(curve, steps, radius * 0.8, 12, false)
    const mesh = new THREE.Mesh(geometry, materialLong)
    scene.add(mesh)
  }

  // 2. Transverse wires (crimped over and under longitudinal wires)
  // They run along X
  for (let j = 0; j < Nz; j++) {
    const z = startZ + j * spacingZ

    // Choose material based on pattern matching the image
    let mat = materialWhite
    if (j === 3 || j === 4) mat = materialGrey
    if (j === 7 || j === 12) mat = materialGrey
    if (j === 9) mat = materialYellow

    // Calculate length, offset for aesthetic stagger
    // Some wires extend further than others
    let lengthX = Nx * spacingX + 8
    let offset = 0
    if (j % 3 === 0) offset = 2
    if (j % 5 === 0) offset = -1

    const localStartX = -lengthX / 2 + offset
    const points = []
    const steps = 200

    for (let k = 0; k <= steps; k++) {
      const x = localStartX + (k / steps) * lengthX

      // Base macro height
      let y = surfaceY(x, z)

      // Micro height (crimp)
      // Only crimp if x is within the bounds of the longitudinal wires
      if (x > startX - spacingX && x < startX + (Nx - 1) * spacingX + spacingX) {
        // We calculate phase based on x coordinate relative to longitudinal wires
        // phase should be PI for every spacingX
        const phase = ((x - startX) / spacingX) * Math.PI

        // Alternating crimp based on j (even/odd)
        const sign = (j % 2 === 0) ? 1 : -1

        const crimpY = sign * crimpAmp * easeCrimp(phase)
        y += crimpY
      }

      points.push(new THREE.Vector3(x, y, z))
    }

    const curve = new THREE.CatmullRomCurve3(points)
    const geometry = new THREE.TubeGeometry(curve, steps, radius, 12, false)
    const mesh = new THREE.Mesh(geometry, mat)
    scene.add(mesh)
  }

  // Resize handler
  const onResize = () => {
    if (!container.value) return
    camera.aspect = container.value.clientWidth / container.value.clientHeight
    camera.updateProjectionMatrix()
    renderer.setSize(container.value.clientWidth, container.value.clientHeight)
  }
  window.addEventListener('resize', onResize)

  // Animation loop
  const animate = () => {
    animationId = requestAnimationFrame(animate)
    controls.update()
    renderer.render(scene, camera)
  }
  animate()

  onUnmounted(() => {
    window.removeEventListener('resize', onResize)
    cancelAnimationFrame(animationId)
    renderer.dispose()
    if (container.value) {
      container.value.removeChild(renderer.domElement)
    }
  })
})
</script>

<template>
  <div ref="container" style="width: 100%; height: 100%;"></div>
</template>
