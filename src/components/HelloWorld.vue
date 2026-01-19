<script setup lang="ts">
import { onMounted, ref } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls'
import gsap from 'gsap'

const canvasRef = ref<HTMLCanvasElement | null>(null)
let transform: TransformControls | null = null
let camera: THREE.PerspectiveCamera
let orbit: OrbitControls
let cube: THREE.Mesh

onMounted(() => {
  /** 1️⃣ 基础场景 */
  const scene = new THREE.Scene()

  camera = new THREE.PerspectiveCamera(45, 800 / 800, 1, 3000)
  camera.position.set(400, 400, 400)

  const renderer = new THREE.WebGLRenderer({
    canvas: canvasRef.value!,
    antialias: true,
  })
  renderer.setSize(800, 800)

  /** 2️⃣ 物体 */
  cube = new THREE.Mesh(
    new THREE.BoxGeometry(100, 100, 100),
    new THREE.MeshNormalMaterial()
  )
  cube.rotation.y = Math.PI / 4
  scene.add(cube)

  /** 3️⃣ 视图控制 */
  orbit = new OrbitControls(camera, renderer.domElement)
  orbit.enableDamping = true

  /** 4️⃣ TransformControls */
  transform = new TransformControls(camera, renderer.domElement)
  transform.attach(cube)
  scene.add(transform)

  /** 5️⃣ 坐标辅助 */
  const worldAxis = new THREE.AxesHelper(300)
  worldAxis.raycast = () => { } // 不可选中/拖动
  scene.add(worldAxis)


  const netGrid = new THREE.GridHelper(600, 10)
  netGrid.raycast = () => { } // 不可选中/拖动
  scene.add(netGrid)

  /** 6️⃣ Raycaster 点击选中物体 */
  const raycaster = new THREE.Raycaster()
  const mouse = new THREE.Vector2()
  function onPointerDown(event: PointerEvent) {
    const rect = renderer.domElement.getBoundingClientRect()
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(mouse, camera)
    const intersects = raycaster.intersectObjects(scene.children, false)
    if (intersects.length > 0) {
      transform?.attach(intersects[0].object)
    } else {
      transform?.detach()
    }
    console.log('onPointerDown');
  }
  renderer.domElement.addEventListener('pointerdown', onPointerDown)

  /** 7️⃣ TransformControls 平面拖动自动视角（平滑） */
  /** 7️⃣ TransformControls 平面拖动自动视角 + 约束移动 */
  transform.addEventListener('dragging-changed', (event) => {
    console.log('dragging-changed');
    orbit.enabled = !event.value

    if (event.value) {
      const axis = transform!.axis
      const target = new THREE.Vector3()
      transform!.object?.getWorldPosition(target)
      const offset = 400

      let newPos = camera.position.clone()
      switch (axis) {
        case 'XY': // 平面垂直 Z
          newPos.set(target.x, target.y, target.z + offset)
          break
        case 'XZ': // 平面垂直 Y
          newPos.set(target.x, target.y + offset, target.z)
          break
        case 'YZ': // 平面垂直 X
          newPos.set(target.x + offset, target.y, target.z)
          break
        default:
          // 单轴拖动不调整相机
          break
      }

      // 平滑移动相机位置
      if (axis === 'XY' || axis === 'XZ' || axis === 'YZ') {
        gsap.to(camera.position, {
          x: newPos.x,
          y: newPos.y,
          z: newPos.z,
          duration: 0.6,
          onUpdate: () => camera.lookAt(target)
        })
      }
    }
  })

  // 限制物体只能在 XZ 平面移动
  transform.addEventListener('objectChange', () => {
    if (transform?.object) {
      const pos = transform.object.position
      // 限制 Y 轴不变
      pos.y = 0
    }
  })


  /** 8️⃣ 动画循环 */
  function animate() {
    cube.updateMatrixWorld(true)
    orbit.update()
    renderer.render(scene, camera)
    requestAnimationFrame(animate)
  }
  animate()
})

/** 切换轴空间 */
const toggleAxis = () => {
  if (transform) {
    const currentSpace = transform.space
    transform.space = currentSpace === 'local' ? 'world' : 'local'
  }
}

// 切换 TransformControls 模式
const setTransformMode = (mode: 'translate' | 'rotate' | 'scale') => {
  if (!transform) return
  transform.mode = mode
}

// Vue template 可以加按钮

</script>

<template>
  <div>
    <button @click="setTransformMode('translate')">平移</button>
    <button @click="setTransformMode('rotate')">旋转</button>
    <button @click="setTransformMode('scale')">缩放</button>

    <button @click="toggleAxis">切换轴</button>
    <canvas ref="canvasRef" width="800" height="800" />
  </div>
</template>