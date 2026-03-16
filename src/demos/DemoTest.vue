<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import * as THREE from 'three'
import { createThreeBase } from '@/composables/useThreeBase'
import { VertexNormalsHelper } from 'three/examples/jsm/helpers/VertexNormalsHelper.js'

const canvasRef = ref<HTMLCanvasElement | null>(null)

let three: ReturnType<typeof createThreeBase> | null = null
let cube: THREE.Mesh | null = null

onMounted(() => {
    three = createThreeBase(canvasRef.value!)
    const { scene } = three

    // 1) 只创建一个正方体
    const geo = new THREE.BoxGeometry(120, 120, 120)
    const mat = new THREE.MeshNormalMaterial({
        // DoubleSide：从物体内部看也能看到颜色（不被背面剔除）
        side: THREE.DoubleSide
    })

    cube = new THREE.Mesh(geo, mat)
    cube.position.set(0, 0, 0)
    scene.add(cube)

    // 显示法线
    const helper = new VertexNormalsHelper(cube, 10)
    scene.add(helper)

    // 3) 启动渲染循环
    three.start()
})

onBeforeUnmount(() => {
    three?.dispose()
    three = null

    // demo 简单释放
    if (cube) {
        ; (cube.geometry as THREE.BufferGeometry).dispose()
            ; (cube.material as THREE.Material).dispose?.()
        cube = null
    }
})
</script>

<template>
    <div style="width: 800px;">
        <div style="margin-bottom: 8px;">
            <span style="margin-left: 10px;">仅一个正方体</span>
        </div>

        <canvas ref="canvasRef" style="width: 800px; height: 800px;" />
    </div>
</template>
