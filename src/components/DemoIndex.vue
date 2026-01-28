<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue'

/**
 * Demo Key 列表：左侧菜单显示用
 * 你可以继续往这里加更多 demo
 */
type DemoKey = 'transform' | 'grid' | 'selectOnly' | 'boxSelect' | 'vertex' | 'cut' | 'dif' | 'DemoEditableMesh' | 'DemoLight'

const demos: Array<{ key: DemoKey; title: string; desc: string }> = [
    {
        key: 'transform',
        title: '平移/旋转/缩放',
        desc: ''
    },
    {
        key: 'DemoLight',
        title: '灯光/颜色',
        desc: ''
    },
    {
        key: 'grid',
        title: '格子测试',
        desc: ''
    },
    {
        key: 'dif',
        title: '细分区别',
        desc: ''
    },
    {
        key: 'DemoEditableMesh',
        title: '数据结构',
        desc: ''
    },
    {
        key: 'selectOnly',
        title: '单选/多选',
        desc: 'TransformControls + Ctrl 多选 + 多选中心 gizmo'
    },
    {
        key: 'boxSelect',
        title: '框选（矩形选择）',
        desc: '拖拽矩形框选（屏幕投影粗选版本）'
    },
    {
        key: 'vertex',
        title: '点模式（拖顶点）',
        desc: 'Points overlay + 顶点拾取 + 写回 position'
    },
    {
        key: 'cut',
        title: 'Cut（翻对角线）',
        desc: '点两次吸附顶点 → turn edge（改 index）'
    }
]

/** 当前选中的 demo */
const current = ref<DemoKey>('vertex')

/**
 * 动态加载组件（避免一次性加载全部，页面也更清爽）
 * 注意：Vite 下这种写法是 OK 的
 */
const DemoComponent = computed(() => {
    switch (current.value) {
        case 'transform':
            return defineAsyncComponent(() => import('../demos/DemoOnlyTransform.vue'))
        case 'selectOnly':
            return defineAsyncComponent(() => import('../demos/DemoSelectOnly.vue'))
        case 'boxSelect':
            return defineAsyncComponent(() => import('../demos/DemoBoxSelect.vue'))
        case 'vertex':
            return defineAsyncComponent(() => import('../demos/DemoVertexMode.vue'))
        case 'cut':
            return defineAsyncComponent(() => import('../demos/DemoCutMode.vue'))
        case 'grid':
            return defineAsyncComponent(() => import('../demos/DemoQuadGrid.vue'))
        case 'dif':
            return defineAsyncComponent(() => import('../demos/DemoGridDiffent.vue'))
        case 'DemoEditableMesh':
            return defineAsyncComponent(() => import('../demos/DemoEditableMesh.vue'))
        case 'DemoLight':
            return defineAsyncComponent(() => import('../demos/DemoLight.vue'))
        default:
            return defineAsyncComponent(() => import('../demos/DemoTransform.vue'))
    }
})

const currentMeta = computed(() => demos.find(d => d.key === current.value)!)
</script>

<template>
    <div style="display:flex; height: calc(100vh - 20px); gap: 12px; padding: 10px; box-sizing: border-box;">
        <!-- 左侧菜单 -->
        <aside style="
        width: 320px;
        border: 1px solid #2a2a2a;
        border-radius: 10px;
        padding: 10px;
        box-sizing: border-box;
        overflow: auto;
      ">
            <div style="font-weight: 700; margin-bottom: 10px;">Three 编辑器 Demos</div>

            <div v-for="d in demos" :key="d.key" @click="current = d.key" style="
          padding: 10px;
          border-radius: 8px;
          margin-bottom: 8px;
          cursor: pointer;
          user-select: none;
          border: 1px solid transparent;
        " :style="current === d.key
            ? 'border-color:#00ffff; background: rgba(0,255,255,0.08);'
            : 'border-color: rgba(255,255,255,0.08); background: rgba(255,255,255,0.02);'">
                <div style="font-weight: 600;">{{ d.title }}</div>
                <div style="opacity: 0.75; font-size: 12px; margin-top: 4px;">{{ d.desc }}</div>
            </div>

            <div style="margin-top: 12px; font-size: 12px; opacity: 0.75; line-height: 1.5;">
                <div>提示：</div>
                <div>• 每个 demo 都是独立最小实现，便于你逐个消化。</div>
                <div>• 如果切换 demo 时出现 gizmo 状态残留，一般是 demo 自己的清理没做完（onBeforeUnmount）。</div>
            </div>
        </aside>

        <!-- 右侧内容 -->
        <main style="
        flex: 1;
        border: 1px solid #2a2a2a;
        border-radius: 10px;
        padding: 10px;
        box-sizing: border-box;
        overflow: auto;
      ">
            <div
                style="display:flex; align-items:flex-end; justify-content: space-between; gap: 10px; margin-bottom: 10px;">
                <div>
                    <div style="font-size: 18px; font-weight: 700;">{{ currentMeta.title }}</div>
                    <div style="opacity: 0.75; font-size: 12px; margin-top: 4px;">{{ currentMeta.desc }}</div>
                </div>

                <div style="opacity: 0.75; font-size: 12px;">
                    当前：<b>{{ current }}</b>
                </div>
            </div>

            <!-- 动态组件 -->
            <Suspense>
                <template #default>
                    <component :is="DemoComponent" />
                </template>
                <template #fallback>
                    <div style="padding: 20px;">Loading demo...</div>
                </template>
            </Suspense>
        </main>
    </div>
</template>
