<script lang="ts" setup>
import { onBeforeUnmount, onMounted, ref } from "vue";
import * as THREE from "three";
import { createThreeBase } from "@/composables/useThreeBase";

defineOptions({
  name: "DemoCustomTest",
});

const canvasRef = ref<HTMLCanvasElement | null>(null);
let three: ReturnType<typeof createThreeBase> | null = null;
let inspectionGroup: THREE.Group | null = null;

function disposeObject(object: THREE.Object3D | null) {
  if (!object) return;
  object.parent?.remove(object);
  object.traverse((child) => {
    const geometry = (child as THREE.Mesh | THREE.LineSegments).geometry;
    geometry?.dispose?.();

    const material = (child as THREE.Mesh | THREE.LineSegments).material;
    if (Array.isArray(material)) {
      material.forEach((item) => item.dispose());
    } else {
      material?.dispose?.();
    }
  });
}

onMounted(() => {
  three = createThreeBase(canvasRef.value!);
  const { camera, orbit, renderer, scene, start } = three;

  scene.background = new THREE.Color(0x14181c);
  scene.children.forEach((child) => {
    if (child.type === "AxesHelper" || child.type === "GridHelper") {
      child.visible = false;
    }
  });

  camera.fov = 50;
  camera.position.set(130, 86, 150);
  camera.updateProjectionMatrix();
  orbit.target.set(0, 60, 0);
  orbit.minDistance = 90;
  orbit.maxDistance = 320;
  orbit.update();

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  inspectionGroup = new THREE.Group();

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.18);
  inspectionGroup.add(ambientLight);

  const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x6b5540, 0.55);
  inspectionGroup.add(hemiLight);

  const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
  keyLight.position.set(120, 180, 110);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.near = 1;
  keyLight.shadow.camera.far = 360;
  keyLight.shadow.camera.left = -140;
  keyLight.shadow.camera.right = 140;
  keyLight.shadow.camera.top = 160;
  keyLight.shadow.camera.bottom = -160;
  keyLight.shadow.bias = -0.0002;
  inspectionGroup.add(keyLight);

  const rimLight = new THREE.PointLight(0xa5d8ff, 28, 320, 2);
  rimLight.position.set(-100, 75, 95);
  inspectionGroup.add(rimLight);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(280, 280),
    new THREE.MeshStandardMaterial({
      color: 0xd4cec1,
      roughness: 0.96,
      metalness: 0.02,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  inspectionGroup.add(floor);

  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(280, 180),
    new THREE.MeshStandardMaterial({
      color: 0x2a3038,
      roughness: 0.98,
      metalness: 0.02,
    }),
  );
  backdrop.position.set(0, 60, -100);
  backdrop.receiveShadow = true;
  inspectionGroup.add(backdrop);

  const cylinder = new THREE.Mesh(
    new THREE.CylinderGeometry(40, 40, 120, 48),
    new THREE.MeshStandardMaterial({
      color: "#7a8e2c",
      roughness: 0.24,
      metalness: 0.04,
    }),
  );
  cylinder.position.set(0, 60, 0);
  cylinder.castShadow = true;
  cylinder.receiveShadow = true;
  inspectionGroup.add(cylinder);

  scene.add(inspectionGroup);
  start();
});

onBeforeUnmount(() => {
  disposeObject(inspectionGroup);
  inspectionGroup = null;

  three?.dispose();
  three = null;
});
</script>

<template>
  <div style="position: relative; width: 800px; height: 800px">
    <canvas ref="canvasRef" style="width: 800px; height: 800px" />
    <div
      style="
        position: absolute;
        left: 12px;
        top: 12px;
        padding: 8px 10px;
        border-radius: 8px;
        background: rgba(20, 24, 28, 0.82);
        color: #f5f5f4;
        font-size: 12px;
        line-height: 1.6;
        pointer-events: none;
      "
    >
      radius 40, diameter 80, length 120, radial segments 48
    </div>
  </div>
</template>

<style lang="scss" scoped></style>
