<script setup lang="ts">
import { onMounted, ref } from 'vue'
import * as THREE from 'three'
import { createThreeBase } from '@/composables/useThreeBase'
import envHdr from '@/assets/equirectangular/blouberg_sunrise_2_1k.hdr'


const canvasRef = ref<HTMLCanvasElement | null>(null)

let three: ReturnType<typeof createThreeBase> | null = null

onMounted(() => {
    const canvas = canvasRef.value!
    three = createThreeBase(canvas)
    const { scene, camera, start, renderer } = three!


    const geo = new THREE.BoxGeometry(120, 120, 120)

    // ❌ 看不见
    const mat = new THREE.MeshStandardMaterial({
        color: 0xff0000,
        roughness: 0.3,
        metalness: 0.2
    })

    const cube1 = new THREE.Mesh(
        geo,
        mat
    )
    cube1.position.x = -200
    scene.add(cube1)

    // ✅ 永远可见
    const cube2 = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ color: 0x00ff00 })
    )
    cube2.position.x = 200
    scene.add(cube2)

    // // // 环境光：整体不死黑
    // const ambient = new THREE.AmbientLight(0xffffff, 0.4)
    // scene.add(ambient)

    // // // 平行光：模拟太阳 / 主光源
    // const dir = new THREE.DirectionalLight(0xffffff, 1)
    // dir.position.set(300, 500, 300)
    // dir.castShadow = true
    // scene.add(dir)

    cube1.castShadow = true
    cube1.receiveShadow = true
    renderer.shadowMap.enabled = true


    three.setEnvironment({
        enabled: true,
        hdrUrl: envHdr,
        background: true,   // 编辑器里一般 false

    })


    start();
})
</script>

<template>
    <div style="width: 800px;">
        <canvas ref="canvasRef" style="width: 800px; height: 800px;" />
    </div>
</template>
