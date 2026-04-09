<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import * as THREE from "three";
import { createThreeBase } from "@/composables/useThreeBase";

type ShapeKey = "plate" | "panel" | "star";

const canvasRef = ref<HTMLCanvasElement | null>(null);
const shapeKey = ref<ShapeKey>("plate");
const depth = ref(28);
const steps = ref(1);
const bevelEnabled = ref(true);
const wireframe = ref(false);
const rotateModel = ref(true);

const shapeLabel = computed(() => {
  if (shapeKey.value === "panel") return "面板轮廓";
  if (shapeKey.value === "star") return "星形轮廓";
  return "铭牌轮廓";
});

let three: ReturnType<typeof createThreeBase> | null = null;
let extrudeMesh: THREE.Mesh | null = null;
let outlineLine: THREE.Line | null = null;
let holeLine: THREE.Line | null = null;
let frameId = 0;

function createRoundedRectShape(width: number, height: number, radius: number) {
  const x = -width / 2;
  const y = -height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  return shape;
}

function createStarShape() {
  const shape = new THREE.Shape();
  const outerRadius = 108;
  const innerRadius = 44;

  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;

    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }

  shape.closePath();

  const hole = new THREE.Path();
  hole.absellipse(0, 0, 18, 18, 0, Math.PI * 2);
  shape.holes.push(hole);
  return shape;
}

function createShape(kind: ShapeKey) {
  if (kind === "panel") {
    const shape = createRoundedRectShape(210, 126, 22);
    const hole = new THREE.Path();
    hole.moveTo(-42, 0);
    hole.lineTo(42, 0);
    hole.lineTo(42, -20);
    hole.lineTo(-42, -20);
    hole.closePath();
    shape.holes.push(hole);
    return shape;
  }

  if (kind === "star") {
    return createStarShape();
  }

  const shape = createRoundedRectShape(220, 112, 26);
  const leftHole = new THREE.Path();
  leftHole.absellipse(-78, 0, 14, 14, 0, Math.PI * 2);
  const rightHole = new THREE.Path();
  rightHole.absellipse(78, 0, 14, 14, 0, Math.PI * 2);
  shape.holes.push(leftHole, rightHole);
  return shape;
}

function disposeMesh(mesh: THREE.Mesh | null) {
  if (!mesh) return;
  mesh.parent?.remove(mesh);
  mesh.geometry.dispose();
  (mesh.material as THREE.Material).dispose();
}

function disposeLine(line: THREE.Line | null) {
  if (!line) return;
  line.parent?.remove(line);
  line.geometry.dispose();
  (line.material as THREE.Material).dispose();
}

function rebuildExtrude() {
  if (!three) return;

  disposeMesh(extrudeMesh);
  disposeLine(outlineLine);
  disposeLine(holeLine);
  extrudeMesh = null;
  outlineLine = null;
  holeLine = null;

  const shape = createShape(shapeKey.value);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: depth.value,
    steps: steps.value,
    bevelEnabled: bevelEnabled.value,
    bevelSegments: bevelEnabled.value ? 3 : 0,
    bevelSize: bevelEnabled.value ? 6 : 0,
    bevelThickness: bevelEnabled.value ? 4 : 0,
  });
  geometry.center();

  const material = new THREE.MeshStandardMaterial({
    color: 0xfca5a5,
    emissive: 0x3f1111,
    roughness: 0.4,
    metalness: 0.08,
    side: THREE.DoubleSide,
    wireframe: wireframe.value,
  });
  extrudeMesh = new THREE.Mesh(geometry, material);
  extrudeMesh.position.set(96, 0, 0);
  extrudeMesh.rotation.x = -0.5;
  extrudeMesh.rotation.y = 0.8;
  three.scene.add(extrudeMesh);

  const outlinePoints = shape
    .getPoints(140)
    .map((point) => new THREE.Vector3(point.x - 170, point.y, 0));
  outlineLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(outlinePoints),
    new THREE.LineBasicMaterial({ color: 0x67e8f9 }),
  );
  three.scene.add(outlineLine);

  if (shape.holes[0]) {
    const holePoints = shape.holes[0]
      .getPoints(100)
      .map((point) => new THREE.Vector3(point.x - 170, point.y, 0));
    holeLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(holePoints),
      new THREE.LineBasicMaterial({ color: 0xfbbf24 }),
    );
    three.scene.add(holeLine);
  }
}

function startAnimation() {
  const tick = () => {
    frameId = requestAnimationFrame(tick);
    if (extrudeMesh && rotateModel.value) {
      extrudeMesh.rotation.y += 0.01;
    }
  };

  tick();
}

onMounted(() => {
  three = createThreeBase(canvasRef.value!);
  const { scene, camera, orbit } = three;

  camera.position.set(320, 180, 360);
  orbit.target.set(70, 0, 0);
  scene.background = new THREE.Color(0x13151a);

  scene.add(new THREE.AmbientLight(0xffffff, 1.65));

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
  keyLight.position.set(180, 240, 180);
  scene.add(keyLight);

  const fillLight = new THREE.PointLight(0xa5f3fc, 70, 800);
  fillLight.position.set(-180, 130, 140);
  scene.add(fillLight);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(180, 64),
    new THREE.MeshStandardMaterial({
      color: 0x1f2937,
      roughness: 0.96,
      metalness: 0.04,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(90, -112, 0);
  scene.add(floor);

  rebuildExtrude();
  startAnimation();
  three.start();
});

watch([shapeKey, depth, steps, bevelEnabled, wireframe], () => {
  rebuildExtrude();
});

onBeforeUnmount(() => {
  cancelAnimationFrame(frameId);
  disposeMesh(extrudeMesh);
  disposeLine(outlineLine);
  disposeLine(holeLine);
  extrudeMesh = null;
  outlineLine = null;
  holeLine = null;
  three?.dispose();
  three = null;
});
</script>

<template>
  <div
    style="display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap"
  >
    <div style="width: 860px">
      <div style="margin-bottom: 8px; line-height: 1.75">
        <button @click="shapeKey = 'plate'">铭牌</button>
        <button @click="shapeKey = 'panel'" style="margin-left: 6px">
          面板
        </button>
        <button @click="shapeKey = 'star'" style="margin-left: 6px">
          星形
        </button>
        <label
          style="
            margin-left: 12px;
            display: inline-flex;
            align-items: center;
            gap: 8px;
          "
        >
          <input v-model="bevelEnabled" type="checkbox" />
          <span>倒角</span>
        </label>
        <label
          style="
            margin-left: 12px;
            display: inline-flex;
            align-items: center;
            gap: 8px;
          "
        >
          <input v-model="wireframe" type="checkbox" />
          <span>线框</span>
        </label>
        <label
          style="
            margin-left: 12px;
            display: inline-flex;
            align-items: center;
            gap: 8px;
          "
        >
          <input v-model="rotateModel" type="checkbox" />
          <span>旋转观察</span>
        </label>
      </div>

      <div style="margin-bottom: 8px; line-height: 1.75">
        <span>挤出深度：{{ depth }}</span>
        <input
          v-model.number="depth"
          type="range"
          min="4"
          max="80"
          step="1"
          style="width: 220px; margin-left: 12px; vertical-align: middle"
        />
        <span style="margin-left: 12px">步数：{{ steps }}</span>
        <input
          v-model.number="steps"
          type="range"
          min="1"
          max="12"
          step="1"
          style="width: 180px; margin-left: 12px; vertical-align: middle"
        />
      </div>

      <div style="margin-bottom: 8px; line-height: 1.75; opacity: 0.82">
        左边是 2D 轮廓，右边是把同一个 shape 挤出后的 3D 结果。
      </div>

      <div
        style="
          width: 840px;
          height: 620px;
          border: 1px solid #2a2a2a;
          border-radius: 10px;
          overflow: hidden;
        "
      >
        <canvas
          ref="canvasRef"
          style="width: 840px; height: 620px; display: block"
        />
      </div>
    </div>

    <div style="width: 420px; display: flex; flex-direction: column; gap: 12px">
      <div
        style="
          border: 1px solid #2a2a2a;
          border-radius: 10px;
          padding: 12px;
          line-height: 1.75;
        "
      >
        <div style="font-weight: 700; margin-bottom: 10px">
          ExtrudeGeometry 是什么
        </div>
        <div>
          把二维轮廓沿着垂直方向“加厚”，从平面 shape 生成有体积的 3D 模型。
        </div>
        <div>
          它通常可以看成是 ShapeGeometry 的下一步：先定义轮廓，再挤出厚度。
        </div>
      </div>

      <div
        style="
          border: 1px solid #2a2a2a;
          border-radius: 10px;
          padding: 12px;
          line-height: 1.75;
        "
      >
        <div style="font-weight: 700; margin-bottom: 10px">当前示例</div>
        <div>轮廓类型：{{ shapeLabel }}</div>
        <div>
          几何体：<code>new THREE.ExtrudeGeometry(shape, options)</code>
        </div>
        <div>深度：{{ depth }}</div>
        <div>步数：{{ steps }}</div>
        <div>倒角：{{ bevelEnabled ? "开启" : "关闭" }}</div>
      </div>

      <div
        style="
          border: 1px solid #2a2a2a;
          border-radius: 10px;
          padding: 12px;
          line-height: 1.75;
        "
      >
        <div style="font-weight: 700; margin-bottom: 10px">关键点</div>
        <div>
          <code>depth</code> 控制厚度，<code>steps</code> 控制挤出方向分段。
        </div>
        <div>
          <code>bevelEnabled</code>、<code>bevelSize</code>、<code
            >bevelThickness</code
          >
          可以做边缘倒角。
        </div>
        <div>外轮廓和 holes 会一起参与挤出，所以镂空结构也能直接变成立体。</div>
      </div>

      <div
        style="
          border: 1px solid #2a2a2a;
          border-radius: 10px;
          padding: 12px;
          line-height: 1.75;
        "
      >
        <div style="font-weight: 700; margin-bottom: 10px">最小代码</div>
        <pre style="margin: 0; white-space: pre-wrap">
const shape = new THREE.Shape()
shape.moveTo(0, 0)
shape.lineTo(80, 0)
shape.lineTo(80, 40)
shape.lineTo(0, 40)
shape.closePath()

const geometry = new THREE.ExtrudeGeometry(shape, {
  depth: 20,
  bevelEnabled: true
})</pre
        >
      </div>
    </div>
  </div>
</template>
