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
const Nz = 18 // Number of transverse wire PAIRS
const spacingX = 1.0
const spacingZ = 1.0
const radiusLong = 0.12
const radiusTransverse = 0.10
const crimpAmp = 0.28 // Amplitude of transverse crimp (y-axis)
const zWobbleAmp = 0.15 // Amplitude of Z-axis wobble so the two lines twist around each other

const startX = -((Nx - 1) * spacingX) / 2
const startZ = -((Nz - 1) * spacingZ) / 2

// Macro surface function (Gaussian bump)
function surfaceY(x: number, z: number): number {
  return 3.0 * Math.exp(-(x * x + z * z) / 25)
}

// Z-shaped wave function for Y height
function zWave(t: number): number {
  let n = (t / Math.PI) % 2
  if (n < 0) n += 2

  const flatRatio = 0.4
  const slopeRatio = 1.0 - flatRatio

  if (n < flatRatio / 2) return 1.0
  if (n < 1 - flatRatio / 2) {
    const p = (n - flatRatio / 2) / slopeRatio
    return 1.0 - 2.0 * p
  }
  if (n < 1 + flatRatio / 2) return -1.0
  if (n < 2 - flatRatio / 2) {
    const p = (n - (1 + flatRatio / 2)) / slopeRatio
    return -1.0 + 2.0 * p
  }
  return 1.0
}

// Simple sine for Z wobble (they move left and right slightly to cross each other)
function zWobble(t: number): number {
  return Math.sin(t)
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
  const lengthZ = Nz * spacingZ + 6
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
    const geometry = new THREE.TubeGeometry(curve, steps, radiusLong, 12, false)
    const mesh = new THREE.Mesh(geometry, materialLong)
    scene.add(mesh)
  }

  // 2. Transverse wire PAIRS (two intertwined zigzag wires)
  for (let j = 0; j < Nz; j++) {
    const baseZ = startZ + j * spacingZ

    // Choose material based on pattern matching the image
    let mat = materialWhite
    if (j === 3 || j === 4) mat = materialGrey
    if (j === 7 || j === 12) mat = materialGrey
    if (j === 9) mat = materialYellow

    let lengthX = Nx * spacingX + 8
    let offset = 0
    if (j % 3 === 0) offset = 2
    if (j % 5 === 0) offset = -1

    const localStartX = -lengthX / 2 + offset
    const steps = 300 // Higher resolution for tight bends

    // Wire A (Starts high, goes low)
    const pointsA = []
    // Wire B (Starts low, goes high)
    const pointsB = []

    for (let k = 0; k <= steps; k++) {
      const x = localStartX + (k / steps) * lengthX

      // Base macro height at this x, z
      let baseY = surfaceY(x, baseZ)

      let yA = baseY
      let yB = baseY
      let zA = baseZ
      let zB = baseZ

      // Only crimp if x is within the bounds of the longitudinal wires
      if (x > startX - spacingX && x < startX + (Nx - 1) * spacingX + spacingX) {
        // phase should be PI for every spacingX
        const phase = ((x - startX) / spacingX) * Math.PI

        // Z-Wave for Y height (A and B are out of phase)
        const crimpYA = crimpAmp * zWave(phase)
        const crimpYB = crimpAmp * zWave(phase + Math.PI)

        yA += crimpYA
        yB += crimpYB

        // Z-Wobble so they cross without intersecting
        const wobble = zWobbleAmp * Math.sin(phase)
        zA += wobble
        zB -= wobble
      }

      pointsA.push(new THREE.Vector3(x, yA, zA))
      pointsB.push(new THREE.Vector3(x, yB, zB))
    }

    const curveA = new THREE.CatmullRomCurve3(pointsA)
    const geometryA = new THREE.TubeGeometry(curveA, steps, radiusTransverse, 12, false)
    const meshA = new THREE.Mesh(geometryA, mat)
    scene.add(meshA)

    const curveB = new THREE.CatmullRomCurve3(pointsB)
    const geometryB = new THREE.TubeGeometry(curveB, steps, radiusTransverse, 12, false)
    const meshB = new THREE.Mesh(geometryB, mat)
    scene.add(meshB)
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
