<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import * as THREE from 'three'
import { createThreeBase } from '@/composables/useThreeBase'
import { describeCoordinateSpaces } from '@/composables/useCoordinateSpaces'

const canvasRef = ref<HTMLCanvasElement | null>(null)

let three: ReturnType<typeof createThreeBase> | null = null
let parentGroup: THREE.Group | null = null
let childGroup: THREE.Group | null = null
let localPointMarker: THREE.Mesh | null = null
let localPointLine: THREE.Line | null = null
let screenPointMarker: HTMLDivElement | null = null
let syncRaf = 0

const transformTarget = ref<'parent' | 'child'>('parent')
const transformMode = ref<'translate' | 'rotate' | 'scale'>('translate')

const localPoint = reactive({
  x: 40,
  y: 20,
  z: 10
})

const snapshot = reactive({
  local: '(0, 0, 0)',
  world: '(0, 0, 0)',
  view: '(0, 0, 0)',
  ndc: '(0, 0, 0)',
  screen: '(0, 0)',
  visible: true
})

function formatVec3(v: THREE.Vector3) {
  return `(${v.x.toFixed(6)}, ${v.y.toFixed(6)}, ${v.z.toFixed(6)})`
}

function formatVec2(v: THREE.Vector2) {
  return `(${v.x.toFixed(6)}, ${v.y.toFixed(6)})`
}

function syncMarkerPosition() {
  if (!localPointMarker) return
  localPointMarker.position.set(localPoint.x, localPoint.y, localPoint.z)

  if (localPointLine) {
    localPointLine.geometry.dispose()
    localPointLine.geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(localPoint.x, localPoint.y, localPoint.z)
    ])
  }
}

function updateTransformAttachment() {
  if (!three) return
  const target = transformTarget.value === 'parent' ? parentGroup : childGroup
  if (!target) return
  three.transform.mode = transformMode.value
  three.transform.attach(target)
}

function updateSnapshot() {
  if (!three || !childGroup) return

  const info = describeCoordinateSpaces(
    childGroup,
    new THREE.Vector3(localPoint.x, localPoint.y, localPoint.z),
    three.camera,
    three.getRect()
  )

  snapshot.local = formatVec3(info.local)
  snapshot.world = formatVec3(info.world)
  snapshot.view = formatVec3(info.view)
  snapshot.ndc = formatVec3(info.ndc)
  snapshot.screen = formatVec2(info.screen)
  snapshot.visible = info.inClipRange

  if (screenPointMarker) {
    screenPointMarker.style.left = `${info.screen.x}px`
    screenPointMarker.style.top = `${info.screen.y}px`
    screenPointMarker.style.opacity = info.inClipRange ? '1' : '0.18'
  }
}

function startSyncLoop() {
  const tick = () => {
    updateSnapshot()
    syncRaf = requestAnimationFrame(tick)
  }
  tick()
}

watch(() => [localPoint.x, localPoint.y, localPoint.z], syncMarkerPosition)
watch(transformTarget, updateTransformAttachment)
watch(transformMode, updateTransformAttachment)

onMounted(() => {
  const canvas = canvasRef.value!
  const overlay = canvas.parentElement!
  screenPointMarker = overlay.querySelector('[data-screen-point]') as HTMLDivElement | null

  three = createThreeBase(canvas)
  const { scene, camera } = three

  camera.position.set(420, 320, 420)

  parentGroup = new THREE.Group()
  parentGroup.position.set(80, 70, 0)
  parentGroup.rotation.set(0.3, 0.7, 0)
  scene.add(parentGroup)

  parentGroup.add(new THREE.AxesHelper(180))

  const parentBox = new THREE.Mesh(
    new THREE.BoxGeometry(160, 18, 18),
    new THREE.MeshBasicMaterial({ color: 0x4ecdc4, wireframe: true })
  )
  parentBox.position.set(80, 0, 0)
  parentGroup.add(parentBox)

  childGroup = new THREE.Group()
  childGroup.position.set(90, 65, 45)
  childGroup.rotation.set(0.45, -0.35, 0.2)
  parentGroup.add(childGroup)

  childGroup.add(new THREE.AxesHelper(120))

  const childMesh = new THREE.Mesh(
    new THREE.BoxGeometry(120, 70, 50),
    new THREE.MeshNormalMaterial({ transparent: true, opacity: 0.75 })
  )
  childGroup.add(childMesh)

  localPointLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(50, 0, 0)]),
    new THREE.LineBasicMaterial({ color: 0xffdd57 })
  )
  childGroup.add(localPointLine)

  localPointMarker = new THREE.Mesh(
    new THREE.SphereGeometry(7, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0xff4d6d })
  )
  childGroup.add(localPointMarker)
  syncMarkerPosition()

  const worldOriginMarker = new THREE.Mesh(
    new THREE.SphereGeometry(6, 18, 18),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  )
  scene.add(worldOriginMarker)

  updateTransformAttachment()
  updateSnapshot()
  startSyncLoop()
  three.start()
})

onBeforeUnmount(() => {
  cancelAnimationFrame(syncRaf)
  three?.dispose()
  three = null
  parentGroup = null
  childGroup = null
  localPointMarker = null
  localPointLine = null
  screenPointMarker = null
})
</script>

<template>
  <div style="display:flex; gap:16px; align-items:flex-start; flex-wrap:wrap;">
    <div style="width: 820px;">
      <div style="margin-bottom:8px; line-height:1.6;">
        <button @click="transformTarget = 'parent'">操作父节点</button>
        <button @click="transformTarget = 'child'" style="margin-left:6px;">操作子节点</button>
        <button @click="transformMode = 'translate'" style="margin-left:12px;">平移</button>
        <button @click="transformMode = 'rotate'" style="margin-left:6px;">旋转</button>
        <button @click="transformMode = 'scale'" style="margin-left:6px;">缩放</button>
        <span style="margin-left:12px; opacity:0.8;">
          先拖场景里的 gizmo，再看右侧同一个点在不同坐标系里的值如何变化
        </span>
      </div>

      <div style="position:relative; width:800px; height:620px; border:1px solid #2a2a2a; border-radius:10px; overflow:hidden;">
        <canvas ref="canvasRef" style="width:800px; height:620px; display:block;" />
        <div
          data-screen-point
          style="
            position:absolute;
            width:14px;
            height:14px;
            border-radius:999px;
            border:2px solid #ff4d6d;
            background:rgba(255,77,109,0.2);
            transform:translate(-50%, -50%);
            pointer-events:none;
            box-sizing:border-box;
          "
        />
        <div style="position:absolute; left:12px; bottom:12px; padding:10px 12px; background:rgba(0,0,0,0.48); border-radius:8px; font-size:12px; line-height:1.6;">
          白色球是 world origin。红色球是 child local point。屏幕上的红圈是它投影后的 screen 坐标。
        </div>
      </div>
    </div>

    <div style="width:360px; display:flex; flex-direction:column; gap:12px;">
      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px;">
        <div style="font-weight:700; margin-bottom:10px;">局部点</div>
        <label style="display:block; margin-bottom:8px;">
          local.x = {{ localPoint.x }}
          <input v-model.number="localPoint.x" type="range" min="-800" max="800" step="1" style="width:100%;" />
        </label>
        <label style="display:block; margin-bottom:8px;">
          local.y = {{ localPoint.y }}
          <input v-model.number="localPoint.y" type="range" min="-600" max="600" step="1" style="width:100%;" />
        </label>
        <label style="display:block;">
          local.z = {{ localPoint.z }}
          <input v-model.number="localPoint.z" type="range" min="-600" max="600" step="1" style="width:100%;" />
        </label>
      </div>

      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.8;">
        <div style="font-weight:700; margin-bottom:10px;">同一个点的五种坐标</div>
        <div><strong>Local</strong>: {{ snapshot.local }}</div>
        <div><strong>World</strong>: {{ snapshot.world }}</div>
        <div><strong>Camera/View</strong>: {{ snapshot.view }}</div>
        <div><strong>NDC</strong>: {{ snapshot.ndc }}</div>
        <div><strong>Screen</strong>: {{ snapshot.screen }}</div>
        <div style="margin-top:8px; color:#9ad1ff;">
          当前是否还在裁剪空间内：{{ snapshot.visible ? '是' : '否' }}
        </div>
      </div>

      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.7;">
        <div style="font-weight:700; margin-bottom:10px;">怎么理解</div>
        <div><strong>Local</strong> 是点相对 child 自己原点的坐标。</div>
        <div><strong>World</strong> 是把 parent / child 的层级变换都乘进去后的结果。</div>
        <div><strong>Camera/View</strong> 是站在相机视角下看的坐标，通常相机前方是负 z。</div>
        <div><strong>NDC</strong> 是投影后的标准化结果，x/y/z 大致都压到 -1 到 1。</div>
        <div><strong>Screen</strong> 是最终落在当前 canvas 上的像素位置。</div>
      </div>
    </div>
  </div>
</template>
