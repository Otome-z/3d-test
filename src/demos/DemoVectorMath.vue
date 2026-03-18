<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import * as THREE from 'three'
import { createThreeBase } from '@/composables/useThreeBase'
import {
  directionFromPoints,
  distancePointToPlane,
  distancePointToSegment,
  dotBetweenDirections,
  normalFromTriangle,
  planeFromTriangle,
  rayPlaneIntersection
} from '@/composables/useVectorMath'

const canvasRef = ref<HTMLCanvasElement | null>(null)

let three: ReturnType<typeof createThreeBase> | null = null
let syncRaf = 0

const mathInfo = reactive({
  directionAB: '(0, 0, 0)',
  directionAC: '(0, 0, 0)',
  dotValue: '0.000000',
  dotMeaning: '',
  crossNormal: '(0, 0, 1)',
  segmentClosest: '(0, 0, 0)',
  segmentDistance: '0.000000',
  segmentDistanceSq: '0.000000',
  nearestEdge: 'AB',
  planeNormal: '(0, 0, 1)',
  planeConstant: '0.000000',
  planeDistance: '0.000000',
  planeProjected: '(0, 0, 0)',
  hitPoint: '未命中',
  hitStatus: '把鼠标移到蓝色平面上方'
})

let pointP: THREE.Mesh
let pointA: THREE.Mesh
let pointB: THREE.Mesh
let pointC: THREE.Mesh
let closestMarker: THREE.Mesh
let projectedMarker: THREE.Mesh
let hitMarker: THREE.Mesh
let pointLabels: THREE.Sprite[] = []
let pointerPlaneMesh: THREE.Mesh
let nearestEdgeLine: THREE.Line
let segmentGuideLine: THREE.Line
let planeDistanceLine: THREE.Line
let normalLine: THREE.Line
let triangleFill: THREE.Mesh

function vecText(v: THREE.Vector3) {
  return `(${v.x.toFixed(6)}, ${v.y.toFixed(6)}, ${v.z.toFixed(6)})`
}

function getPosition(mesh: THREE.Mesh) {
  return mesh.position.clone()
}

function replaceLineGeometry(line: THREE.Line, points: THREE.Vector3[]) {
  line.geometry.dispose()
  line.geometry = new THREE.BufferGeometry().setFromPoints(points)
}

function buildPoint(color: number, radius = 6) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(radius, 24, 24),
    new THREE.MeshBasicMaterial({ color })
  )
}

function buildTextLabel(text: string, color: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 192
  canvas.height = 96

  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
  ctx.beginPath()
  ctx.roundRect(10, 18, 172, 52, 12)
  ctx.fill()
  ctx.strokeStyle = color
  ctx.lineWidth = 4
  ctx.stroke()
  ctx.fillStyle = color
  ctx.font = 'bold 34px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, canvas.width / 2, canvas.height / 2)

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false
    })
  )
  sprite.scale.set(42, 21, 1)
  sprite.renderOrder = 30
  return sprite
}

function attachLabel(target: THREE.Object3D, text: string, color: string, yOffset = 20) {
  const label = buildTextLabel(text, color)
  label.position.set(0, yOffset, 0)
  target.add(label)
  pointLabels.push(label)
}

function buildLine(color: number) {
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color })
  )
}

function updateMathInfo() {
  const a = getPosition(pointA)
  const b = getPosition(pointB)
  const c = getPosition(pointC)
  const p = getPosition(pointP)

  const ab = directionFromPoints(a, b)
  const ac = directionFromPoints(a, c)
  const abDir = ab.clone().normalize()
  const acDir = ac.clone().normalize()
  const dot = dotBetweenDirections(abDir, acDir)
  const normal = normalFromTriangle(a, b, c)
  const plane = planeFromTriangle(a, b, c)
  const segInfo = distancePointToSegment(p, a, b)
  const planeInfo = distancePointToPlane(p, plane)

  let nearestEdgeName = 'AB'
  let nearestStart = a
  let nearestEnd = b
  let nearestDistance = segInfo.distance

  const edges: Array<{ name: string; start: THREE.Vector3; end: THREE.Vector3 }> = [
    { name: 'AB', start: a, end: b },
    { name: 'BC', start: b, end: c },
    { name: 'CA', start: c, end: a }
  ]

  for (const edge of edges) {
    const info = distancePointToSegment(p, edge.start, edge.end)
    if (info.distance < nearestDistance) {
      nearestDistance = info.distance
      nearestEdgeName = edge.name
      nearestStart = edge.start
      nearestEnd = edge.end
    }
  }

  closestMarker.position.copy(segInfo.closest)
  projectedMarker.position.copy(planeInfo.projected)

  replaceLineGeometry(segmentGuideLine, [p, segInfo.closest])
  replaceLineGeometry(planeDistanceLine, [p, planeInfo.projected])
  replaceLineGeometry(nearestEdgeLine, [nearestStart, nearestEnd])
  replaceLineGeometry(normalLine, [a, a.clone().add(normal.clone().multiplyScalar(70))])

  const centroid = a.clone().add(b).add(c).multiplyScalar(1 / 3)
  pointerPlaneMesh.position.copy(centroid)
  pointerPlaneMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), plane.normal.clone())

  const trianglePositions = new Float32Array([
    a.x, a.y, a.z,
    b.x, b.y, b.z,
    c.x, c.y, c.z
  ])
  triangleFill.geometry.dispose()
  triangleFill.geometry = new THREE.BufferGeometry()
  triangleFill.geometry.setAttribute('position', new THREE.BufferAttribute(trianglePositions, 3))
  triangleFill.geometry.computeVertexNormals()

  mathInfo.directionAB = vecText(ab)
  mathInfo.directionAC = vecText(ac)
  mathInfo.dotValue = dot.toFixed(6)
  mathInfo.dotMeaning =
    dot > 0.7 ? '夹角较小，方向接近' : dot < -0.7 ? '方向接近相反' : '大致接近垂直'
  mathInfo.crossNormal = vecText(normal)
  mathInfo.segmentClosest = vecText(segInfo.closest)
  mathInfo.segmentDistance = segInfo.distance.toFixed(6)
  mathInfo.segmentDistanceSq = segInfo.distanceSq.toFixed(6)
  mathInfo.nearestEdge = nearestEdgeName
  mathInfo.planeNormal = vecText(plane.normal)
  mathInfo.planeConstant = plane.constant.toFixed(6)
  mathInfo.planeDistance = planeInfo.distance.toFixed(6)
  mathInfo.planeProjected = vecText(planeInfo.projected)
}

function updateHitFromPointer(ev: PointerEvent) {
  if (!three) return
  three.updateMouseFromEvent(ev)
  three.raycaster.setFromCamera(three.mouse, three.camera)

  const a = getPosition(pointA)
  const b = getPosition(pointB)
  const c = getPosition(pointC)
  const plane = planeFromTriangle(a, b, c)
  const hit = rayPlaneIntersection(three.raycaster.ray, plane, new THREE.Vector3())

  if (!hit) {
    mathInfo.hitStatus = '当前相机射线与这个平面平行，没有交点'
    mathInfo.hitPoint = '未命中'
    hitMarker.visible = false
    return
  }

  hitMarker.visible = true
  hitMarker.position.copy(hit)
  mathInfo.hitPoint = vecText(hit)
  mathInfo.hitStatus = '这是 camera ray 与三角形所在无限平面的交点'
}

function attachTransformHandlers() {
  if (!three) return
  const pickables = [pointP, pointA, pointB, pointC]

  const onDown = (ev: PointerEvent) => {
    if (!three) return
    three.updateMouseFromEvent(ev)
    three.raycaster.setFromCamera(three.mouse, three.camera)
    const hit = three.raycaster.intersectObjects(pickables, false)[0]
    if (!hit) return
    three.transform.attach(hit.object)
  }

  const onMove = (ev: PointerEvent) => {
    updateHitFromPointer(ev)
  }

  const onObjectChange = () => {
    console.log('onObjectChange')
    updateMathInfo()
  }

  canvasRef.value!.addEventListener('pointerdown', onDown)
  canvasRef.value!.addEventListener('pointermove', onMove)
  three.transform.addEventListener('objectChange', onObjectChange)

  cleanup.push(() => canvasRef.value?.removeEventListener('pointerdown', onDown))
  cleanup.push(() => canvasRef.value?.removeEventListener('pointermove', onMove))
  cleanup.push(() => three?.transform.removeEventListener('objectChange', onObjectChange))
}

function startSyncLoop() {
  const tick = () => {
    updateMathInfo()
    syncRaf = requestAnimationFrame(tick)
  }
  tick()
}

onMounted(() => {
  three = createThreeBase(canvasRef.value!)
  const { scene, camera, transform } = three

  camera.position.set(320, 260, 360)
  transform.mode = 'translate'
  transform.setSize(0.8)

  pointA = buildPoint(0xff6b6b)
  pointB = buildPoint(0x51cf66)
  pointC = buildPoint(0x4d96ff)
  pointP = buildPoint(0xffd43b, 7)
  closestMarker = buildPoint(0xffffff, 5)
  projectedMarker = buildPoint(0xe599f7, 5)
  hitMarker = buildPoint(0x00ffff, 5)
  hitMarker.visible = false

  pointA.position.set(-110, 0, -20)
  pointB.position.set(110, 0, 40)
  pointC.position.set(-10, 120, 90)
  pointP.position.set(35, 85, -70)

  attachLabel(pointA, 'A', '#ff6b6b')
  attachLabel(pointB, 'B', '#51cf66')
  attachLabel(pointC, 'C', '#4d96ff')
  attachLabel(pointP, 'P', '#ffd43b')
  attachLabel(closestMarker, 'Closest', '#ffffff', 16)
  attachLabel(projectedMarker, 'PlaneProj', '#e599f7', 16)
  attachLabel(hitMarker, 'RayHit', '#00ffff', 16)

  segmentGuideLine = buildLine(0xffd43b)
  planeDistanceLine = buildLine(0xe599f7)
  normalLine = buildLine(0x00e5ff)
  nearestEdgeLine = buildLine(0xffffff)

  triangleFill = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({
      color: 0x4d96ff,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false
    })
  )

  pointerPlaneMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(420, 420),
    new THREE.MeshBasicMaterial({
      color: 0x1c7ed6,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide
    })
  )
  pointerPlaneMesh.rotateX(-Math.PI / 2)

  const labels = new THREE.Group()
  labels.add(new THREE.AxesHelper(180))

  scene.add(pointerPlaneMesh)
  scene.add(triangleFill)
  scene.add(segmentGuideLine)
  scene.add(planeDistanceLine)
  scene.add(normalLine)
  scene.add(nearestEdgeLine)
  scene.add(pointA, pointB, pointC, pointP, closestMarker, projectedMarker, hitMarker)
  scene.add(labels)

  transform.attach(pointP)
  attachTransformHandlers()
  updateMathInfo()
  three.start()
  startSyncLoop()
})

const cleanup: Array<() => void> = []

onBeforeUnmount(() => {
  cancelAnimationFrame(syncRaf)
  cleanup.forEach(fn => fn())
  cleanup.length = 0
  pointLabels.forEach(label => {
    const material = label.material as THREE.SpriteMaterial
    material.map?.dispose()
    material.dispose()
  })
  pointLabels = []
  three?.dispose()
  three = null
})
</script>

<template>
  <div style="display:flex; gap:16px; align-items:flex-start; flex-wrap:wrap;">
    <div style="width:820px;">
      <div style="margin-bottom:8px; line-height:1.7;">
        <button v-if="three" @click="three.transform.attach(pointP)">选点 P</button>
        <button v-if="three" @click="three.transform.attach(pointA)" style="margin-left:6px;">选点 A</button>
        <button v-if="three" @click="three.transform.attach(pointB)" style="margin-left:6px;">选点 B</button>
        <button v-if="three" @click="three.transform.attach(pointC)" style="margin-left:6px;">选点 C</button>
        <span style="margin-left:12px; opacity:0.8;">
          拖动 A/B/C/P，观察向量、法线、点到线段、点到平面的结果如何联动
        </span>
      </div>

      <div style="width:800px; height:620px; border:1px solid #2a2a2a; border-radius:10px; overflow:hidden;">
        <canvas ref="canvasRef" style="width:800px; height:620px; display:block;" />
      </div>
    </div>

    <div style="width:380px; display:flex; flex-direction:column; gap:12px;">
      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">1. 向量减法 / 点乘 / 叉乘</div>
        <div><strong>AB = B - A</strong>: {{ mathInfo.directionAB }}</div>
        <div><strong>AC = C - A</strong>: {{ mathInfo.directionAC }}</div>
        <div><strong>dot(normalized AB, AC)</strong>: {{ mathInfo.dotValue }}</div>
        <div>{{ mathInfo.dotMeaning }}</div>
        <div><strong>cross(AB, AC).normalize()</strong>: {{ mathInfo.crossNormal }}</div>
        <div style="opacity:0.78;">向量减法会得到“从起点指向终点”的方向。点乘看夹角关系，叉乘给出同时垂直于 AB 和 AC 的方向。</div>
      </div>

      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">2. 点到线段</div>
        <div><strong>closestPointToPoint(P, AB)</strong>: {{ mathInfo.segmentClosest }}</div>
        <div><strong>distanceTo</strong>: {{ mathInfo.segmentDistance }}</div>
        <div><strong>distanceToSquared</strong>: {{ mathInfo.segmentDistanceSq }}</div>
        <div><strong>最近边</strong>: {{ mathInfo.nearestEdge }}</div>
        <div style="opacity:0.78;">黄色线是 P 到 AB 的最短连线，白色高亮边是 P 到三角形三条边里最近的那一条。</div>
      </div>

      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">3. 法线 / 平面</div>
        <div><strong>平面法线</strong>: {{ mathInfo.planeNormal }}</div>
        <div><strong>平面方程</strong>: n · x + d = 0，d = {{ mathInfo.planeConstant }}</div>
        <div><strong>点到平面距离</strong>: {{ mathInfo.planeDistance }}</div>
        <div><strong>点在平面上的投影</strong>: {{ mathInfo.planeProjected }}</div>
        <div style="opacity:0.78;">青色线是三角形法线方向，粉色线是点 P 垂直到平面的最短路径。</div>
      </div>

      <div style="border:1px solid #2a2a2a; border-radius:10px; padding:12px; line-height:1.75;">
        <div style="font-weight:700; margin-bottom:10px;">4. 鼠标点到平面</div>
        <div><strong>交点</strong>: {{ mathInfo.hitPoint }}</div>
        <div>{{ mathInfo.hitStatus }}</div>
        <div style="opacity:0.78;">蓝色半透明面会跟着三角形所在平面走。鼠标在画布里移动时，会实时计算 camera ray 与这个平面的交点。</div>
      </div>
    </div>
  </div>
</template>
