<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import * as THREE from "three";
import { createThreeBase } from "@/composables/useThreeBase";

type CameraView = "front" | "side" | "top";

const canvasRef = ref<HTMLCanvasElement | null>(null);
const rotateGroup = ref(true);
const showHelpers = ref(true);
const meshScale = ref(1);
const spriteScale = ref(1);
const currentView = ref<CameraView>("front");

const meshLabel = computed(() => `${Math.round(meshScale.value * 100)}%`);
const spriteLabel = computed(() => `${Math.round(spriteScale.value * 100)}%`);

let three: ReturnType<typeof createThreeBase> | null = null;
let compareGroup: THREE.Group | null = null;
let helperGroup: THREE.Group | null = null;
let sharedTexture: THREE.CanvasTexture | null = null;
let frameId = 0;

function createCardTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const gradient = ctx.createLinearGradient(0, 0, 256, 256);
  gradient.addColorStop(0, "#22d3ee");
  gradient.addColorStop(1, "#f59e0b");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);

  ctx.fillStyle = "rgba(15, 23, 42, 0.16)";
  for (let i = 0; i < 6; i += 1) {
    ctx.beginPath();
    ctx.arc(36 + i * 38, 212 - (i % 2) * 24, 18, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#082f49";
  ctx.beginPath();
  ctx.roundRect(24, 24, 208, 208, 28);
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.72)";
  ctx.lineWidth = 6;
  ctx.stroke();

  ctx.fillStyle = "#f8fafc";
  ctx.font = "bold 64px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("3D", 128, 122);

  ctx.font = "28px sans-serif";
  ctx.fillText("Mesh / Sprite", 128, 162);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function disposeObject(object: THREE.Object3D | null) {
  if (!object) return;
  object.parent?.remove(object);
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }

    const material = (child as THREE.Mesh | THREE.Sprite).material;
    if (Array.isArray(material)) {
      material.forEach((item) => {
        (item as THREE.SpriteMaterial).map?.dispose();
        item.dispose();
      });
    } else {
      (material as THREE.SpriteMaterial | THREE.MeshStandardMaterial | undefined)
        ?.map?.dispose();
      material?.dispose();
    }
  });
}

function createLabelSprite(text: string, color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "rgba(15, 23, 42, 0.82)";
  ctx.beginPath();
  ctx.roundRect(6, 6, 308, 84, 24);
  ctx.fill();

  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.stroke();

  ctx.fillStyle = "#f8fafc";
  ctx.font = "bold 30px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 160, 48);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(80, 24, 1);
  sprite.renderOrder = 10;
  return sprite;
}

function buildHelpers() {
  if (!compareGroup) return;
  disposeObject(helperGroup);
  helperGroup = null;

  if (!showHelpers.value) return;

  helperGroup = new THREE.Group();

  const meshArrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(-90, -72, 0),
    58,
    0x38bdf8,
    18,
    10,
  );
  helperGroup.add(meshArrow);

  const spriteArrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(90, -72, 0),
    58,
    0xf97316,
    18,
    10,
  );
  helperGroup.add(spriteArrow);

  const meshLabelSprite = createLabelSprite("Mesh: real plane geometry", "#38bdf8");
  if (meshLabelSprite) {
    meshLabelSprite.position.set(-90, 86, 0);
    helperGroup.add(meshLabelSprite);
  }

  const spriteLabelSprite = createLabelSprite(
    "Sprite: always faces camera",
    "#f97316",
  );
  if (spriteLabelSprite) {
    spriteLabelSprite.position.set(90, 86, 0);
    helperGroup.add(spriteLabelSprite);
  }

  compareGroup.add(helperGroup);
}

function rebuildSceneObjects() {
  if (!three || !sharedTexture) return;

  disposeObject(compareGroup);
  compareGroup = new THREE.Group();

  const planeGeometry = new THREE.PlaneGeometry(96, 96);
  const planeMaterial = new THREE.MeshStandardMaterial({
    map: sharedTexture,
    side: THREE.DoubleSide,
    roughness: 0.4,
    metalness: 0.06,
  });
  const meshCard = new THREE.Mesh(planeGeometry, planeMaterial);
  meshCard.position.set(-90, 0, 0);
  meshCard.scale.setScalar(meshScale.value);
  compareGroup.add(meshCard);

  const meshEdge = new THREE.LineSegments(
    new THREE.EdgesGeometry(planeGeometry),
    new THREE.LineBasicMaterial({ color: 0x93c5fd }),
  );
  meshCard.add(meshEdge);

  const spriteMaterial = new THREE.SpriteMaterial({
    map: sharedTexture,
    transparent: true,
    depthWrite: false,
  });
  const spriteCard = new THREE.Sprite(spriteMaterial);
  spriteCard.position.set(90, 0, 0);
  spriteCard.scale.set(96 * spriteScale.value, 96 * spriteScale.value, 1);
  compareGroup.add(spriteCard);

  const separator = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -110, 0),
      new THREE.Vector3(0, 110, 0),
    ]),
    new THREE.LineDashedMaterial({ color: 0x64748b, dashSize: 8, gapSize: 6 }),
  );
  separator.computeLineDistances();
  compareGroup.add(separator);

  buildHelpers();
  three.scene.add(compareGroup);
}

function setCameraView(view: CameraView) {
  currentView.value = view;
  if (!three) return;

  const { camera, orbit } = three;
  if (view === "side") {
    camera.position.set(320, 80, 0.1);
  } else if (view === "top") {
    camera.position.set(0, 360, 0.1);
  } else {
    camera.position.set(0, 120, 360);
  }

  orbit.target.set(0, 0, 0);
  orbit.update();
}

function startAnimation() {
  const tick = () => {
    frameId = requestAnimationFrame(tick);
    if (compareGroup && rotateGroup.value) {
      compareGroup.rotation.y += 0.01;
    }
  };

  tick();
}

onMounted(() => {
  three = createThreeBase(canvasRef.value!);
  const { scene, camera, orbit } = three;

  scene.background = new THREE.Color(0x0f172a);
  camera.position.set(0, 120, 360);
  orbit.target.set(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 1.4));

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.9);
  keyLight.position.set(140, 220, 180);
  scene.add(keyLight);

  const rimLight = new THREE.PointLight(0x7dd3fc, 80, 800);
  rimLight.position.set(-180, 80, 120);
  scene.add(rimLight);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(220, 64),
    new THREE.MeshStandardMaterial({
      color: 0x111827,
      roughness: 0.95,
      metalness: 0.03,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -90;
  scene.add(floor);

  sharedTexture = createCardTexture();
  rebuildSceneObjects();
  setCameraView("front");
  startAnimation();
  three.start();
});

watch([meshScale, spriteScale], () => {
  rebuildSceneObjects();
});

watch(showHelpers, () => {
  buildHelpers();
});

onBeforeUnmount(() => {
  cancelAnimationFrame(frameId);
  disposeObject(compareGroup);
  compareGroup = null;
  helperGroup = null;
  sharedTexture?.dispose();
  sharedTexture = null;
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
        <button @click="setCameraView('front')">正面</button>
        <button @click="setCameraView('side')" style="margin-left: 6px">
          侧面
        </button>
        <button @click="setCameraView('top')" style="margin-left: 6px">
          顶部
        </button>
        <label
          style="
            margin-left: 12px;
            display: inline-flex;
            align-items: center;
            gap: 8px;
          "
        >
          <input v-model="rotateGroup" type="checkbox" />
          <span>旋转观察</span>
        </label>
        <label
          style="
            margin-left: 12px;
            display: inline-flex;
            align-items: center;
            gap: 8px;
          "
        >
          <input v-model="showHelpers" type="checkbox" />
          <span>显示辅助标记</span>
        </label>
      </div>

      <div style="margin-bottom: 8px; line-height: 1.75">
        <span>Mesh 尺寸：{{ meshLabel }}</span>
        <input
          v-model.number="meshScale"
          type="range"
          min="0.5"
          max="1.8"
          step="0.05"
          style="width: 220px; margin-left: 12px; vertical-align: middle"
        />
        <span style="margin-left: 16px">Sprite 尺寸：{{ spriteLabel }}</span>
        <input
          v-model.number="spriteScale"
          type="range"
          min="0.5"
          max="1.8"
          step="0.05"
          style="width: 220px; margin-left: 12px; vertical-align: middle"
        />
      </div>

      <div style="margin-bottom: 8px; line-height: 1.75; opacity: 0.82">
        左边是普通 <code>Mesh + PlaneGeometry</code>，右边是
        <code>THREE.Sprite</code>。切到“侧面”时差异会最明显。
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
          核心区别
        </div>
        <div>
          普通 Mesh 是真实几何体，这里用的是
          <code>PlaneGeometry</code>，它有顶点、面、法线，也会参与光照计算。
        </div>
        <div>
          Sprite 更像“始终朝向相机的贴图卡片”，Three.js 会自动让它面对相机，常用于图标、标注、粒子。
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
        <div style="font-weight: 700; margin-bottom: 10px">当前观察</div>
        <div>视角：{{ currentView }}</div>
        <div>Mesh 缩放：{{ meshLabel }}</div>
        <div>Sprite 缩放：{{ spriteLabel }}</div>
        <div>
          建议：先看正面，再切到侧面，你会看到 Mesh 变成“薄片边缘”，而 Sprite 仍然朝向相机。
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
        <div style="font-weight: 700; margin-bottom: 10px">什么时候用</div>
        <div>
          用 Mesh：需要真实几何、受光照、需要被切割/拾取/做布尔或拓扑编辑。
        </div>
        <div>
          用 Sprite：需要始终可见的标记、热点、标签、粒子点精灵、UI 风格提示。
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
        <div style="font-weight: 700; margin-bottom: 10px">最小代码</div>
        <pre style="margin: 0; white-space: pre-wrap">
const texture = new THREE.TextureLoader().load("icon.png")

const mesh = new THREE.Mesh(
  new THREE.PlaneGeometry(100, 100),
  new THREE.MeshStandardMaterial({ map: texture })
)

const sprite = new THREE.Sprite(
  new THREE.SpriteMaterial({ map: texture, transparent: true })
)</pre
        >
      </div>
    </div>
  </div>
</template>
