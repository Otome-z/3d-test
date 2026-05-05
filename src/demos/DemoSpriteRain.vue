<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import * as THREE from "three";
import { createThreeBase } from "@/composables/useThreeBase";
import rainTextureUrl from "@/assets/rain.png";

const canvasRef = ref<HTMLCanvasElement | null>(null);
const spriteCount = ref(320);
const meshCount = ref(120);
const fallSpeed = ref(2.2);
const windStrength = ref(0.3);
const rainArea = ref(170);
const autoRotate = ref(true);
const showDivider = ref(true);
const sceneFps = ref(0);
const spriteFps = ref(0);
const meshFps = ref(0);

const speedLabel = computed(() => fallSpeed.value.toFixed(1));
const windLabel = computed(() => windStrength.value.toFixed(2));

let three: ReturnType<typeof createThreeBase> | null = null;
let spriteRainGroup: THREE.Group | null = null;
let meshRainGroup: THREE.Group | null = null;
let staticGroup: THREE.Group | null = null;
let dividerLine: THREE.Line | null = null;
let rainTexture: THREE.Texture | null = null;
let clock: THREE.Clock | null = null;
let frameId = 0;
let fpsElapsed = 0;
let fpsFrames = 0;
let spriteAvgMs = 0;
let meshAvgMs = 0;

type DropMeta = {
  speed: number;
  drift: number;
  sway: number;
  swayOffset: number;
};

type SpriteDrop = THREE.Sprite & { userData: DropMeta };
type MeshDrop = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> & {
  userData: DropMeta;
};

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
      material.forEach((item) => item.dispose());
    } else {
      material?.dispose();
    }
  });
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function applyDropState(drop: { position: THREE.Vector3; userData: DropMeta }, laneX: number) {
  drop.position.set(
    laneX + randomBetween(-rainArea.value, rainArea.value),
    randomBetween(80, 260),
    randomBetween(-rainArea.value, rainArea.value),
  );
  drop.userData.speed = randomBetween(0.9, 1.45);
  drop.userData.drift = randomBetween(0.5, 1.15);
  drop.userData.sway = randomBetween(0.6, 1.8);
  drop.userData.swayOffset = Math.random() * Math.PI * 2;
}

function createSpriteDrop() {
  const material = new THREE.SpriteMaterial({
    map: rainTexture!,
    transparent: true,
    opacity: randomBetween(0.35, 0.82),
    depthWrite: false,
    color: new THREE.Color().setHSL(0.56, 0.45, randomBetween(0.72, 0.92)),
  });

  const drop = new THREE.Sprite(material) as SpriteDrop;
  drop.scale.set(randomBetween(4.5, 7), randomBetween(18, 28), 1);
  return drop;
}

function createMeshDrop() {
  const geometry = new THREE.PlaneGeometry(
    randomBetween(4.5, 7),
    randomBetween(18, 28),
  );
  const material = new THREE.MeshBasicMaterial({
    map: rainTexture!,
    transparent: true,
    opacity: randomBetween(0.35, 0.82),
    depthWrite: false,
    side: THREE.DoubleSide,
    color: new THREE.Color().setHSL(0.56, 0.45, randomBetween(0.72, 0.92)),
  });
  const drop = new THREE.Mesh(geometry, material) as MeshDrop;
  drop.rotation.x = -0.18;
  return drop;
}

function rebuildDivider() {
  if (!three) return;
  if (dividerLine) {
    dividerLine.parent?.remove(dividerLine);
    dividerLine.geometry.dispose();
    (dividerLine.material as THREE.Material).dispose();
    dividerLine = null;
  }

  if (!showDivider.value) return;

  dividerLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -10, -210),
      new THREE.Vector3(0, -10, 210),
    ]),
    new THREE.LineDashedMaterial({ color: 0x64748b, dashSize: 10, gapSize: 8 }),
  );
  dividerLine.computeLineDistances();
  three.scene.add(dividerLine);
}

function rebuildStaticScene() {
  if (!three) return;
  disposeObject(staticGroup);
  staticGroup = new THREE.Group();

  const leftFloor = new THREE.Mesh(
    new THREE.CircleGeometry(150, 64),
    new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 1,
      metalness: 0.02,
    }),
  );
  leftFloor.rotation.x = -Math.PI / 2;
  leftFloor.position.set(-140, -12, 0);
  staticGroup.add(leftFloor);

  const rightFloor = new THREE.Mesh(
    new THREE.CircleGeometry(150, 64),
    new THREE.MeshStandardMaterial({
      color: 0x131a24,
      roughness: 1,
      metalness: 0.02,
    }),
  );
  rightFloor.rotation.x = -Math.PI / 2;
  rightFloor.position.set(140, -12, 0);
  staticGroup.add(rightFloor);

  const leftLabel = createTextSprite("Sprite Rain", "#38bdf8");
  leftLabel.position.set(-140, 118, 0);
  staticGroup.add(leftLabel);

  const rightLabel = createTextSprite("Mesh Rain", "#f59e0b");
  rightLabel.position.set(140, 118, 0);
  staticGroup.add(rightLabel);

  three.scene.add(staticGroup);
}

function createTextSprite(text: string, stroke: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 96;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "rgba(15, 23, 42, 0.78)";
  ctx.beginPath();
  ctx.roundRect(6, 6, 308, 84, 24);
  ctx.fill();
  ctx.strokeStyle = stroke;
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
  sprite.scale.set(88, 26, 1);
  return sprite;
}

function rebuildRain() {
  if (!three || !rainTexture) return;

  disposeObject(spriteRainGroup);
  disposeObject(meshRainGroup);
  spriteRainGroup = new THREE.Group();
  meshRainGroup = new THREE.Group();

  for (let i = 0; i < spriteCount.value; i += 1) {
    const drop = createSpriteDrop();
    applyDropState(drop, -140);
    spriteRainGroup.add(drop);
  }

  for (let i = 0; i < meshCount.value; i += 1) {
    const drop = createMeshDrop();
    applyDropState(drop, 140);
    meshRainGroup.add(drop);
  }

  three.scene.add(spriteRainGroup);
  three.scene.add(meshRainGroup);
}

function updateSpriteRain(delta: number, time: number) {
  if (!spriteRainGroup) return;
  const start = performance.now();
  for (const child of spriteRainGroup.children) {
    const drop = child as SpriteDrop;
    const speed = 120 * fallSpeed.value * drop.userData.speed * delta;
    const wind =
      42 * windStrength.value * drop.userData.drift * delta +
      Math.sin(time * drop.userData.sway + drop.userData.swayOffset) *
        8 *
        windStrength.value *
        delta;

    drop.position.y -= speed;
    drop.position.x += wind;

    if (
      drop.position.y < -10 ||
      drop.position.x < -140 - rainArea.value - 10 ||
      drop.position.x > -140 + rainArea.value + 10
    ) {
      applyDropState(drop, -140);
      drop.position.y = randomBetween(180, 260);
    }
  }
  const duration = performance.now() - start;
  spriteAvgMs = spriteAvgMs === 0 ? duration : spriteAvgMs * 0.9 + duration * 0.1;
}

function updateMeshRain(delta: number, time: number) {
  if (!meshRainGroup || !three) return;
  const start = performance.now();
  const cameraQuaternion = three.camera.quaternion;

  for (const child of meshRainGroup.children) {
    const drop = child as MeshDrop;
    const speed = 120 * fallSpeed.value * drop.userData.speed * delta;
    const wind =
      42 * windStrength.value * drop.userData.drift * delta +
      Math.sin(time * drop.userData.sway + drop.userData.swayOffset) *
        8 *
        windStrength.value *
        delta;

    drop.position.y -= speed;
    drop.position.x += wind;
    drop.quaternion.copy(cameraQuaternion);

    if (
      drop.position.y < -10 ||
      drop.position.x < 140 - rainArea.value - 10 ||
      drop.position.x > 140 + rainArea.value + 10
    ) {
      applyDropState(drop, 140);
      drop.position.y = randomBetween(180, 260);
    }
  }
  const duration = performance.now() - start;
  meshAvgMs = meshAvgMs === 0 ? duration : meshAvgMs * 0.9 + duration * 0.1;
}

function updateFps(delta: number) {
  fpsElapsed += delta;
  fpsFrames += 1;
  if (fpsElapsed < 0.25) return;

  sceneFps.value = Math.round(fpsFrames / fpsElapsed);
  spriteFps.value = spriteAvgMs > 0 ? Math.round(1000 / spriteAvgMs) : 0;
  meshFps.value = meshAvgMs > 0 ? Math.round(1000 / meshAvgMs) : 0;
  fpsElapsed = 0;
  fpsFrames = 0;
}

function animateRain() {
  const tick = () => {
    frameId = requestAnimationFrame(tick);
    if (!clock) return;

    const delta = Math.min(clock.getDelta(), 0.033);
    const time = clock.elapsedTime;
    updateSpriteRain(delta, time);
    updateMeshRain(delta, time);
    updateFps(delta);
  };

  tick();
}

onMounted(() => {
  three = createThreeBase(canvasRef.value!);
  clock = new THREE.Clock();
  const { scene, camera, orbit } = three;

  scene.background = new THREE.Color(0x070b12);
  scene.fog = new THREE.Fog(0x070b12, 140, 480);

  camera.position.set(0, 110, 320);
  orbit.target.set(0, 50, 0);
  orbit.autoRotate = autoRotate.value;
  orbit.autoRotateSpeed = 0.45;

  scene.add(new THREE.AmbientLight(0xbcd4ff, 1.15));

  const keyLight = new THREE.DirectionalLight(0xdbeafe, 1.3);
  keyLight.position.set(100, 180, 120);
  scene.add(keyLight);

  const fillLight = new THREE.PointLight(0x7dd3fc, 70, 500);
  fillLight.position.set(-120, 50, 90);
  scene.add(fillLight);

  rebuildStaticScene();
  rebuildDivider();

  rainTexture = new THREE.TextureLoader().load(rainTextureUrl, () => {
    rainTexture!.colorSpace = THREE.SRGBColorSpace;
    rebuildRain();
    animateRain();
  });

  three.start();
});

watch([spriteCount, meshCount, rainArea], () => {
  rebuildRain();
});

watch(autoRotate, (enabled) => {
  if (!three) return;
  three.orbit.autoRotate = enabled;
  three.orbit.autoRotateSpeed = 0.45;
});

watch(showDivider, () => {
  rebuildDivider();
});

onBeforeUnmount(() => {
  cancelAnimationFrame(frameId);
  disposeObject(spriteRainGroup);
  disposeObject(meshRainGroup);
  disposeObject(staticGroup);
  spriteRainGroup = null;
  meshRainGroup = null;
  staticGroup = null;
  if (dividerLine) {
    dividerLine.parent?.remove(dividerLine);
    dividerLine.geometry.dispose();
    (dividerLine.material as THREE.Material).dispose();
    dividerLine = null;
  }
  rainTexture?.dispose();
  rainTexture = null;
  sceneFps.value = 0;
  spriteFps.value = 0;
  meshFps.value = 0;
  three?.dispose();
  three = null;
  clock = null;
});
</script>

<template>
  <div
    style="display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap"
  >
    <div style="width: 860px">
      <div style="margin-bottom: 8px; line-height: 1.75">
        <label style="display: inline-flex; align-items: center; gap: 8px">
          <input v-model="autoRotate" type="checkbox" />
          <span>自动环绕观察</span>
        </label>
        <label
          style="
            margin-left: 12px;
            display: inline-flex;
            align-items: center;
            gap: 8px;
          "
        >
          <input v-model="showDivider" type="checkbox" />
          <span>显示分隔线</span>
        </label>
      </div>

      <div style="margin-bottom: 8px; line-height: 1.75">
        <span>Sprite 雨滴：{{ spriteCount }}</span>
        <input
          v-model.number="spriteCount"
          type="range"
          min="80"
          max="700"
          step="20"
          style="width: 200px; margin-left: 12px; vertical-align: middle"
        />
        <span style="margin-left: 16px">Mesh 雨滴：{{ meshCount }}</span>
        <input
          v-model.number="meshCount"
          type="range"
          min="20"
          max="260"
          step="10"
          style="width: 200px; margin-left: 12px; vertical-align: middle"
        />
      </div>

      <div style="margin-bottom: 8px; line-height: 1.75">
        <span>下落速度：{{ speedLabel }}</span>
        <input
          v-model.number="fallSpeed"
          type="range"
          min="0.6"
          max="4"
          step="0.1"
          style="width: 180px; margin-left: 12px; vertical-align: middle"
        />
        <span style="margin-left: 16px">风力：{{ windLabel }}</span>
        <input
          v-model.number="windStrength"
          type="range"
          min="0"
          max="1.2"
          step="0.05"
          style="width: 180px; margin-left: 12px; vertical-align: middle"
        />
        <span style="margin-left: 16px">范围：{{ rainArea }}</span>
        <input
          v-model.number="rainArea"
          type="range"
          min="80"
          max="200"
          step="5"
          style="width: 160px; margin-left: 12px; vertical-align: middle"
        />
      </div>

      <div style="margin-bottom: 8px; line-height: 1.75; opacity: 0.82">
        左边是 <code>THREE.Sprite</code> 雨，右边是普通
        <code>PlaneGeometry Mesh</code> 雨。为了对比更公平，两边都使用同一张
        <code>src/assets/rain.png</code> 贴图。
      </div>

      <div
        style="
          position: relative;
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
        <div
          style="
            position: absolute;
            top: 12px;
            right: 12px;
            min-width: 160px;
            padding: 10px 12px;
            border-radius: 10px;
            background: rgba(15, 23, 42, 0.82);
            border: 1px solid rgba(148, 163, 184, 0.28);
            line-height: 1.65;
            font-size: 12px;
            pointer-events: none;
          "
        >
          <div style="font-weight: 700; margin-bottom: 6px">性能面板</div>
          <div>场景 FPS：{{ sceneFps }}</div>
          <div>Sprite 估算 FPS：{{ spriteFps }}</div>
          <div>Mesh 估算 FPS：{{ meshFps }}</div>
        </div>
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
        <div style="font-weight: 700; margin-bottom: 10px">结论</div>
        <div>普通 Mesh 也能模拟下雨，这个 demo 右侧就是用很多个平面 Mesh 做出来的。</div>
        <div>
          但如果只是做“始终朝向相机的雨滴贴片”，Sprite 更直接，通常也更适合大批量粒子。
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
        <div style="font-weight: 700; margin-bottom: 10px">为什么 Mesh 更重</div>
        <div>Mesh 雨滴需要真实几何体，每个雨滴至少有一个平面几何和一个材质实例。</div>
        <div>为了看起来像 Sprite，还要在动画里手动让每个 Mesh 朝向相机。</div>
        <div>所以我默认把 Mesh 雨滴数量调得更少，范围也建议不要铺得太大。</div>
      </div>

      <div
        style="
          border: 1px solid #2a2a2a;
          border-radius: 10px;
          padding: 12px;
          line-height: 1.75;
        "
      >
        <div style="font-weight: 700; margin-bottom: 10px">当前参数</div>
        <div>Sprite 雨滴：{{ spriteCount }}</div>
        <div>Mesh 雨滴：{{ meshCount }}</div>
        <div>下落速度：{{ speedLabel }}</div>
        <div>风力：{{ windLabel }}</div>
        <div>下雨范围：{{ rainArea }}</div>
      </div>

      <div
        style="
          border: 1px solid #2a2a2a;
          border-radius: 10px;
          padding: 12px;
          line-height: 1.75;
        "
      >
        <div style="font-weight: 700; margin-bottom: 10px">最小对比代码</div>
        <pre style="margin: 0; white-space: pre-wrap">
const sprite = new THREE.Sprite(
  new THREE.SpriteMaterial({ map: texture, transparent: true })
)

const mesh = new THREE.Mesh(
  new THREE.PlaneGeometry(6, 24),
  new THREE.MeshBasicMaterial({ map: texture, transparent: true })
)

mesh.quaternion.copy(camera.quaternion)</pre
        >
      </div>
    </div>
  </div>
</template>
