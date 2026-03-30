<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import * as THREE from 'three'
import { createThreeBase } from '@/composables/useThreeBase'

type MaterialKey = 'basic' | 'lambert' | 'phong' | 'standard'

const canvasRef = ref<HTMLCanvasElement | null>(null)
const currentMaterial = ref<MaterialKey>('standard')
const ambientEnabled = ref(true)
const directionalEnabled = ref(true)
const pointEnabled = ref(true)
const helperVisible = ref(true)
const autoRotateLight = ref(true)
const ambientIntensity = ref(0.35)
const directionalIntensity = ref(1.2)
const pointIntensity = ref(1.5)

const info = reactive({
  materialName: 'MeshStandardMaterial',
  materialDesc: '同时能看到高光、粗糙度和金属度，最适合演示灯光变化。',
  lightSummary: '当前同时开启了环境光、平行光和点光源。',
  pointPosition: '(180, 150, 120)'
})

let three: ReturnType<typeof createThreeBase> | null = null
let stageGroup: THREE.Group | null = null
let ambientLight: THREE.AmbientLight | null = null
let directionalLight: THREE.DirectionalLight | null = null
let directionalHelper: THREE.DirectionalLightHelper | null = null
let pointLight: THREE.PointLight | null = null
let pointLightHelper: THREE.PointLightHelper | null = null
let animationFrame = 0
let pointLightAngle = 0

const demoMeshes: THREE.Mesh[] = []

function createMaterial(kind: MaterialKey) {
  switch (kind) {
    case 'basic':
      return new THREE.MeshBasicMaterial({ color: 0xff922b })
    case 'lambert':
      return new THREE.MeshLambertMaterial({ color: 0x4dabf7 })
    case 'phong':
      return new THREE.MeshPhongMaterial({
        color: 0x69db7c,
        shininess: 90,
        specular: 0xffffff
      })
    case 'standard':
    default:
      return new THREE.MeshStandardMaterial({
        color: 0xf8f9fa,
        roughness: 0.28,
        metalness: 0.58
      })
  }
}

function updateMaterialInfo() {
  if (currentMaterial.value === 'basic') {
    info.materialName = 'MeshBasicMaterial'
    info.materialDesc = '不受灯光影响，颜色始终稳定，适合拿来对比“为什么有些材质看不出打光效果”。'
    return
  }

  if (currentMaterial.value === 'lambert') {
    info.materialName = 'MeshLambertMaterial'
    info.materialDesc = '只做漫反射，受光方向变化明显，但高光不强，适合观察基础受光关系。'
    return
  }

  if (currentMaterial.value === 'phong') {
    info.materialName = 'MeshPhongMaterial'
    info.materialDesc = '有更明显的镜面高光，点光源和方向变化会比较直观。'
    return
  }

  info.materialName = 'MeshStandardMaterial'
  info.materialDesc = '基于 PBR，能同时体现环境光、主光和点光源在粗糙/金属表面上的差异。'
}

function updateLightSummary() {
  const parts: string[] = []
  if (ambientEnabled.value) parts.push('环境光')
  if (directionalEnabled.value) parts.push('平行光')
  if (pointEnabled.value) parts.push('点光源')

  info.lightSummary = parts.length
    ? `当前开启：${parts.join(' + ')}。`
    : '当前所有灯光都关闭了，只剩下不受光照影响的材质还能看清。'
}

function applyMaterialToMeshes() {
  demoMeshes.forEach(mesh => {
    mesh.material.dispose()
    mesh.material = createMaterial(currentMaterial.value)
  })
  updateMaterialInfo()
}

function updateLights() {
  if (!ambientLight || !directionalLight || !pointLight || !pointLightHelper || !directionalHelper) return

  ambientLight.visible = ambientEnabled.value
  ambientLight.intensity = ambientIntensity.value

  directionalLight.visible = directionalEnabled.value
  directionalLight.intensity = directionalIntensity.value
  directionalHelper.visible = directionalEnabled.value
  directionalHelper.update()

  pointLight.visible = pointEnabled.value
  pointLight.intensity = pointIntensity.value
  pointLightHelper.visible = helperVisible.value && pointEnabled.value
  pointLightHelper.update()

  updateLightSummary()
}

function buildStage() {
  if (!three) return

  stageGroup = new THREE.Group()
  three.scene.add(stageGroup)

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(220, 64),
    new THREE.MeshStandardMaterial({
      color: 0x343a40,
      roughness: 0.92,
      metalness: 0.08
    })
  )
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -75
  floor.receiveShadow = true
  stageGroup.add(floor)

  const geometries = [
    new THREE.SphereGeometry(42, 48, 48),
    new THREE.BoxGeometry(72, 72, 72),
    new THREE.TorusKnotGeometry(26, 8, 140, 18),
    new THREE.ConeGeometry(40, 92, 48)
  ]
  const positions = [-180, -60, 70, 190]

  geometries.forEach((geometry, index) => {
    const mesh = new THREE.Mesh(geometry, createMaterial(currentMaterial.value))
    mesh.position.set(positions[index], index === 3 ? -25 : -8, 0)
    mesh.castShadow = true
    mesh.receiveShadow = true
    demoMeshes.push(mesh)
    stageGroup!.add(mesh)
  })
}

function disposeStage() {
  demoMeshes.forEach(mesh => {
    mesh.geometry.dispose()
    mesh.material.dispose()
    mesh.parent?.remove(mesh)
  })
  demoMeshes.length = 0

  if (!stageGroup) return
  while (stageGroup.children.length) {
    const child = stageGroup.children[0]
    stageGroup.remove(child)
  }
  stageGroup.parent?.remove(stageGroup)
  stageGroup = null
}

function startLightMotion() {
  const tick = () => {
    animationFrame = requestAnimationFrame(tick)
    if (!pointLight || !pointLightHelper) return

    if (autoRotateLight.value) {
      pointLightAngle += 0.01
      pointLight.position.set(
        Math.cos(pointLightAngle) * 180,
        135 + Math.sin(pointLightAngle * 1.7) * 45,
        Math.sin(pointLightAngle) * 150
      )
      pointLightHelper.update()
      info.pointPosition = `(${pointLight.position.x.toFixed(1)}, ${pointLight.position.y.toFixed(1)}, ${pointLight.position.z.toFixed(1)})`
    }
  }

  tick()
}

onMounted(() => {
  three = createThreeBase(canvasRef.value!)
  const { scene, camera, orbit, renderer } = three

  camera.position.set(320, 220, 360)
  orbit.target.set(0, 0, 0)
  scene.background = new THREE.Color(0x101418)

  renderer.shadowMap.enabled = true

  ambientLight = new THREE.AmbientLight(0xffffff, ambientIntensity.value)
  scene.add(ambientLight)

  directionalLight = new THREE.DirectionalLight(0xffffff, directionalIntensity.value)
  directionalLight.position.set(180, 260, 120)
  directionalLight.castShadow = true
  directionalLight.shadow.mapSize.set(1024, 1024)
  scene.add(directionalLight)

  directionalHelper = new THREE.DirectionalLightHelper(directionalLight, 38, 0xffe066)
  scene.add(directionalHelper)

  pointLight = new THREE.PointLight(0xfff3bf, pointIntensity.value, 900, 2)
  pointLight.position.set(80, 80, 80)
  pointLight.castShadow = true
  scene.add(pointLight)

  pointLightHelper = new THREE.PointLightHelper(pointLight, 14, 0xff922b)
  scene.add(pointLightHelper)

  const pointGlow = new THREE.Mesh(
    new THREE.SphereGeometry(8, 20, 20),
    new THREE.MeshBasicMaterial({ color: 0xff922b })
  )
  pointLight.add(pointGlow)

  buildStage()
  applyMaterialToMeshes()
  updateLights()
  startLightMotion()
  three.start()
})

watch(currentMaterial, () => {
  applyMaterialToMeshes()
})

watch(
  [ambientEnabled, directionalEnabled, pointEnabled, helperVisible, ambientIntensity, directionalIntensity, pointIntensity],
  () => {
    updateLights()
  }
)

watch(autoRotateLight, () => {
  if (!pointLight) return
  info.pointPosition = `(${pointLight.position.x.toFixed(1)}, ${pointLight.position.y.toFixed(1)}, ${pointLight.position.z.toFixed(1)})`
})

onBeforeUnmount(() => {
  cancelAnimationFrame(animationFrame)
  disposeStage()

  if (ambientLight) {
    ambientLight.parent?.remove(ambientLight)
    ambientLight = null
  }

  if (directionalHelper) {
    directionalHelper.parent?.remove(directionalHelper)
    directionalHelper.dispose()
    directionalHelper = null
  }

  if (directionalLight) {
    directionalLight.parent?.remove(directionalLight)
    directionalLight = null
  }

  if (pointLightHelper) {
    pointLightHelper.parent?.remove(pointLightHelper)
    pointLightHelper.dispose()
    pointLightHelper = null
  }

  if (pointLight) {
    pointLight.parent?.remove(pointLight)
    pointLight = null
  }

  three?.dispose()
  three = null
})
</script>

<template>
  <div style="display:flex; gap:16px; align-items:flex-start; flex-wrap:wrap;">
    <div style="width:860px;">
      <div style="margin-bottom:8px; line-height:1.75;">
        <button @click="currentMaterial = 'basic'">Basic</button>
        <button @click="currentMaterial = 'lambert'" style="margin-left:6px;">Lambert</button>
        <button @click="currentMaterial = 'phong'" style="margin-left:6px;">Phong</button>
        <button @click="currentMaterial = 'standard'" style="margin-left:6px;">Standard</button>
        <span style="margin-left:12px; opacity:0.82;">当前材质：{{ info.materialName }}</span>
      </div>

      <div style="width:840px; height:620px; border:1px solid #2a2a2a; border-radius:10px; overflow:hidden;">
        <canvas ref="canvasRef" style="width:840px; height:620px; display:block;" />
      </div>
    </div>

    <div style="width:420px; display:flex; flex-direction:column; gap:12px;">
      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">光源介绍</div>
        <div>AmbientLight：整体补亮，没有方向，适合降低阴影死黑感。</div>
        <div>DirectionalLight：像太阳光，所有光线近似平行，适合当主光。</div>
        <div>PointLight：从一个点向四周发光，越靠近受影响越明显。</div>
        <div>PointLightHelper：把点光源的位置和范围提示出来，方便观察它如何影响模型。</div>
      </div>

      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">灯光控制</div>
        <label style="display:flex; align-items:center; gap:8px;">
          <input v-model="ambientEnabled" type="checkbox" />
          <span>开启 AmbientLight</span>
        </label>
        <label style="display:flex; align-items:center; gap:8px; margin-top:6px;">
          <input v-model="directionalEnabled" type="checkbox" />
          <span>开启 DirectionalLight</span>
        </label>
        <label style="display:flex; align-items:center; gap:8px; margin-top:6px;">
          <input v-model="pointEnabled" type="checkbox" />
          <span>开启 PointLight</span>
        </label>
        <label style="display:flex; align-items:center; gap:8px; margin-top:6px;">
          <input v-model="helperVisible" type="checkbox" />
          <span>显示 PointLightHelper</span>
        </label>
        <label style="display:flex; align-items:center; gap:8px; margin-top:6px;">
          <input v-model="autoRotateLight" type="checkbox" />
          <span>点光源自动绕场景移动</span>
        </label>
        <div style="margin-top:8px; opacity:0.82;">{{ info.lightSummary }}</div>
      </div>

      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">光强参数</div>
        <div>环境光强度：{{ ambientIntensity.toFixed(2) }}</div>
        <input v-model.number="ambientIntensity" type="range" min="0" max="2" step="0.05" style="width:100%;" />
        <div style="margin-top:8px;">平行光强度：{{ directionalIntensity.toFixed(2) }}</div>
        <input v-model.number="directionalIntensity" type="range" min="0" max="3" step="0.05" style="width:100%;" />
        <div style="margin-top:8px;">点光源强度：{{ pointIntensity.toFixed(2) }}</div>
        <input v-model.number="pointIntensity" type="range" min="0" max="4" step="0.05" style="width:100%;" />
      </div>

      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">材质说明</div>
        <div>{{ info.materialName }}</div>
        <div style="opacity:0.82;">{{ info.materialDesc }}</div>
      </div>

      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">点光源位置</div>
        <div>{{ info.pointPosition }}</div>
      </div>
    </div>
  </div>
</template>
