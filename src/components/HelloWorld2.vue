<script setup lang="ts">
  import { ref, onMounted } from 'vue'
  import * as THREE from 'three'
  import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
  import { TransformControls } from 'three/examples/jsm/controls/TransformControls'
  
  const canvasRef = ref<HTMLCanvasElement | null>(null)
  const selectionBox = ref<HTMLDivElement | null>(null)
  
  let transform: TransformControls
  let camera: THREE.PerspectiveCamera
  let orbit: OrbitControls
  let renderer: THREE.WebGLRenderer
  
  const cubes: THREE.Mesh[] = []
  const selectedObjects: THREE.Object3D[] = []
  let offsets: THREE.Vector3[] = []
  
  // 框选模式开关
  const boxSelectMode = ref(false)
  
  onMounted(() => {
    const scene = new THREE.Scene()
    camera = new THREE.PerspectiveCamera(45, 800 / 800, 1, 3000)
    camera.position.set(400, 400, 400)
  
    renderer = new THREE.WebGLRenderer({ canvas: canvasRef.value!, antialias: true })
    renderer.setSize(800, 800)
  
    // 创建物体
    for (let i = -1; i <= 1; i += 2) {
      const cube = new THREE.Mesh(new THREE.BoxGeometry(100, 100, 100), new THREE.MeshNormalMaterial())
      cube.position.set(i * 150, 0, 0)
      cubes.push(cube)
      scene.add(cube)
    }
  
    orbit = new OrbitControls(camera, renderer.domElement)
    orbit.enableDamping = true
  
    transform = new TransformControls(camera, renderer.domElement)
    scene.add(transform)
    transform.addEventListener('dragging-changed', (e) => orbit.enabled = !e.value && !boxSelectMode.value)
  
    // 辅助轴和网格
    const axesHelper = new THREE.AxesHelper(300)
    axesHelper.raycast = () => {}
    scene.add(axesHelper)
    const grid = new THREE.GridHelper(600, 10)
    grid.raycast = () => {}
    scene.add(grid)
  
    // -------------------- 框选逻辑 --------------------
    let isSelecting = false
    const startPoint = new THREE.Vector2()
    const rect = canvasRef.value!.getBoundingClientRect()
  
    canvasRef.value!.addEventListener('pointerdown', (event) => {
      if (!boxSelectMode.value) return
      isSelecting = true
      orbit.enabled = false
      startPoint.set(event.clientX - rect.left, event.clientY - rect.top)
      if (selectionBox.value) {
        selectionBox.value.style.left = `${startPoint.x}px`
        selectionBox.value.style.top = `${startPoint.y}px`
        selectionBox.value.style.width = '0px'
        selectionBox.value.style.height = '0px'
        selectionBox.value.style.display = 'block'
      }
    })
  
    canvasRef.value!.addEventListener('pointermove', (event) => {
      if (!isSelecting || !selectionBox.value) return
      const current = new THREE.Vector2(event.clientX - rect.left, event.clientY - rect.top)
      const x = Math.min(startPoint.x, current.x)
      const y = Math.min(startPoint.y, current.y)
      const w = Math.abs(current.x - startPoint.x)
      const h = Math.abs(current.y - startPoint.y)
      selectionBox.value.style.left = `${x}px`
      selectionBox.value.style.top = `${y}px`
      selectionBox.value.style.width = `${w}px`
      selectionBox.value.style.height = `${h}px`
    })
  
    canvasRef.value!.addEventListener('pointerup', (event) => {
      if (!isSelecting) return
      isSelecting = false
      orbit.enabled = true
      if (selectionBox.value) selectionBox.value.style.display = 'none'
  
      const x1 = Math.min(startPoint.x, event.clientX - rect.left)
      const y1 = Math.min(startPoint.y, event.clientY - rect.top)
      const x2 = Math.max(startPoint.x, event.clientX - rect.left)
      const y2 = Math.max(startPoint.y, event.clientY - rect.top)
  
      const newSelection: THREE.Object3D[] = []
      cubes.forEach(obj => {
        const pos = obj.position.clone().project(camera)
        const sx = ((pos.x + 1) / 2) * rect.width
        const sy = ((-pos.y + 1) / 2) * rect.height
        if (sx >= x1 && sx <= x2 && sy >= y1 && sy <= y2) {
          newSelection.push(obj)
        }
      })
  
      if (newSelection.length) updateSelection(newSelection)
    })
  
    // -------------------- 单选/多选逻辑 --------------------
    const raycaster = new THREE.Raycaster()
    const mouse = new THREE.Vector2()
    function updateSelection(objects: THREE.Object3D[]) {
      selectedObjects.length = 0
      selectedObjects.push(...objects)
  
      const mainObject = selectedObjects[selectedObjects.length - 1]
      transform.attach(mainObject)
  
      offsets = selectedObjects.map(o => o.position.clone().sub(mainObject.position))
    }
  
    canvasRef.value!.addEventListener('pointerdown', (event) => {
      if (boxSelectMode.value) return
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(mouse, camera)
      const intersects = raycaster.intersectObjects(cubes, false)
      if (intersects.length) {
        const obj = intersects[0].object
        let newSelection = [...selectedObjects]
        if (event.ctrlKey) {
          if (!newSelection.includes(obj)) newSelection.push(obj)
        } else {
          newSelection = [obj]
        }
        updateSelection(newSelection)
      }
    })
  
    // -------------------- 拖动同步多选 --------------------
    transform.addEventListener('objectChange', () => {
      const mainObject = transform.object
      if (!mainObject) return
      selectedObjects.forEach((o, i) => {
        if (o !== mainObject) o.position.copy(mainObject.position).add(offsets[i])
        if (o !== mainObject) o.rotation.copy(mainObject.rotation)
        if (o !== mainObject) o.scale.copy(mainObject.scale)
      })
    })
  
    // -------------------- 动画循环 --------------------
    function animate() {
      orbit.update()
      renderer.render(scene, camera)
      requestAnimationFrame(animate)
    }
    animate()
  })
  
  // -------------------- UI 控制 --------------------
  const setTransformMode = (mode: 'translate' | 'rotate' | 'scale') => {
    if (transform) transform.mode = mode
  }
  
  const toggleBoxSelectMode = () => {
    boxSelectMode.value = !boxSelectMode.value
    orbit.enabled = !boxSelectMode.value
  }
  </script>
  
  <template>
    <div style="position: relative;">
      <button @click="setTransformMode('translate')">平移</button>
      <button @click="setTransformMode('rotate')">旋转</button>
      <button @click="setTransformMode('scale')">缩放</button>
      <button @click="toggleBoxSelectMode">{{ boxSelectMode ? '关闭框选' : '开启框选' }}</button>
      <p>框选模式下 Orbit 禁用，按住鼠标拖动画框选中多个物体</p>
      <canvas ref="canvasRef" width="800" height="800" />
      <div ref="selectionBox" style="position:absolute; border:1px dashed #0ff; pointer-events:none; display:none"></div>
    </div>
  </template>
  