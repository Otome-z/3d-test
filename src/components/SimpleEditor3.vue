<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls'

/**
 * =============== DOM 引用 ===============
 * canvasRef：Three.js 渲染的目标 canvas
 * selectionBox：框选 UI 的 DOM 选框（只是视觉，不参与 three 逻辑）
 */
const canvasRef = ref<HTMLCanvasElement | null>(null)
const selectionBox = ref<HTMLDivElement | null>(null)

/**
 * =============== Three.js 核心对象 ===============
 */
let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let orbit: OrbitControls
let renderer: THREE.WebGLRenderer
let transform: TransformControls

/**
 * =============== 可选物体列表 / 选中列表 ===============
 * cubes：场景里可被点击选择的 mesh（Demo 用两个立方体）
 * selectedObjects：当前选中对象（支持多选）
 */
const cubes: THREE.Mesh[] = []
const selectedObjects: THREE.Object3D[] = []

/**
 * offsets：多选时每个对象相对中心 gizmo 的偏移量
 * 用于同步多选移动（virtualControl 移动后，其他对象 = center + offset）
 */
let offsets: THREE.Vector3[] = []

/**
 * virtualControl：多选时的“虚拟控制器”
 * - TransformControls attach 到它
 * - 你拖 gizmo 实际在动它
 * - 然后我们把 transform 同步回每个真实对象
 */
const virtualControl = new THREE.Object3D()
virtualControl.visible = false

/**
 * boxSelectMode：是否开启框选（拖拽出选择矩形）
 */
const boxSelectMode = ref(false)

/**
 * editMode：
 * - object：物体模式（选物体、移动旋转缩放）
 * - vertex：点模式（显示顶点 overlay，可点选顶点并移动）
 */
type EditMode = 'object' | 'vertex'
const editMode = ref<EditMode>('object')

/**
 * toolMode：
 * - select：普通选择
 * - cut：Cut 工具（本版本 Cut = 选两个对角点 → 翻转对角线 Turn Edge）
 */
type ToolMode = 'select' | 'cut'
const toolMode = ref<ToolMode>('select')

/**
 * =============== 交互状态 ===============
 * isSelecting：是否正在框选拖拽中
 * isDragging：TransformControls 是否正在拖动（dragging-changed 事件）
 */
let isSelecting = false
let isDragging = false

/**
 * startPoint：框选起点（屏幕像素坐标）
 */
const startPoint = new THREE.Vector2()

/**
 * =============== 顶点编辑（Vertex） ===============
 * vertexHandle：顶点 gizmo 的挂载对象（TransformControls attach 到它）
 *
 * 关键点（很容易踩坑）：
 * - vertexHandle 会被挂到 mesh 上：mesh.add(vertexHandle)
 * - 所以 vertexHandle.position 是“mesh 局部坐标”
 * - 写回 geometry.position 时也必须用局部坐标，才能不偏移
 */
const vertexHandle = new THREE.Object3D()
vertexHandle.visible = false

/**
 * selectedVertex：当前选中的顶点
 * - mesh：哪个物体
 * - index：position attribute 的顶点索引（Weld 后是共享顶点，不会重复）
 */
let selectedVertex: { mesh: THREE.Mesh; index: number } | null = null

/**
 * =============== Cut 工具 ===============
 * cutFirst：Cut 的第一点（第一次点击吸附到的顶点 index）
 */
let cutFirst: { mesh: THREE.Mesh; vIndex: number } | null = null

/**
 * cutPreviewLine：Cut 的预览线（覆盖层，挂到 mesh 上）
 * 注意：这是纯视觉，不改拓扑
 */
const cutPreviewLine = new THREE.Line(
  new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({
    /**
     * color：线颜色（LineBasicMaterial 不受灯光影响）
     */
    color: 0xff00ff,

    /**
     * transparent：是否启用透明混合
     * - true：opacity 才生效；进入透明物体渲染路径（会涉及排序）
     * - false：opacity 会被忽略
     */
    transparent: true,

    /**
     * opacity：透明度 0~1
     * - 1：不透明
     * - 0：完全透明
     */
    opacity: 0.95,

    /**
     * depthTest：是否进行深度测试（是否会被遮挡）
     * - true：被模型挡住的部分不显示（真实遮挡）
     * - false：永远显示在最上层（编辑器覆盖层常用）
     */
    depthTest: false,

    /**
     * depthWrite：是否写入深度缓冲
     * - true：该线会“占坑”深度，可能反过来挡住后面要画的东西
     * - false：不写深度，更适合 overlay
     *
     * 通常 depthTest=false 时也设置 depthWrite=false，避免遮挡副作用
     */
    depthWrite: false
  })
)
cutPreviewLine.visible = false
cutPreviewLine.renderOrder = 20 // renderOrder 越大越后渲染（更容易覆盖在上面）
cutPreviewLine.frustumCulled = false // 避免视锥裁剪导致预览线偶尔消失
cutPreviewLine.raycast = () => {} // 不参与拾取，避免干扰

/**
 * =============== 拾取（Raycaster） ===============
 */
const raycaster = new THREE.Raycaster()
const mouse = new THREE.Vector2()

/**
 * getRect：获取 canvas 的当前屏幕位置/尺寸
 *
 * 易踩坑：
 * - 绝对不要只算一次并缓存 rect
 * - 页面滚动 / CSS 缩放 / DPR / 浏览器缩放都会让 rect 变化
 * - 缓存 rect 会导致“点选漂移”
 */
function getRect() {
  return canvasRef.value!.getBoundingClientRect()
}

/**
 * PointerEvent → 归一化设备坐标 NDC（-1..1）
 */
function updateMouseFromEvent(ev: PointerEvent) {
  const rect = getRect()
  mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1
}

/* =========================================================
 * weldGeometryByPosition：按 position 合并共享顶点（生成 indexed geometry）
 *
 * 为什么要 weld？
 * - Three.js 的 BoxGeometry/PlaneGeometry 常常有“同位置多个顶点”
 * - 你拉一个角要拖两次，就是重复顶点造成的
 * - Weld 后顶点唯一，拓扑更像 Editable Poly
 *
 * 注意：
 * - 这里只按 position 合并，会破坏硬边/UV 分裂
 * - 但你是建模编辑器：建模阶段优先“拓扑干净”
 * ========================================================= */
function weldGeometryByPosition(geometry: THREE.BufferGeometry, epsilon = 1e-6) {
  const src = geometry.clone()
  const pos = src.getAttribute('position') as THREE.BufferAttribute
  const indexAttr = src.getIndex()

  // 展开成“按三角形顺序”的顶点流（不论原本是否 indexed）
  const expanded: number[] = []
  if (indexAttr) {
    const idx = indexAttr.array as ArrayLike<number>
    for (let i = 0; i < idx.length; i++) {
      const vi = idx[i]
      expanded.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi))
    }
  } else {
    for (let i = 0; i < pos.count; i++) {
      expanded.push(pos.getX(i), pos.getY(i), pos.getZ(i))
    }
  }

  // 把 float 坐标按 epsilon 容差 hash 成 key（避免浮点误差）
  const inv = 1 / epsilon
  const keyOf = (x: number, y: number, z: number) =>
    `${Math.round(x * inv)},${Math.round(y * inv)},${Math.round(z * inv)}`

  const map = new Map<string, number>() // key -> newIndex
  const newPositions: number[] = []
  const newIndices: number[] = []

  for (let i = 0; i < expanded.length; i += 3) {
    const x = expanded[i]
    const y = expanded[i + 1]
    const z = expanded[i + 2]
    const key = keyOf(x, y, z)

    let newIndex = map.get(key)
    if (newIndex == null) {
      newIndex = newPositions.length / 3
      map.set(key, newIndex)
      newPositions.push(x, y, z)
    }
    newIndices.push(newIndex)
  }

  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3))
  out.setIndex(newIndices)

  out.computeVertexNormals()
  out.computeBoundingBox()
  out.computeBoundingSphere()
  return out
}

/* =========================================================
 * buildHelpers：给 mesh 构建 overlay（wire + points）
 *
 * 目标：
 * - 点/线“覆盖在物体身上”而不是旁边单独物体（像 3ds Max）
 * - 所以必须 mesh.add(wire/points)
 *
 * 关键坑：
 * - points 必须共享 mesh.geometry.position attribute
 *   否则会出现你之前那种“覆盖后点线错位/不同步”问题
 * ========================================================= */
function buildHelpers(mesh: THREE.Mesh) {
  // 清理旧 helper（避免重复叠加）
  if (mesh.userData.wire) {
    mesh.remove(mesh.userData.wire)
    mesh.userData.wire.geometry.dispose()
    ;(mesh.userData.wire.material as THREE.Material).dispose?.()
  }
  if (mesh.userData.points) {
    mesh.remove(mesh.userData.points)
    mesh.userData.points.geometry.dispose()
    ;(mesh.userData.points.material as THREE.Material).dispose?.()
  }

  const g = mesh.geometry as THREE.BufferGeometry

  /**
   * wire：线框 overlay（LineSegments）
   */
  const wire = new THREE.LineSegments(
    new THREE.WireframeGeometry(g),
    new THREE.LineBasicMaterial({
      /**
       * color：线颜色（LineBasicMaterial 不受灯光影响）
       */
      color: 0x00ffff,

      /**
       * transparent：是否启用透明
       * 开启后 opacity 才会生效，并进入透明渲染路径
       */
      transparent: true,

      /**
       * opacity：透明度 0~1
       */
      opacity: 0.9,

      /**
       * depthTest：深度测试
       * false：不被遮挡，永远盖在表面（编辑器 overlay 常用）
       */
      depthTest: false,

      /**
       * depthWrite：写深度缓冲
       * overlay 推荐 false：不要反过来挡住其它 overlay/物体
       */
      depthWrite: false

      /**
       * 可选：如果你未来希望“被遮挡部分不显示”
       * 你可以 depthTest=true，并配 polygonOffset 避免 z-fighting：
       * polygonOffset: true,
       * polygonOffsetFactor: -1,
       * polygonOffsetUnits: -1,
       */
    })
  )
  wire.visible = false
  wire.raycast = () => {} // 不参与拾取
  wire.renderOrder = 10 // 渲染顺序靠后（更容易覆盖）
  wire.frustumCulled = false // 避免视锥裁剪导致线框偶尔消失

  /**
   * points：顶点点集 overlay（Points）
   * ✅ 关键：共享 mesh 的 position attribute（同一份 Float32Array）
   */
  const ptsGeo = new THREE.BufferGeometry()
  const posAttr = g.getAttribute('position') as THREE.BufferAttribute
  ptsGeo.setAttribute('position', posAttr)

  const pts = new THREE.Points(
    ptsGeo,
    new THREE.PointsMaterial({
      /**
       * size：点的像素大小（开启 sizeAttenuation=false 时，近远大小不变）
       */
      size: 8,

      /**
       * sizeAttenuation：
       * - true：点会随距离缩放（远小近大）
       * - false：屏幕像素固定（编辑器点选更稳定）
       */
      sizeAttenuation: false,

      /**
       * color：点颜色
       */
      color: 0xffcc00,

      /**
       * depthTest/depthWrite：同 wire，作为覆盖层不遮挡
       */
      depthTest: false,
      depthWrite: false
    })
  )
  pts.visible = false
  pts.userData.owner = mesh // 反查属于哪个 mesh
  pts.renderOrder = 11
  pts.frustumCulled = false

  // ✅ 挂到 mesh 上：跟随物体 transform（像 3ds Max 覆盖层）
  mesh.add(wire)
  mesh.add(pts)

  mesh.userData.wire = wire
  mesh.userData.points = pts
}

/**
 * rebuildWire：当拓扑/index/position 改变后，需要重建 wireframe
 * 注意：
 * - WireframeGeometry 不会自动跟随 position/index 的变化
 * - 所以你修改 geometry 后要重建 wire.geometry
 */
function rebuildWire(mesh: THREE.Mesh) {
  const wire = mesh.userData.wire as THREE.LineSegments | undefined
  if (!wire) return
  const g = mesh.geometry as THREE.BufferGeometry
  wire.geometry.dispose()
  wire.geometry = new THREE.WireframeGeometry(g)
}

/**
 * clearHelpersVisible：隐藏所有物体的 overlay（切换选择时使用）
 */
function clearHelpersVisible() {
  cubes.forEach(c => {
    if (c.userData.wire) c.userData.wire.visible = false
    if (c.userData.points) c.userData.points.visible = false
  })
}

/**
 * clearVertexEditing：退出顶点编辑状态
 * 易踩坑：
 * - vertexHandle 如果还挂在旧 mesh 下，会导致“坐标空间错乱”
 * - 所以必须从 parent 移除
 */
function clearVertexEditing() {
  selectedVertex = null
  vertexHandle.visible = false
  if (vertexHandle.parent) vertexHandle.parent.remove(vertexHandle)
}

/**
 * clearCutState：退出 Cut 状态（清第一点 & 预览线）
 */
function clearCutState() {
  cutFirst = null
  cutPreviewLine.visible = false
  if (cutPreviewLine.parent) cutPreviewLine.parent.remove(cutPreviewLine)
}

/**
 * updateSelection：更新当前选中对象
 * - 单选：attach 到物体
 * - 多选：attach 到 virtualControl
 */
function updateSelection(objects: THREE.Object3D[]) {
  selectedObjects.length = 0
  selectedObjects.push(...objects)

  clearVertexEditing()
  clearCutState()
  clearHelpersVisible()

  if (selectedObjects.length > 1) {
    // 多选：算中心点
    const center = new THREE.Vector3()
    selectedObjects.forEach(o => center.add(o.position))
    center.multiplyScalar(1 / selectedObjects.length)

    virtualControl.position.copy(center)
    virtualControl.rotation.set(0, 0, 0)
    virtualControl.scale.set(1, 1, 1)
    virtualControl.visible = true

    offsets = selectedObjects.map(o => o.position.clone().sub(center))
    transform.attach(virtualControl)
  } else {
    virtualControl.visible = false

    const obj = selectedObjects[0] as THREE.Mesh
    transform.attach(obj)

    // 显示 overlay：线框始终显示；点只在 vertex 模式显示
    if (obj.userData.wire) obj.userData.wire.visible = true
    if (obj.userData.points) obj.userData.points.visible = (editMode.value === 'vertex')
  }
}

/* =========================================================
 * 顶点模式：点选 vertex（Points）并 attach vertexHandle
 * ========================================================= */
function tryPickVertex(ev: PointerEvent) {
  if (editMode.value !== 'vertex') return false
  if (selectedObjects.length !== 1) return false
  if (boxSelectMode.value) return false

  const mesh = selectedObjects[0] as THREE.Mesh
  const pts = mesh.userData.points as THREE.Points | undefined
  if (!pts) return false

  updateMouseFromEvent(ev)
  raycaster.setFromCamera(mouse, camera)

  // 注意：Points 的 raycast 命中结果 hit.index 是“点索引”
  const hit = raycaster.intersectObject(pts, false)[0]
  if (!hit || hit.index == null) return false

  selectedVertex = { mesh, index: hit.index }

  // ✅ 关键：handle 挂到 mesh 上（局部空间）
  mesh.add(vertexHandle)
  vertexHandle.visible = true

  // 用 mesh.geometry 的局部顶点坐标设置 handle 位置
  const g = mesh.geometry as THREE.BufferGeometry
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  vertexHandle.position.set(pos.getX(hit.index), pos.getY(hit.index), pos.getZ(hit.index))

  transform.attach(vertexHandle)
  return true
}

/* =========================================================
 * Cut 工具：吸附到“顶点”，两次点击翻转 quad 的对角线（Turn Edge）
 *
 * 说明：
 * - 这是“最小 Cut”：解决你“正方形 + X”的需求（翻对角线）
 * - 真正 Max 的 Cut 还包括：边上插点、跨多面切割（后续再升级）
 * ========================================================= */

/**
 * 在 mesh 上点击，吸附到“当前三角形的最近顶点”
 * snapDist：吸附距离（世界坐标距离），太小不容易点中，太大容易误吸
 */
function pickSnappedVertexOnMesh(ev: PointerEvent, mesh: THREE.Mesh, snapDist = 12) {
  updateMouseFromEvent(ev)
  raycaster.setFromCamera(mouse, camera)

  const hit = raycaster.intersectObject(mesh, false)[0]
  if (!hit || hit.faceIndex == null) return null

  const g = mesh.geometry as THREE.BufferGeometry
  const idx = g.getIndex()
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  if (!idx) return null

  // faceIndex 是“第几个三角面”
  const tri = hit.faceIndex
  const ia = (idx.array as any)[tri * 3 + 0] as number
  const ib = (idx.array as any)[tri * 3 + 1] as number
  const ic = (idx.array as any)[tri * 3 + 2] as number

  // hit.point 是世界坐标；三角顶点要转世界坐标后比较距离
  const a = new THREE.Vector3(pos.getX(ia), pos.getY(ia), pos.getZ(ia)).applyMatrix4(mesh.matrixWorld)
  const b = new THREE.Vector3(pos.getX(ib), pos.getY(ib), pos.getZ(ib)).applyMatrix4(mesh.matrixWorld)
  const c = new THREE.Vector3(pos.getX(ic), pos.getY(ic), pos.getZ(ic)).applyMatrix4(mesh.matrixWorld)

  const p = hit.point
  const da = p.distanceTo(a)
  const db = p.distanceTo(b)
  const dc = p.distanceTo(c)

  // 找最近的那个顶点
  let vIndex = ia
  let dMin = da
  if (db < dMin) { dMin = db; vIndex = ib }
  if (dc < dMin) { dMin = dc; vIndex = ic }

  // 超过吸附距离就认为没选到顶点
  if (dMin > snapDist) return null
  return vIndex
}

/**
 * 把 geometry 中某个“由两三角组成的 quad”翻转成以 v1-v2 为对角线
 *
 * 原理：
 * - 找一对相邻三角（共享2个顶点）
 * - 这对三角的 union 应该恰好有 4 个唯一顶点（形成一个 quad）
 * - 如果 v1,v2 是这个 quad 的对角点，就把 index 重写成以 v1-v2 为对角线的两三角
 */
function turnDiagonalTo(geometry: THREE.BufferGeometry, v1: number, v2: number) {
  const idx = geometry.getIndex()
  if (!idx) return false

  const indexArr = Array.from(idx.array as ArrayLike<number>)
  const triCount = indexArr.length / 3

  // 缩小搜索范围：只找包含 v1 或 v2 的三角
  const trisWithV: number[] = []
  for (let t = 0; t < triCount; t++) {
    const a = indexArr[t * 3 + 0]
    const b = indexArr[t * 3 + 1]
    const c = indexArr[t * 3 + 2]
    if (a === v1 || b === v1 || c === v1 || a === v2 || b === v2 || c === v2) trisWithV.push(t)
  }

  for (let i = 0; i < trisWithV.length; i++) {
    for (let j = i + 1; j < trisWithV.length; j++) {
      const t1 = trisWithV[i]
      const t2 = trisWithV[j]

      const A = [indexArr[t1 * 3 + 0], indexArr[t1 * 3 + 1], indexArr[t1 * 3 + 2]]
      const B = [indexArr[t2 * 3 + 0], indexArr[t2 * 3 + 1], indexArr[t2 * 3 + 2]]

      // 相邻三角共享2个点
      const shared = A.filter(x => B.includes(x))
      if (shared.length !== 2) continue

      // union 必须是 4 个点才能组成 quad
      const union = Array.from(new Set([...A, ...B]))
      if (union.length !== 4) continue

      // v1,v2 必须在这个 quad 里
      if (!union.includes(v1) || !union.includes(v2)) continue
      if (v1 === v2) continue

      // 另两个顶点（quad 的另外两个角）
      const others = union.filter(x => x !== v1 && x !== v2)
      if (others.length !== 2) continue
      const o1 = others[0]
      const o2 = others[1]

      // 如果这对三角本身已经以 v1-v2 为对角线（两三角都包含 v1&v2），就不用改
      const t1HasBoth = A.includes(v1) && A.includes(v2)
      const t2HasBoth = B.includes(v1) && B.includes(v2)
      if (t1HasBoth && t2HasBoth) return true

      // 为了不翻面：用原 t1 的法线方向做参照，必要时交换三角点顺序
      const pos = geometry.getAttribute('position') as THREE.BufferAttribute
      const p = (k: number) => new THREE.Vector3(pos.getX(k), pos.getY(k), pos.getZ(k))

      const refN = new THREE.Vector3()
      refN.copy(p(A[1]).sub(p(A[0]))).cross(p(A[2]).sub(p(A[0]))).normalize()

      const tri1 = [v1, o1, v2]
      const n1 = new THREE.Vector3()
      n1.copy(p(tri1[1]).sub(p(tri1[0]))).cross(p(tri1[2]).sub(p(tri1[0]))).normalize()
      if (n1.dot(refN) < 0) [tri1[1], tri1[2]] = [tri1[2], tri1[1]]

      const tri2 = [v1, v2, o2]
      const n2 = new THREE.Vector3()
      n2.copy(p(tri2[1]).sub(p(tri2[0]))).cross(p(tri2[2]).sub(p(tri2[0]))).normalize()
      if (n2.dot(refN) < 0) [tri2[1], tri2[2]] = [tri2[2], tri2[1]]

      // 写回 index
      indexArr[t1 * 3 + 0] = tri1[0]
      indexArr[t1 * 3 + 1] = tri1[1]
      indexArr[t1 * 3 + 2] = tri1[2]

      indexArr[t2 * 3 + 0] = tri2[0]
      indexArr[t2 * 3 + 1] = tri2[1]
      indexArr[t2 * 3 + 2] = tri2[2]

      geometry.setIndex(indexArr)
      geometry.computeVertexNormals()
      geometry.computeBoundingBox()
      geometry.computeBoundingSphere()
      return true
    }
  }

  return false
}

/**
 * 更新 Cut 预览线（局部坐标线段）
 * 注意：因为 cutPreviewLine 挂到 mesh 下，所以用局部坐标即可
 */
function updateCutPreview(mesh: THREE.Mesh, v1: number, v2: number) {
  const g = mesh.geometry as THREE.BufferGeometry
  const pos = g.getAttribute('position') as THREE.BufferAttribute

  const p1 = new THREE.Vector3(pos.getX(v1), pos.getY(v1), pos.getZ(v1))
  const p2 = new THREE.Vector3(pos.getX(v2), pos.getY(v2), pos.getZ(v2))

  const arr = new Float32Array([p1.x, p1.y, p1.z, p2.x, p2.y, p2.z])
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3))

  cutPreviewLine.geometry.dispose()
  cutPreviewLine.geometry = geo
}

/**
 * Cut：两次点击
 * - 第一次：记录起点 & 显示预览线
 * - 第二次：尝试 turnDiagonalTo，并更新 wireframe
 */
function tryCut(ev: PointerEvent) {
  if (toolMode.value !== 'cut') return false
  if (selectedObjects.length !== 1) return false
  if (boxSelectMode.value) return false

  const mesh = selectedObjects[0] as THREE.Mesh

  // 吸附到顶点（点靠近角点即可）
  const vIndex = pickSnappedVertexOnMesh(ev, mesh, 14)
  if (vIndex == null) return false

  // 预览线挂到 mesh 上（覆盖并跟随）
  if (!cutPreviewLine.parent) mesh.add(cutPreviewLine)

  if (!cutFirst) {
    cutFirst = { mesh, vIndex }
    cutPreviewLine.visible = true
    updateCutPreview(mesh, vIndex, vIndex)
    return true
  }

  // 第二点
  const v1 = cutFirst.vIndex
  const v2 = vIndex
  if (v1 === v2) return true

  const ok = turnDiagonalTo(mesh.geometry as THREE.BufferGeometry, v1, v2)

  // 拓扑变化后立刻重建 wireframe
  rebuildWire(mesh)

  clearCutState()
  return ok
}

/* =========================================================
 * 框选逻辑（与你之前一致）
 * ========================================================= */
function boxSelectStart(ev: PointerEvent) {
  if (!boxSelectMode.value || isDragging) return
  isSelecting = true
  orbit.enabled = false

  const rect = getRect()
  startPoint.set(ev.clientX - rect.left, ev.clientY - rect.top)

  if (selectionBox.value) {
    selectionBox.value.style.left = `${startPoint.x}px`
    selectionBox.value.style.top = `${startPoint.y}px`
    selectionBox.value.style.width = '0px'
    selectionBox.value.style.height = '0px'
    selectionBox.value.style.display = 'block'
  }
}

function boxSelectMove(ev: PointerEvent) {
  if (!isSelecting || isDragging || !selectionBox.value) return
  const rect = getRect()
  const current = new THREE.Vector2(ev.clientX - rect.left, ev.clientY - rect.top)

  const x = Math.min(startPoint.x, current.x)
  const y = Math.min(startPoint.y, current.y)
  const w = Math.abs(current.x - startPoint.x)
  const h = Math.abs(current.y - startPoint.y)

  selectionBox.value.style.left = `${x}px`
  selectionBox.value.style.top = `${y}px`
  selectionBox.value.style.width = `${w}px`
  selectionBox.value.style.height = `${h}px`
}

function boxSelectEnd(ev: PointerEvent) {
  if (!isSelecting || isDragging) return
  isSelecting = false
  orbit.enabled = !boxSelectMode.value
  if (selectionBox.value) selectionBox.value.style.display = 'none'

  const rect = getRect()
  const endX = ev.clientX - rect.left
  const endY = ev.clientY - rect.top

  const x1 = Math.min(startPoint.x, endX)
  const y1 = Math.min(startPoint.y, endY)
  const x2 = Math.max(startPoint.x, endX)
  const y2 = Math.max(startPoint.y, endY)

  const newSelection: THREE.Object3D[] = []
  cubes.forEach(obj => {
    // 用对象 position 的投影做粗略框选（Demo 够用）
    const pos = obj.position.clone().project(camera)
    const sx = ((pos.x + 1) / 2) * rect.width
    const sy = ((-pos.y + 1) / 2) * rect.height
    if (sx >= x1 && sx <= x2 && sy >= y1 && sy <= y2) newSelection.push(obj)
  })

  if (newSelection.length) updateSelection(newSelection)
}

/* =========================================================
 * 渲染循环 + resize
 * ========================================================= */
let raf = 0

function resizeRendererToDisplaySize() {
  const rect = getRect()
  const dpr = Math.min(window.devicePixelRatio || 1, 2)

  const width = Math.max(1, Math.floor(rect.width))
  const height = Math.max(1, Math.floor(rect.height))

  const canvas = renderer.domElement
  const needResize =
    canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)

  if (needResize) {
    renderer.setPixelRatio(dpr)
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }
}

function animate() {
  raf = requestAnimationFrame(animate)
  resizeRendererToDisplaySize()
  orbit.update()
  renderer.render(scene, camera)
}

/* =========================================================
 * 生命周期：挂载 / 卸载
 * ========================================================= */
const cleanupFns: Array<() => void> = []

onMounted(() => {
  scene = new THREE.Scene()

  // 相机：aspect 会在 resizeRendererToDisplaySize 里更新，这里先给 1
  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 3000)
  camera.position.set(400, 400, 400)

  renderer = new THREE.WebGLRenderer({
    canvas: canvasRef.value!,
    antialias: true
  })

  /**
   * setPixelRatio：解决高清屏发虚
   * 限制到 2：避免 3x/4x DPR 造成性能暴涨
   */
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))

  orbit = new OrbitControls(camera, renderer.domElement)
  orbit.enableDamping = true

  transform = new TransformControls(camera, renderer.domElement)
  scene.add(transform)
  scene.add(virtualControl)

  /**
   * dragging-changed：TransformControls 在拖动时要禁用 OrbitControls
   * 否则会“拖 gizmo 的同时相机也在转”
   */
  transform.addEventListener('dragging-changed', (event) => {
    isDragging = event.value
    orbit.enabled = !event.value && !boxSelectMode.value
  })

  /**
   * objectChange：gizmo 变化时触发
   * - 若当前 attach 的是 vertexHandle：写回 geometry 顶点
   * - 若当前是多选：同步 virtualControl 的变换给每个对象
   */
  transform.addEventListener('objectChange', () => {
    // 顶点编辑：写回 geometry（局部坐标）
    if (transform.object === vertexHandle && selectedVertex) {
      const { mesh, index } = selectedVertex
      const g = mesh.geometry as THREE.BufferGeometry
      const pos = g.getAttribute('position') as THREE.BufferAttribute

      pos.setXYZ(index, vertexHandle.position.x, vertexHandle.position.y, vertexHandle.position.z)
      pos.needsUpdate = true

      // 注意：computeVertexNormals 会改变 “MeshNormalMaterial” 的显示（依赖法线）
      g.computeVertexNormals()
      g.computeBoundingBox()
      g.computeBoundingSphere()

      // wireframe 不会自动更新，必须重建
      rebuildWire(mesh)
      return
    }

    // 多选同步：把 virtualControl 的变换应用到所有选中对象
    if (selectedObjects.length > 1) {
      const mainObject = virtualControl
      selectedObjects.forEach((o, i) => {
        if (o !== mainObject) o.position.copy(mainObject.position).add(offsets[i])
        if (o !== mainObject) o.rotation.copy(mainObject.rotation)
        if (o !== mainObject) o.scale.copy(mainObject.scale)
      })
    }
  })

  // 辅助轴 & 网格（方便你观察）
  const axesHelper = new THREE.AxesHelper(300)
  axesHelper.raycast = () => {} // 不参与拾取
  scene.add(axesHelper)

  const grid = new THREE.GridHelper(600, 10)
  grid.raycast = () => {}
  scene.add(grid)

  // 创建 demo 物体
  for (let i = -1; i <= 1; i += 2) {
    const base = new THREE.BoxGeometry(100, 100, 100)
    const welded = weldGeometryByPosition(base, 1e-6)
    base.dispose()

    /**
     * 材质：MeshNormalMaterial 按“法线方向”着色
     * 重点修复：side=DoubleSide，解决你“相机在内部看外面没颜色”问题
     *
     * side：
     * - FrontSide（默认）：只渲染正面
     * - BackSide：只渲染背面
     * - DoubleSide：正反都渲染（编辑器阶段很常用）
     */
    const mat = new THREE.MeshNormalMaterial({
      side: THREE.DoubleSide
    })

    const cube = new THREE.Mesh(welded, mat)
    cube.position.set(i * 150, 0, 0)

    cubes.push(cube)
    scene.add(cube)

    // overlay：线框/点
    buildHelpers(cube)
  }

  /**
   * pointer 事件：统一处理（避免多处 addEventListener 互相打架）
   */
  const canvas = renderer.domElement

  const onPointerDown = (ev: PointerEvent) => {
    // 框选优先
    if (boxSelectMode.value) {
      boxSelectStart(ev)
      return
    }

    // 顶点模式优先
    if (tryPickVertex(ev)) return

    // Cut 工具
    if (toolMode.value === 'cut') {
      if (tryCut(ev)) return
    }

    // 物体选择（Raycast 到 cubes）
    updateMouseFromEvent(ev)
    raycaster.setFromCamera(mouse, camera)
    const intersects = raycaster.intersectObjects(cubes, false)
    if (intersects.length) {
      const obj = intersects[0].object

      // Ctrl 多选
      let newSelection = [...selectedObjects]
      if (ev.ctrlKey) {
        if (!newSelection.includes(obj)) newSelection.push(obj)
      } else {
        newSelection = [obj]
      }
      updateSelection(newSelection)
    }
  }

  const onPointerMove = (ev: PointerEvent) => {
    // 框选拖动
    if (boxSelectMode.value) {
      boxSelectMove(ev)
      return
    }

    // Cut 预览：已选第一点时，用当前鼠标吸附点更新预览线
    if (toolMode.value === 'cut' && cutFirst && selectedObjects.length === 1) {
      const mesh = selectedObjects[0] as THREE.Mesh
      const v2 = pickSnappedVertexOnMesh(ev, mesh, 18)
      if (v2 != null) {
        if (!cutPreviewLine.parent) mesh.add(cutPreviewLine)
        cutPreviewLine.visible = true
        updateCutPreview(mesh, cutFirst.vIndex, v2)
      }
    }
  }

  const onPointerUp = (ev: PointerEvent) => {
    if (boxSelectMode.value) boxSelectEnd(ev)
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)

  cleanupFns.push(() => {
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', onPointerUp)
  })

  // 默认先选中一个
  updateSelection([cubes[0]])

  animate()
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  cleanupFns.forEach(fn => fn())
  cleanupFns.length = 0

  // demo：简单 dispose
  cubes.forEach(m => {
    ;(m.geometry as THREE.BufferGeometry).dispose()
    ;(m.material as THREE.Material).dispose?.()
  })
  renderer?.dispose()
})

/**
 * editMode 切换：
 * - 切换模式时清理顶点/Cut 状态
 * - 重新控制 overlay 显示
 */
watch(editMode, () => {
  clearVertexEditing()
  clearCutState()
  clearHelpersVisible()

  if (selectedObjects.length === 1) {
    const m = selectedObjects[0] as THREE.Mesh
    if (m.userData.wire) m.userData.wire.visible = true
    if (m.userData.points) m.userData.points.visible = (editMode.value === 'vertex')
  }
})

/**
 * toolMode 切换：切换工具时清理 Cut 状态（避免残留第一点）
 */
watch(toolMode, () => {
  clearCutState()
})

/**
 * UI：设置 TransformControls 模式（平移/旋转/缩放）
 */
const setTransformMode = (mode: 'translate' | 'rotate' | 'scale') => {
  if (transform) transform.mode = mode
}

/**
 * UI：切换框选
 */
const toggleBoxSelectMode = () => {
  boxSelectMode.value = !boxSelectMode.value
  orbit.enabled = !boxSelectMode.value && !isDragging

  // 开启框选时，退出顶点/Cut 状态更符合编辑器习惯
  if (boxSelectMode.value) {
    clearVertexEditing()
    clearCutState()
  }
}

/**
 * UI：切换工具（select/cut）
 * - 再点一次同按钮就退出（回到 select）
 */
const toggleToolMode = (mode: ToolMode) => {
  toolMode.value = (toolMode.value === mode ? 'select' : mode)

  // 切到 cut 时建议退出 vertex 模式（避免操作冲突）
  if (toolMode.value === 'cut') editMode.value = 'object'
}
</script>

<template>
  <div style="position: relative; width: 800px; height: 800px;">
    <div style="margin-bottom: 8px;">
      <button @click="setTransformMode('translate')">平移</button>
      <button @click="setTransformMode('rotate')">旋转</button>
      <button @click="setTransformMode('scale')">缩放</button>

      <button @click="toggleBoxSelectMode">
        {{ boxSelectMode ? '关闭框选' : '开启框选' }}
      </button>

      <button @click="editMode = editMode === 'object' ? 'vertex' : 'object'">
        {{ editMode === 'object' ? '切到点模式' : '切到物体模式' }}
      </button>

      <button @click="toggleToolMode('cut')">
        {{ toolMode === 'cut' ? '退出 Cut' : 'Cut(切线)' }}
      </button>
    </div>

    <p style="margin: 0 0 8px 0;">
      物体模式：点击选择 / Ctrl 多选 / Gizmo 操作<br />
      点模式：点击顶点 → 拖动 Gizmo 改形状<br />
      Cut：先选中物体 → 开启 Cut → 在同一面上点两个对角点（吸附角点）→ 翻转对角线（正方形 + X）
    </p>

    <canvas ref="canvasRef" style="width: 800px; height: 800px;" />
    <div
      ref="selectionBox"
      style="position:absolute; border:1px dashed #0ff; pointer-events:none; display:none; left:0; top:0;"
    ></div>
  </div>
</template>
