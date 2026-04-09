<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import * as THREE from "three";
import { createThreeBase } from "@/composables/useThreeBase";

type ShapeKey = "heart" | "badge" | "ticket";
type ShapeStep = {
  index: number;
  command: string;
  color: number;
  points: THREE.Vector2[];
};

type ShapeBuildResult = {
  shape: THREE.Shape;
  steps: ShapeStep[];
};

const canvasRef = ref<HTMLCanvasElement | null>(null);
const shapeKey = ref<ShapeKey>("heart");
const curveSegments = ref(24);
const wireframe = ref(false);
const showOutline = ref(true);
const rotateMesh = ref(true);

const shapeLabel = computed(() => {
  if (shapeKey.value === "badge") return "徽章轮廓";
  if (shapeKey.value === "ticket") return "票券轮廓";
  return "爱心轮廓";
});

const shapeSteps = computed(() => createShape(shapeKey.value).steps);
const STEP_COLORS = [
  0x38bdf8, 0xf97316, 0xa3e635, 0xf472b6, 0xfacc15, 0x22c55e, 0xc084fc,
  0xfb7185,
];

let three: ReturnType<typeof createThreeBase> | null = null;
let shapeMesh: THREE.Mesh | null = null;
let outlineGroup: THREE.Group | null = null;
let holeLine: THREE.Line | null = null;
let animationId = 0;

function getStepColor(index: number) {
  return STEP_COLORS[(index - 1) % STEP_COLORS.length];
}

function getCurveSampleCount(curve: THREE.Curve<THREE.Vector2>) {
  if (curve instanceof THREE.LineCurve) return 1;
  if (curve instanceof THREE.EllipseCurve) return 48;
  return 24;
}

function createShapeBuilder() {
  const shape = new THREE.Shape();
  const steps: ShapeStep[] = [];

  const recordStep = (command: string) => {
    const curve = shape.curves[shape.curves.length - 1];
    const index = steps.length + 1;
    steps.push({
      index,
      command,
      color: getStepColor(index),
      points: curve.getPoints(getCurveSampleCount(curve)),
    });
  };

  return {
    shape,
    steps,
    moveTo(x: number, y: number) {
      shape.moveTo(x, y);
    },
    lineTo(x: number, y: number) {
      shape.lineTo(x, y);
      recordStep(`lineTo(${x}, ${y})`);
    },
    bezierCurveTo(
      cp1X: number,
      cp1Y: number,
      cp2X: number,
      cp2Y: number,
      x: number,
      y: number,
    ) {
      shape.bezierCurveTo(cp1X, cp1Y, cp2X, cp2Y, x, y);
      recordStep(
        `bezierCurveTo(${cp1X}, ${cp1Y}, ${cp2X}, ${cp2Y}, ${x}, ${y})`,
      );
    },
    quadraticCurveTo(cpX: number, cpY: number, x: number, y: number) {
      shape.quadraticCurveTo(cpX, cpY, x, y);
      recordStep(`quadraticCurveTo(${cpX}, ${cpY}, ${x}, ${y})`);
    },
    absarc(
      x: number,
      y: number,
      radius: number,
      startAngle: number,
      endAngle: number,
      clockwise?: boolean,
    ) {
      shape.absarc(x, y, radius, startAngle, endAngle, clockwise);
      recordStep(
        `absarc(${x}, ${y}, ${radius}, ${startAngle.toFixed(2)}, ${endAngle.toFixed(2)}, ${Boolean(clockwise)})`,
      );
    },
  };
}

function createShape(kind: ShapeKey): ShapeBuildResult {
  if (kind === "badge") {
    const builder = createShapeBuilder();
    builder.moveTo(0, 92);
    builder.bezierCurveTo(48, 108, 98, 70, 92, 22);
    builder.bezierCurveTo(108, -22, 72, -80, 18, -88);
    builder.quadraticCurveTo(0, -120, -18, -88);
    builder.bezierCurveTo(-72, -80, -108, -22, -92, 22);
    builder.bezierCurveTo(-98, 70, -48, 108, 0, 92);

    const hole = new THREE.Path();
    hole.absellipse(0, 8, 24, 24, 0, Math.PI * 2);
    builder.shape.holes.push(hole);
    return { shape: builder.shape, steps: builder.steps };
  }

  if (kind === "ticket") {
    const builder = createShapeBuilder();
    builder.moveTo(-108, 68);
    builder.lineTo(108, 68);
    builder.absarc(108, 32, 18, Math.PI / 2, -Math.PI / 2, true);
    builder.lineTo(126, -32);
    builder.absarc(108, -68, 18, Math.PI / 2, Math.PI * 1.5, false);
    builder.lineTo(-108, -86);
    builder.absarc(-108, -68, 18, Math.PI * 1.5, Math.PI / 2, false);
    builder.lineTo(-126, 32);
    builder.absarc(-108, 68, 18, -Math.PI / 2, Math.PI / 2, false);

    const hole = new THREE.Path();
    hole.moveTo(-12, 48);
    hole.lineTo(12, 48);
    hole.lineTo(12, -48);
    hole.lineTo(-12, -48);
    hole.closePath();
    builder.shape.holes.push(hole);
    return { shape: builder.shape, steps: builder.steps };
  }

  const builder = createShapeBuilder();
  builder.moveTo(0, -82);
  builder.bezierCurveTo(72, -128, 142, -28, 0, 106);
  builder.bezierCurveTo(-142, -28, -72, -128, 0, -82);
  return { shape: builder.shape, steps: builder.steps };
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

function disposeGroup(group: THREE.Group | null) {
  if (!group) return;
  group.parent?.remove(group);
  group.traverse((object) => {
    if (object instanceof THREE.Line) {
      object.geometry.dispose();
      (object.material as THREE.Material).dispose();
    }

    if (object instanceof THREE.Sprite) {
      object.material.map?.dispose();
      object.material.dispose();
    }
  });
}

function createStepLabelSprite(index: number, color: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#0f172a";
  context.beginPath();
  context.arc(48, 48, 30, 0, Math.PI * 2);
  context.fill();

  context.lineWidth = 8;
  context.strokeStyle = `#${new THREE.Color(color).getHexString()}`;
  context.stroke();

  context.fillStyle = "#f8fafc";
  context.font = "bold 34px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(String(index), 48, 50);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(18, 18, 1);
  sprite.renderOrder = 10;
  return sprite;
}

function rebuildShape() {
  if (!three) return;

  disposeMesh(shapeMesh);
  disposeGroup(outlineGroup);
  disposeLine(holeLine);
  shapeMesh = null;
  outlineGroup = null;
  holeLine = null;

  const { shape, steps } = createShape(shapeKey.value);
  const geometry = new THREE.ShapeGeometry(shape, curveSegments.value);
  const material = new THREE.MeshStandardMaterial({
    color: 0xfde68a,
    emissive: 0x332701,
    roughness: 0.46,
    metalness: 0.04,
    side: THREE.DoubleSide,
    wireframe: wireframe.value,
  });
  shapeMesh = new THREE.Mesh(geometry, material);
  shapeMesh.position.set(70, 0, 0);
  three.scene.add(shapeMesh);

  if (showOutline.value) {
    outlineGroup = new THREE.Group();
    outlineGroup.position.x = -170;

    for (const step of steps) {
      const segmentLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(
          step.points.map((point) => new THREE.Vector3(point.x, point.y, 0)),
        ),
        new THREE.LineBasicMaterial({ color: step.color }),
      );
      outlineGroup.add(segmentLine);

      const middlePoint = step.points[Math.floor(step.points.length / 2)];
      const label = createStepLabelSprite(step.index, step.color);
      if (label) {
        label.position.set(middlePoint.x, middlePoint.y, 0);
        outlineGroup.add(label);
      }
    }

    three.scene.add(outlineGroup);

    if (shape.holes[0]) {
      const holePoints = shape.holes[0]
        .getPoints(90)
        .map((point) => new THREE.Vector3(point.x - 170, point.y, 0));
      holeLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(holePoints),
        new THREE.LineBasicMaterial({ color: 0xfb7185 }),
      );
      three.scene.add(holeLine);
    }
  }
}

function startAnimation() {
  const tick = () => {
    animationId = requestAnimationFrame(tick);
    if (shapeMesh && rotateMesh.value) {
      shapeMesh.rotation.y += 0.01;
    }
  };
  tick();
}

onMounted(() => {
  three = createThreeBase(canvasRef.value!);
  const { scene, camera, orbit } = three;

  camera.position.set(280, 160, 340);
  orbit.target.set(50, 0, 0);
  scene.background = new THREE.Color(0x111827);

  scene.add(new THREE.AmbientLight(0xffffff, 1.7));

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
  keyLight.position.set(160, 220, 200);
  scene.add(keyLight);

  const fillLight = new THREE.PointLight(0x7dd3fc, 70, 700);
  fillLight.position.set(-150, 100, 160);
  scene.add(fillLight);

  const grid = new THREE.GridHelper(420, 12, 0x334155, 0x1f2937);
  grid.rotation.x = Math.PI / 2;
  grid.position.set(70, -130, 0);
  scene.add(grid);

  rebuildShape();
  startAnimation();
  three.start();
});

watch([shapeKey, curveSegments, wireframe, showOutline], () => {
  rebuildShape();
});

onBeforeUnmount(() => {
  cancelAnimationFrame(animationId);
  disposeMesh(shapeMesh);
  disposeGroup(outlineGroup);
  disposeLine(holeLine);
  shapeMesh = null;
  outlineGroup = null;
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
        <button @click="shapeKey = 'heart'">爱心</button>
        <button @click="shapeKey = 'badge'" style="margin-left: 6px">
          徽章
        </button>
        <button @click="shapeKey = 'ticket'" style="margin-left: 6px">
          票券
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
          <input v-model="showOutline" type="checkbox" />
          <span>显示轮廓</span>
        </label>
        <label
          style="
            margin-left: 12px;
            display: inline-flex;
            align-items: center;
            gap: 8px;
          "
        >
          <input v-model="rotateMesh" type="checkbox" />
          <span>旋转观察</span>
        </label>
      </div>

      <div style="margin-bottom: 8px; line-height: 1.75">
        <span>曲线分段：{{ curveSegments }}</span>
        <input
          v-model.number="curveSegments"
          type="range"
          min="4"
          max="48"
          step="1"
          style="width: 280px; margin-left: 12px; vertical-align: middle"
        />
        <span style="margin-left: 12px; opacity: 0.82"
          >左边 2D 轮廓已按步骤拆色并编号，右边是填充后的 ShapeGeometry</span
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
          ShapeGeometry 是什么？
        </div>
        <div>把一个二维闭合轮廓直接填充成面，生成平面的几何体。</div>
        <div>
          适合做图标、徽章、面片、UI 装饰图形，也常常作为挤出
          <code>ExtrudeGeometry</code> 的前一步。
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
          几何体：<code>new THREE.ShapeGeometry(shape, curveSegments)</code>
        </div>
        <div>当前分段：{{ curveSegments }}</div>
        <div>
          辅助阅读：左侧每一段命令都会显示成独立颜色，并在段中间标出序号。
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
        <div style="font-weight: 700; margin-bottom: 10px">步骤对照</div>
        <div
          v-for="step in shapeSteps"
          :key="step.index"
          style="
            display: flex;
            gap: 10px;
            align-items: flex-start;
            margin-bottom: 6px;
          "
        >
          <span
            :style="{
              width: '24px',
              height: '24px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '999px',
              color: '#0f172a',
              background: `#${new THREE.Color(step.color).getHexString()}`,
              fontWeight: '700',
              flexShrink: '0',
            }"
          >
            {{ step.index }}
          </span>
          <code style="word-break: break-all">shape.{{ step.command }}</code>
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
        <div style="font-weight: 700; margin-bottom: 10px">关键点</div>
        <div>
          <code>THREE.Shape</code> 表示外轮廓，<code>shape.holes</code>
          可以加入内部镂空。
        </div>
        <div>轮廓必须闭合，填充后得到的是“面”，不是立体厚度。</div>
        <div>
          如果想从平面进一步变成立体，通常继续用 <code>ExtrudeGeometry</code>。
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
const shape = new THREE.Shape()
shape.moveTo(0, 0)
shape.lineTo(80, 0)
shape.lineTo(80, 60)
shape.lineTo(0, 60)
shape.closePath()

const geometry = new THREE.ShapeGeometry(shape)</pre
        >
      </div>
    </div>
  </div>
</template>
