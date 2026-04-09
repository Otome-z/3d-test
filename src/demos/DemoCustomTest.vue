<script lang="ts" setup>
import { ref, onMounted, onBeforeUnmount } from "vue";
import * as THREE from "three";
import { createThreeBase } from "@/composables/useThreeBase";

defineOptions({
  name: "DemoCustomTest",
});

const canvasRef = ref<HTMLCanvasElement | null>(null);
let three: ReturnType<typeof createThreeBase> | null = null;

onMounted(() => {
  const canvas = canvasRef.value!;
  three = createThreeBase(canvas);
  const { scene, start } = three;

  //   // p1、p3轨迹线起始点坐标
  //   const p1 = new THREE.Vector3(-100, 0, -100);
  //   const p3 = new THREE.Vector3(100, 0, 100);
  //   // 计算p1和p3的中点坐标
  //   const x2 = (p1.x + p3.x) / 2;
  //   const z2 = (p1.z + p3.z) / 2;
  //   const h = 50;
  //   const p2 = new THREE.Vector3(x2, h, z2);

  //   const arr = [p1, p2, p3];
  //   // 三维样条曲线
  //   const curve = new THREE.CatmullRomCurve3(arr);

  // const p1 = new THREE.Vector3(-100, 0, -100);
  // const p3 = new THREE.Vector3(100, 0, 100);
  // // 计算p1和p3的中点坐标
  // const x2 = (p1.x + p3.x)/2;
  // const z2 = (p1.z + p3.z)/2;
  // const h = 100;
  // const p2 = new THREE.Vector3(x2, h, z2);
  // // 三维二次贝赛尔曲线
  // const curve = new THREE.QuadraticBezierCurve3(p1, p2, p3);

  //   // 从曲线上取点
  //   const points = curve.getPoints(100);

  // const R = 80; //圆弧半径
  // const H = 200; //直线部分高度
  // // 直线1
  // const line1 = new THREE.LineCurve(
  //   new THREE.Vector2(R, H),
  //   new THREE.Vector2(R, 0),
  // );
  // // 圆弧
  // const arc = new THREE.ArcCurve(0, 0, R, 0, Math.PI, true);
  // // 直线2
  // const line2 = new THREE.LineCurve(
  //   new THREE.Vector2(-R, 0),
  //   new THREE.Vector2(-R, H),
  // );

  // // CurvePath创建一个组合曲线对象
  // const CurvePath = new THREE.CurvePath();
  // //line1, arc, line2拼接出来一个U型轮廓曲线，注意顺序
  // CurvePath.curves.push(line1, arc, line2);
  // const points = CurvePath.getPoints(16);

  // // 用这些点创建一条可渲染的线
  // const geometry = new THREE.BufferGeometry().setFromPoints(points);
  // const material = new THREE.LineBasicMaterial({ color: 0xff0000 });

  // const curveObject = new THREE.Line(geometry, material);
  // scene.add(curveObject);

  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-100, 0, -100),
    new THREE.Vector3(0, 50, 0),
    new THREE.Vector3(100, 0, 100),
  ]);

  const geometry = new THREE.TubeGeometry(
    curve,
    100, // 管子沿路径的分段数
    5, // 半径
    8, // 圆截面分段数
    false, // 是否闭合
  );

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial()
  );
  scene.add(mesh);

  start();
});
</script>

<template>
  <div style="position: relative; width: 800px; height: 800px">
    <canvas ref="canvasRef" style="width: 800px; height: 800px" />
  </div>
</template>

<style lang="scss" scoped></style>
