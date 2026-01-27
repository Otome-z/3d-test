<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import * as THREE from 'three'
import { createThreeBase } from '@/composables/useThreeBase'

const canvasRef = ref<HTMLCanvasElement | null>(null)

let three: ReturnType<typeof createThreeBase> | null = null

function check(mesh: any) {
    const geometry = mesh.geometry;

    // 输出索引（index）
    console.log(geometry.index);  // 查看索引数组

    if (geometry.index) {
        const indices = geometry.index.array;
        if (indices.length % 3 === 0) {
            console.log('这个网格是三角形网格');
        } else if (indices.length % 4 === 0) {
            console.log('这个网格是四边形网格');
        } else {
            console.log('这个网格的面不是三角形也不是四边形');
        }
    } else {
        console.log('这个网格没有索引，可能是直接由顶点构成的');
    }
}

function createSimpleQuad() {
    const { scene, camera, getRect, orbit, start } = three!
    const box = new THREE.BoxGeometry(50, 50, 50);
    const mesh = new THREE.Mesh(box);
    mesh.position.set(0, 0, 0);
    scene.add(mesh);
    start()

    check(mesh);
}
function createQuad1() {
    const { scene, camera, getRect, orbit, start } = three!;  // 获取基础的 three 配置

    // 创建四边形网格（正方体）
    const geometry = new THREE.BufferGeometry();

    // 四个顶点定义一个正方体的六个面
    const vertices = new Float32Array([
        // 前面
        -1.0, 1.0, 1.0,  // A
        1.0, 1.0, 1.0,  // B
        1.0, -1.0, 1.0, // C
        -1.0, -1.0, 1.0, // D

        // 后面
        -1.0, 1.0, -1.0, // E
        1.0, 1.0, -1.0, // F
        1.0, -1.0, -1.0, // G
        -1.0, -1.0, -1.0, // H

        // 左面
        -1.0, 1.0, 1.0,  // A
        -1.0, 1.0, -1.0, // E
        -1.0, -1.0, -1.0, // H
        -1.0, -1.0, 1.0,  // D

        // 右面
        1.0, 1.0, 1.0,   // B
        1.0, 1.0, -1.0,  // F
        1.0, -1.0, -1.0, // G
        1.0, -1.0, 1.0,  // C

        // 上面
        -1.0, 1.0, 1.0,  // A
        1.0, 1.0, 1.0,   // B
        1.0, 1.0, -1.0,  // F
        -1.0, 1.0, -1.0,  // E

        // 下面
        -1.0, -1.0, 1.0, // D
        1.0, -1.0, 1.0,  // C
        1.0, -1.0, -1.0, // G
        -1.0, -1.0, -1.0  // H
    ]);

    // 使用两个三角形来表示四边形面
    const indices = new Uint16Array([
        0, 1, 2, 0, 2, 3,    // 前面
        4, 5, 6, 4, 6, 7,    // 后面
        8, 9, 10, 8, 10, 11,  // 左面
        12, 13, 14, 12, 14, 15, // 右面
        16, 17, 18, 16, 18, 19, // 上面
        20, 21, 22, 20, 22, 23  // 下面
    ]);

    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    // 使用 MeshStandardMaterial 以便受光照影响，确保可见
    const material = new THREE.MeshStandardMaterial({ color: 0x00ff00, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);

    // 将四边形网格放置在合适的位置
    mesh.position.set(0, 0, 0);
    scene.add(mesh);

    // 添加一个环境光源，确保物体有足够的光照
    const light = new THREE.AmbientLight(0x404040, 1);  // 环境光
    scene.add(light);

    // 调整相机位置，让正方体网格能出现在视野内
    camera.position.set(5, 5, 5); // 相机位置
    camera.lookAt(0, 0, 0); // 相机注视四边形网格

    // 启动渲染循环
    start();
    check(mesh)
}


function createQuad2() {
    const { scene, camera, getRect, orbit, start } = three!
    const geometry = new THREE.BufferGeometry();

    // 定义四个顶点
    const vertices = new Float32Array([
        -1.0, 1.0, 0.0, // A
        1.0, 1.0, 0.0, // B
        1.0, -1.0, 0.0, // C
        -1.0, -1.0, 0.0  // D
    ]);

    // 为四边形网格创建两个三角形的索引
    const indices = new Uint16Array([
        0, 1, 2, // 第一个三角形 (A-B-C)
        0, 2, 3  // 第二个三角形 (A-C-D)
    ]);

    // 设置顶点和索引
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    // 创建一个网格材质并应用
    const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
}

onMounted(() => {
    const canvas = canvasRef.value!
    three = createThreeBase(canvas)
})


onBeforeUnmount(() => {
    three?.dispose()
    three = null
})
</script>

<template>
    <div style="width: 800px;">
        <div style="margin-bottom: 8px;">
            <button @click="createSimpleQuad">三角形</button>
            <button @click="createQuad1">四边形1</button>
            <button @click="createQuad2">四边形2</button>
        </div>
        <canvas ref="canvasRef" style="width: 800px; height: 800px;" />
    </div>
</template>
