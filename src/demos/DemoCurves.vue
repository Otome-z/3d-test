<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import * as THREE from 'three'
import { createThreeBase } from '@/composables/useThreeBase'

type CurveSpace = '2d' | '3d'
type CurveKey =
  | 'line2'
  | 'arc2'
  | 'ellipse2'
  | 'spline2'
  | 'quadratic2'
  | 'cubic2'
  | 'line3'
  | 'catmull3'
  | 'quadratic3'
  | 'cubic3'

type CurveSpec = {
  key: CurveKey
  label: string
  space: CurveSpace
  note: string
  controlLabels: string[]
  createPoints: () => THREE.Vector3[]
  createCurve: (points: THREE.Vector3[]) => THREE.Curve<THREE.Vector2 | THREE.Vector3>
}

type CurveSlot = 'primary' | 'secondary'

type CurveSlotState = {
  slot: CurveSlot
  spec: CurveSpec
  points: THREE.Vector3[]
  line: THREE.Line
  helperLine: THREE.Line
  controlGroup: THREE.Group
}

const canvasRef = ref<HTMLCanvasElement | null>(null)
const currentSpace = ref<CurveSpace>('2d')
const primaryCurveKey = ref<CurveKey>('line2')
const secondaryCurveKey = ref<CurveKey>('quadratic2')
const compareMode = ref(false)
const showSamplePoints = ref(true)

const info = reactive({
  selectedHandle: '未选择',
  primaryCurve: '',
  secondaryCurve: '未启用',
  lastAction: '选择一种曲线，然后点击控制点进行拖动编辑。',
  primaryPoints: '',
  secondaryPoints: '',
  primaryNote: '',
  secondaryNote: ''
})

let three: ReturnType<typeof createThreeBase> | null = null
let primarySlot: CurveSlotState | null = null
let secondarySlot: CurveSlotState | null = null
let selectedHandle: { slot: CurveSlot; index: number; marker: THREE.Mesh } | null = null
let isDraggingGizmo = false
const handle = new THREE.Object3D()
const sampleGroup = new THREE.Group()
const cleanup: Array<() => void> = []

const specs: CurveSpec[] = [
  {
    key: 'line2',
    label: 'LineCurve',
    space: '2d',
    note: '两点定义一条 2D 直线。',
    controlLabels: ['P0', 'P1'],
    createPoints: () => [new THREE.Vector3(-120, -40, 0), new THREE.Vector3(120, 90, 0)],
    createCurve: points => new THREE.LineCurve(
      new THREE.Vector2(points[0].x, points[0].y),
      new THREE.Vector2(points[1].x, points[1].y)
    )
  },
  {
    key: 'arc2',
    label: 'ArcCurve',
    space: '2d',
    note: '用圆心、起点、终点推导圆弧。',
    controlLabels: ['Center', 'Start', 'End'],
    createPoints: () => [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(90, 0, 0),
      new THREE.Vector3(0, 90, 0)
    ],
    createCurve: points => {
      const center = points[0]
      const start = points[1]
      const end = points[2]
      const radius = Math.max(10, center.distanceTo(start))
      const startAngle = Math.atan2(start.y - center.y, start.x - center.x)
      const endAngle = Math.atan2(end.y - center.y, end.x - center.x)
      return new THREE.ArcCurve(center.x, center.y, radius, startAngle, endAngle, false)
    }
  },
  {
    key: 'ellipse2',
    label: 'EllipseCurve',
    space: '2d',
    note: '这里演示完整椭圆，用中心点、X 半径、Y 半径控制。',
    controlLabels: ['Center', 'Radius X', 'Radius Y'],
    createPoints: () => [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(120, 0, 0),
      new THREE.Vector3(0, 70, 0)
    ],
    createCurve: points => {
      const center = points[0]
      const radiusX = Math.max(10, Math.abs(points[1].x - center.x))
      const radiusY = Math.max(10, Math.abs(points[2].y - center.y))
      return new THREE.EllipseCurve(center.x, center.y, radiusX, radiusY, 0, Math.PI * 2, false, 0)
    }
  },
  {
    key: 'spline2',
    label: 'SplineCurve',
    space: '2d',
    note: '2D 样条会经过一串控制点。',
    controlLabels: ['P0', 'P1', 'P2', 'P3'],
    createPoints: () => [
      new THREE.Vector3(-150, -60, 0),
      new THREE.Vector3(-40, 100, 0),
      new THREE.Vector3(60, -80, 0),
      new THREE.Vector3(150, 70, 0)
    ],
    createCurve: points => new THREE.SplineCurve(
      points.map(point => new THREE.Vector2(point.x, point.y))
    )
  },
  {
    key: 'quadratic2',
    label: 'QuadraticBezierCurve',
    space: '2d',
    note: '二次贝塞尔：起点、一个控制点、终点。',
    controlLabels: ['P0', 'Control', 'P1'],
    createPoints: () => [
      new THREE.Vector3(-140, -60, 0),
      new THREE.Vector3(0, 130, 0),
      new THREE.Vector3(140, -40, 0)
    ],
    createCurve: points => new THREE.QuadraticBezierCurve(
      new THREE.Vector2(points[0].x, points[0].y),
      new THREE.Vector2(points[1].x, points[1].y),
      new THREE.Vector2(points[2].x, points[2].y)
    )
  },
  {
    key: 'cubic2',
    label: 'CubicBezierCurve',
    space: '2d',
    note: '三次贝塞尔：起点、两个控制点、终点。',
    controlLabels: ['P0', 'C0', 'C1', 'P1'],
    createPoints: () => [
      new THREE.Vector3(-150, -80, 0),
      new THREE.Vector3(-40, 130, 0),
      new THREE.Vector3(40, -130, 0),
      new THREE.Vector3(150, 80, 0)
    ],
    createCurve: points => new THREE.CubicBezierCurve(
      new THREE.Vector2(points[0].x, points[0].y),
      new THREE.Vector2(points[1].x, points[1].y),
      new THREE.Vector2(points[2].x, points[2].y),
      new THREE.Vector2(points[3].x, points[3].y)
    )
  },
  {
    key: 'line3',
    label: 'LineCurve3',
    space: '3d',
    note: '两点定义一条 3D 直线。',
    controlLabels: ['P0', 'P1'],
    createPoints: () => [new THREE.Vector3(-120, -20, -60), new THREE.Vector3(130, 100, 80)],
    createCurve: points => new THREE.LineCurve3(points[0].clone(), points[1].clone())
  },
  {
    key: 'catmull3',
    label: 'CatmullRomCurve3',
    space: '3d',
    note: '3D 样条可以在空间里穿过多个点。',
    controlLabels: ['P0', 'P1', 'P2', 'P3'],
    createPoints: () => [
      new THREE.Vector3(-150, -40, -80),
      new THREE.Vector3(-30, 120, 20),
      new THREE.Vector3(60, -70, 90),
      new THREE.Vector3(150, 60, -40)
    ],
    createCurve: points => new THREE.CatmullRomCurve3(points.map(point => point.clone()))
  },
  {
    key: 'quadratic3',
    label: 'QuadraticBezierCurve3',
    space: '3d',
    note: '3D 二次贝塞尔，适合观察单个控制点对空间曲率的影响。',
    controlLabels: ['P0', 'Control', 'P1'],
    createPoints: () => [
      new THREE.Vector3(-140, -60, -70),
      new THREE.Vector3(0, 120, 110),
      new THREE.Vector3(140, -20, -50)
    ],
    createCurve: points => new THREE.QuadraticBezierCurve3(points[0].clone(), points[1].clone(), points[2].clone())
  },
  {
    key: 'cubic3',
    label: 'CubicBezierCurve3',
    space: '3d',
    note: '3D 三次贝塞尔拥有两个控制点，形态变化更丰富。',
    controlLabels: ['P0', 'C0', 'C1', 'P1'],
    createPoints: () => [
      new THREE.Vector3(-150, -70, -60),
      new THREE.Vector3(-40, 120, 90),
      new THREE.Vector3(40, -120, -100),
      new THREE.Vector3(150, 70, 40)
    ],
    createCurve: points => new THREE.CubicBezierCurve3(
      points[0].clone(),
      points[1].clone(),
      points[2].clone(),
      points[3].clone()
    )
  }
]

const currentSpecs = computed(() => specs.filter(spec => spec.space === currentSpace.value))

function getSpec(key: CurveKey) {
  return specs.find(spec => spec.key === key)!
}

function ensureCurveKeyForSpace(key: CurveKey, space: CurveSpace) {
  const spec = getSpec(key)
  if (spec.space === space) return key
  return specs.find(item => item.space === space)!.key
}

function slotColor(slot: CurveSlot) {
  return slot === 'primary'
    ? { line: 0x4dabf7, helper: 0xa5d8ff, marker: 0xff6b6b, selected: 0xffd43b }
    : { line: 0xff922b, helper: 0xffd8a8, marker: 0x69db7c, selected: 0xffd43b }
}

function createCurveSlot(slot: CurveSlot, spec: CurveSpec) {
  const colors = slotColor(slot)
  const points = spec.createPoints()
  const line = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: colors.line })
  )
  const helperLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineDashedMaterial({ color: colors.helper, dashSize: 10, gapSize: 6 })
  )
  const controlGroup = new THREE.Group()

  points.forEach((point, index) => {
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(7, 18, 18),
      new THREE.MeshBasicMaterial({ color: colors.marker })
    )
    marker.position.copy(point)
    marker.userData.slot = slot
    marker.userData.index = index
    controlGroup.add(marker)
  })

  const state: CurveSlotState = { slot, spec, points, line, helperLine, controlGroup }
  refreshCurveSlot(state)
  three!.scene.add(line)
  three!.scene.add(helperLine)
  three!.scene.add(controlGroup)
  return state
}

function disposeCurveSlot(state: CurveSlotState | null) {
  if (!state) return
  state.line.geometry.dispose()
  ;(state.line.material as THREE.Material).dispose()
  state.helperLine.geometry.dispose()
  ;(state.helperLine.material as THREE.Material).dispose()
  state.controlGroup.children.forEach(child => {
    const mesh = child as THREE.Mesh
    mesh.geometry.dispose()
    ;(mesh.material as THREE.Material).dispose()
  })
  state.line.parent?.remove(state.line)
  state.helperLine.parent?.remove(state.helperLine)
  state.controlGroup.parent?.remove(state.controlGroup)
}

function curvePointsToVectors(curve: THREE.Curve<THREE.Vector2 | THREE.Vector3>) {
  const points = curve.getPoints(120)
  if (points[0] instanceof THREE.Vector3) {
    return points as THREE.Vector3[]
  }
  return (points as THREE.Vector2[]).map(point => new THREE.Vector3(point.x, point.y, 0))
}

function controlPointsText(state: CurveSlotState | null) {
  if (!state) return ''
  return state.points
    .map((point, index) => {
      const label = state.spec.controlLabels[index] ?? `P${index}`
      return `${label}: (${point.x.toFixed(1)}, ${point.y.toFixed(1)}, ${point.z.toFixed(1)})`
    })
    .join('\n')
}

function refreshSamplePoints() {
  while (sampleGroup.children.length) {
    const child = sampleGroup.children[0] as THREE.Mesh
    sampleGroup.remove(child)
    child.geometry.dispose()
    ;(child.material as THREE.Material).dispose()
  }

  if (!showSamplePoints.value) return

  const slots = [primarySlot, compareMode.value ? secondarySlot : null].filter(Boolean) as CurveSlotState[]
  slots.forEach(state => {
    const curve = state.spec.createCurve(state.points)
    const points = curvePointsToVectors(curve)
    points.forEach((point, index) => {
      if (index % 12 !== 0) return
      const sample = new THREE.Mesh(
        new THREE.SphereGeometry(2.8, 10, 10),
        new THREE.MeshBasicMaterial({ color: state.slot === 'primary' ? 0xdee2e6 : 0xffec99 })
      )
      sample.position.copy(point)
      sampleGroup.add(sample)
    })
  })
}

function refreshCurveSlot(state: CurveSlotState) {
  const curve = state.spec.createCurve(state.points)
  const curvePoints = curvePointsToVectors(curve)

  state.line.geometry.dispose()
  state.line.geometry = new THREE.BufferGeometry().setFromPoints(curvePoints)

  state.helperLine.geometry.dispose()
  state.helperLine.geometry = new THREE.BufferGeometry().setFromPoints(state.points)
  ;(state.helperLine as THREE.Line<THREE.BufferGeometry, THREE.LineDashedMaterial>).computeLineDistances()

  state.points.forEach((point, index) => {
    const marker = state.controlGroup.children[index] as THREE.Mesh
    marker.position.copy(point)
  })

  refreshSamplePoints()
}

function refreshHandleColors() {
  const slots = [primarySlot, secondarySlot].filter(Boolean) as CurveSlotState[]
  slots.forEach(state => {
    const colors = slotColor(state.slot)
    state.controlGroup.children.forEach((child, index) => {
      const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial
      const active =
        selectedHandle?.slot === state.slot &&
        selectedHandle?.index === index
      material.color.setHex(active ? colors.selected : colors.marker)
    })
  })
}

function syncInfo() {
  info.selectedHandle = selectedHandle
    ? `${selectedHandle.slot === 'primary' ? '主曲线' : '对比曲线'} / P${selectedHandle.index}`
    : '未选择'

  info.primaryCurve = primarySlot ? primarySlot.spec.label : ''
  info.primaryPoints = controlPointsText(primarySlot)
  info.primaryNote = primarySlot?.spec.note ?? ''

  if (compareMode.value && secondarySlot) {
    info.secondaryCurve = secondarySlot.spec.label
    info.secondaryPoints = controlPointsText(secondarySlot)
    info.secondaryNote = secondarySlot.spec.note
  } else {
    info.secondaryCurve = '未启用'
    info.secondaryPoints = ''
    info.secondaryNote = ''
  }

  refreshHandleColors()
}

function rebuildPrimary() {
  disposeCurveSlot(primarySlot)
  primarySlot = createCurveSlot('primary', getSpec(primaryCurveKey.value))
  syncInfo()
}

function rebuildSecondary() {
  disposeCurveSlot(secondarySlot)
  secondarySlot = compareMode.value
    ? createCurveSlot('secondary', getSpec(secondaryCurveKey.value))
    : null
  syncInfo()
}

function selectHandle(slot: CurveSlot, index: number, marker: THREE.Mesh) {
  selectedHandle = { slot, index, marker }
  handle.position.copy(marker.position)
  handle.visible = true
  three?.transform.attach(handle)
  info.lastAction = `已选择 ${slot === 'primary' ? '主曲线' : '对比曲线'} 的控制点 P${index}。`
  syncInfo()
}

function clearSelection() {
  selectedHandle = null
  handle.visible = false
  three?.transform.detach()
  syncInfo()
}

function applyHandleToSelectedPoint() {
  if (!selectedHandle) return
  const state = selectedHandle.slot === 'primary' ? primarySlot : secondarySlot
  if (!state) return

  const nextPosition = handle.position.clone()
  if (state.spec.space === '2d') nextPosition.z = 0

  state.points[selectedHandle.index].copy(nextPosition)
  handle.position.copy(nextPosition)
  refreshCurveSlot(state)
  info.lastAction = `${state.spec.label} 的控制点 P${selectedHandle.index} 已更新。`
  syncInfo()
}

function resetCurrentCurves() {
  rebuildPrimary()
  if (compareMode.value) rebuildSecondary()
  clearSelection()
  info.lastAction = '已重置当前曲线到默认控制点。'
}

watch(currentSpace, nextSpace => {
  primaryCurveKey.value = ensureCurveKeyForSpace(primaryCurveKey.value, nextSpace)
  secondaryCurveKey.value = ensureCurveKeyForSpace(secondaryCurveKey.value, nextSpace)
  rebuildPrimary()
  if (compareMode.value) rebuildSecondary()
  clearSelection()
  info.lastAction = `已切换到 ${nextSpace === '2d' ? '2D' : '3D'} 曲线模式。`
})

watch(primaryCurveKey, () => {
  rebuildPrimary()
  clearSelection()
})

watch(secondaryCurveKey, () => {
  if (compareMode.value) {
    rebuildSecondary()
    clearSelection()
  }
})

watch(compareMode, enabled => {
  if (enabled) rebuildSecondary()
  else {
    disposeCurveSlot(secondarySlot)
    secondarySlot = null
    clearSelection()
    refreshSamplePoints()
    syncInfo()
  }
})

watch(showSamplePoints, () => {
  refreshSamplePoints()
})

onMounted(() => {
  three = createThreeBase(canvasRef.value!)
  const { scene, camera, orbit, raycaster, updateMouseFromEvent, transform } = three

  camera.position.set(360, 260, 360)
  orbit.target.set(0, 20, 0)

  scene.add(new THREE.AmbientLight(0xffffff, 1))
  const dir = new THREE.DirectionalLight(0xffffff, 1.1)
  dir.position.set(260, 320, 180)
  scene.add(dir)

  const grid = new THREE.GridHelper(700, 14, 0x495057, 0x343a40)
  scene.add(grid)

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(420, 420),
    new THREE.MeshBasicMaterial({
      color: 0x1c7ed6,
      transparent: true,
      opacity: 0.05,
      side: THREE.DoubleSide,
      depthWrite: false
    })
  )
  scene.add(plane)

  scene.add(sampleGroup)
  scene.add(handle)
  handle.visible = false

  primarySlot = createCurveSlot('primary', getSpec(primaryCurveKey.value))
  syncInfo()

  transform.mode = 'translate'
  transform.addEventListener('dragging-changed', (event: any) => {
    isDraggingGizmo = event.value
  })
  transform.addEventListener('objectChange', () => {
    applyHandleToSelectedPoint()
  })

  const onPointerDown = (event: PointerEvent) => {
    if (!three || isDraggingGizmo) return

    updateMouseFromEvent(event)
    raycaster.setFromCamera(three.mouse, camera)

    const objects = [
      ...(primarySlot?.controlGroup.children ?? []),
      ...(compareMode.value ? secondarySlot?.controlGroup.children ?? [] : [])
    ]
    const hit = raycaster.intersectObjects(objects, false)[0]

    if (!hit) {
      clearSelection()
      info.lastAction = '已取消控制点选择。'
      syncInfo()
      return
    }

    selectHandle(hit.object.userData.slot as CurveSlot, hit.object.userData.index as number, hit.object as THREE.Mesh)
  }

  canvasRef.value!.addEventListener('pointerdown', onPointerDown)
  cleanup.push(() => canvasRef.value?.removeEventListener('pointerdown', onPointerDown))

  three.start()
})

onBeforeUnmount(() => {
  cleanup.forEach(fn => fn())
  cleanup.length = 0

  disposeCurveSlot(primarySlot)
  disposeCurveSlot(secondarySlot)
  primarySlot = null
  secondarySlot = null

  while (sampleGroup.children.length) {
    const child = sampleGroup.children[0] as THREE.Mesh
    sampleGroup.remove(child)
    child.geometry.dispose()
    ;(child.material as THREE.Material).dispose()
  }

  three?.dispose()
  three = null
})
</script>

<template>
  <div style="display:flex; gap:16px; align-items:flex-start; flex-wrap:wrap;">
    <div style="width:860px;">
      <div style="margin-bottom:8px; line-height:1.8;">
        <button @click="currentSpace = '2d'">2D 曲线</button>
        <button @click="currentSpace = '3d'" style="margin-left:6px;">3D 曲线</button>
        <label style="margin-left:12px; display:inline-flex; align-items:center; gap:8px;">
          <input v-model="compareMode" type="checkbox" />
          <span>对比模式</span>
        </label>
        <label style="margin-left:12px; display:inline-flex; align-items:center; gap:8px;">
          <input v-model="showSamplePoints" type="checkbox" />
          <span>显示采样点</span>
        </label>
      </div>

      <div style="margin-bottom:8px; line-height:1.8;">
        <span>主曲线：</span>
        <button
          v-for="spec in currentSpecs"
          :key="`primary-${spec.key}`"
          @click="primaryCurveKey = spec.key"
          :style="primaryCurveKey === spec.key ? 'margin-left:6px; border-color:#4dabf7; background:rgba(77,171,247,0.12);' : 'margin-left:6px;'"
        >
          {{ spec.label }}
        </button>
      </div>

      <div v-if="compareMode" style="margin-bottom:8px; line-height:1.8;">
        <span>对比曲线：</span>
        <button
          v-for="spec in currentSpecs"
          :key="`secondary-${spec.key}`"
          @click="secondaryCurveKey = spec.key"
          :style="secondaryCurveKey === spec.key ? 'margin-left:6px; border-color:#ff922b; background:rgba(255,146,43,0.12);' : 'margin-left:6px;'"
        >
          {{ spec.label }}
        </button>
      </div>

      <div style="margin-bottom:8px; line-height:1.8;">
        <button @click="resetCurrentCurves">重置当前曲线</button>
        <span style="margin-left:12px; opacity:0.82;">
          主曲线是蓝色，对比曲线是橙色；控制点可直接点击并拖动编辑。
        </span>
      </div>

      <div style="width:840px; height:620px; border:1px solid #2a2a2a; border-radius:10px; overflow:hidden;">
        <canvas ref="canvasRef" style="width:840px; height:620px; display:block;" />
      </div>
    </div>

    <div style="width:420px; display:flex; flex-direction:column; gap:12px;">
      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">曲线家族</div>
        <div>2D：LineCurve、ArcCurve、EllipseCurve、SplineCurve、QuadraticBezierCurve、CubicBezierCurve。</div>
        <div>3D：LineCurve3、CatmullRomCurve3、QuadraticBezierCurve3、CubicBezierCurve3。</div>
      </div>

      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">当前选择</div>
        <div>当前模式：{{ currentSpace === '2d' ? '2D 曲线' : '3D 曲线' }}</div>
        <div>选中控制点：{{ info.selectedHandle }}</div>
        <div>主曲线：{{ info.primaryCurve }}</div>
        <div v-if="compareMode">对比曲线：{{ info.secondaryCurve }}</div>
      </div>

      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">主曲线说明</div>
        <div>{{ info.primaryNote }}</div>
        <pre style="margin:8px 0 0; white-space:pre-wrap;">{{ info.primaryPoints }}</pre>
      </div>

      <div v-if="compareMode" style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">对比曲线说明</div>
        <div>{{ info.secondaryNote }}</div>
        <pre style="margin:8px 0 0; white-space:pre-wrap;">{{ info.secondaryPoints }}</pre>
      </div>

      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">最近操作</div>
        <div>{{ info.lastAction }}</div>
      </div>
    </div>
  </div>
</template>
