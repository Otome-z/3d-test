<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import * as THREE from "three";
import { createThreeBase } from "@/composables/useThreeBase";

type ProfileKey = "vase" | "cup" | "chess";

const canvasRef = ref<HTMLCanvasElement | null>(null);
const profileKey = ref<ProfileKey>("vase");
const segments = ref(24);
const wireframe = ref(false);
const autoRotate = ref(true);

const profileLabel = computed(() => {
  if (profileKey.value === "cup") return "杯子轮廓";
  if (profileKey.value === "chess") return "棋子轮廓";
  return "花瓶轮廓";
});

let three: ReturnType<typeof createThreeBase> | null = null;
let latheMesh: THREE.Mesh | null = null;
let profileLine: THREE.Line | null = null;
let axisLine: THREE.Line | null = null;

function createProfilePoints(kind: ProfileKey) {
  if (kind === "cup") {
    return [
      new THREE.Vector2(0, -90),
      new THREE.Vector2(38, -90),
      new THREE.Vector2(46, -72),
      new THREE.Vector2(50, -16),
      new THREE.Vector2(44, 42),
      new THREE.Vector2(28, 88),
      new THREE.Vector2(18, 110),
      new THREE.Vector2(0, 110),
    ];
  }

  if (kind === "chess") {
    return [
      new THREE.Vector2(0, -105),
      new THREE.Vector2(52, -105),
      new THREE.Vector2(48, -82),
      new THREE.Vector2(24, -58),
      new THREE.Vector2(18, -8),
      new THREE.Vector2(28, 30),
      new THREE.Vector2(16, 58),
      new THREE.Vector2(24, 86),
      new THREE.Vector2(12, 116),
      new THREE.Vector2(0, 116),
    ];
  }

  return [
    new THREE.Vector2(0, -110),
    new THREE.Vector2(26, -110),
    new THREE.Vector2(34, -78),
    new THREE.Vector2(22, -24),
    new THREE.Vector2(54, 20),
    new THREE.Vector2(44, 78),
    new THREE.Vector2(18, 112),
    new THREE.Vector2(0, 112),
  ];
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

function rebuildLathe() {
  if (!three) return;

  disposeMesh(latheMesh);
  disposeLine(profileLine);
  latheMesh = null;
  profileLine = null;

  const points = createProfilePoints(profileKey.value);

  const geometry = new THREE.LatheGeometry(points, segments.value);
  const material = new THREE.MeshStandardMaterial({
    color: 0xd9f99d,
    roughness: 0.35,
    metalness: 0.08,
    wireframe: wireframe.value,
    side: THREE.DoubleSide,
  });
  latheMesh = new THREE.Mesh(geometry, material);
  latheMesh.position.x = 90;
  three.scene.add(latheMesh);

  const previewPoints = points.map(
    (point) => new THREE.Vector3(point.x - 120, point.y, 0),
  );
  profileLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(previewPoints),
    new THREE.LineBasicMaterial({ color: 0x74c0fc }),
  );
  three.scene.add(profileLine);
}

onMounted(() => {
  three = createThreeBase(canvasRef.value!);
  const { scene, camera, orbit } = three;

  camera.position.set(320, 180, 360);
  orbit.target.set(80, 10, 0);
  orbit.autoRotate = autoRotate.value;
  orbit.autoRotateSpeed = 1.2;
  scene.background = new THREE.Color(0x0f172a);

  scene.add(new THREE.AmbientLight(0xffffff, 1.8));

  const directionalLight = new THREE.DirectionalLight(0xffffff, 1.6);
  directionalLight.position.set(180, 260, 160);
  scene.add(directionalLight);

  const fillLight = new THREE.PointLight(0x93c5fd, 80, 900);
  fillLight.position.set(-180, 120, 140);
  scene.add(fillLight);

  axisLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-120, -140, 0),
      new THREE.Vector3(-120, 140, 0),
    ]),
    new THREE.LineDashedMaterial({ color: 0xf87171, dashSize: 10, gapSize: 6 }),
  );
  (
    axisLine as THREE.Line<THREE.BufferGeometry, THREE.LineDashedMaterial>
  ).computeLineDistances();
  scene.add(axisLine);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(180, 64),
    new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.92,
      metalness: 0.05,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(90, -110, 0);
  scene.add(floor);

  rebuildLathe();
  three.start();
});

watch([profileKey, segments, wireframe], () => {
  rebuildLathe();
});

watch(autoRotate, (enabled) => {
  if (!three) return;
  three.orbit.autoRotate = enabled;
  three.orbit.autoRotateSpeed = 1.2;
});

onBeforeUnmount(() => {
  disposeMesh(latheMesh);
  disposeLine(profileLine);
  disposeLine(axisLine);
  latheMesh = null;
  profileLine = null;
  axisLine = null;
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
        <button @click="profileKey = 'vase'">花瓶</button>
        <button @click="profileKey = 'cup'" style="margin-left: 6px">
          杯子
        </button>
        <button @click="profileKey = 'chess'" style="margin-left: 6px">
          棋子
        </button>
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
          <input v-model="autoRotate" type="checkbox" />
          <span>自动旋转</span>
        </label>
      </div>

      <div style="margin-bottom: 8px; line-height: 1.75">
        <span>旋转分段：{{ segments }}</span>
        <input
          v-model.number="segments"
          type="range"
          min="6"
          max="64"
          step="1"
          style="width: 280px; margin-left: 12px; vertical-align: middle"
        />
        <span style="margin-left: 12px; opacity: 0.82"
          >左侧蓝线是 2D 轮廓，红虚线是旋转轴</span
        >
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
          LatheGeometry 是什么
        </div>
        <div>
          把一条位于 X-Y 平面的 2D 轮廓线，绕着 Y 轴旋转一圈，生成一个 3D 模型。
        </div>
        <div>
          很适合做花瓶、杯子、瓶盖、棋子这类“截面清楚、绕轴对称”的物体。
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
        <div>轮廓类型：{{ profileLabel }}</div>
        <div>
          几何体：<code>new THREE.LatheGeometry(points, segments)</code>
        </div>
        <div>当前分段：{{ segments }}</div>
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
          轮廓点通常用 <code>Vector2</code> 表示，`x` 是半径，`y` 是高度。
        </div>
        <div>如果轮廓首尾贴到 Y 轴附近，成型出来会更容易封口。</div>
        <div>分段越高越圆滑，但面数也会更多。</div>
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
          const points = [
            new THREE.Vector2(0, -100),
            new THREE.Vector2(40, -100),
            new THREE.Vector2(22, 40),
            new THREE.Vector2(0, 100)
          ]

          const geometry = new THREE.LatheGeometry(points, 24)
        </pre>
      </div>
    </div>
  </div>
</template>
