<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue'

type DemoKey =
  | 'coords'
  | 'vectors'
  | 'topologyOps'
  | 'transform'
  | 'grid'
  | 'selectOnly'
  | 'boxSelect'
  | 'vertex'
  | 'cut'
  | 'dif'
  | 'DemoEditableMesh'
  | 'DemoLight'
  | 'DemoTest'

const demos: Array<{ key: DemoKey; title: string; desc: string }> = [
  {
    key: 'coords',
    title: '坐标系专题',
    desc: 'Local / World / Camera(View) / NDC / Screen'
  },
  {
    key: 'vectors',
    title: '向量 / 法线 / 平面',
    desc: 'dot / cross / normal / plane / 点到线段 / 点到平面'
  },
  {
    key: 'topologyOps',
    title: '删除 / 合并 / 拆分',
    desc: '删除顶点 / 删除面 / 合并顶点 / 边中插点 / 一个面拆两个面'
  },
  {
    key: 'transform',
    title: '平移 / 旋转 / 缩放',
    desc: ''
  },
  {
    key: 'DemoLight',
    title: '灯光 / 颜色',
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
    title: '单选 / 多选',
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
    desc: '点两次吸附顶点 -> turn edge（改 index）'
  },
  {
    key: 'DemoTest',
    title: '测试',
    desc: ''
  }
]

const current = ref<DemoKey>('topologyOps')

const DemoComponent = computed(() => {
  switch (current.value) {
    case 'coords':
      return defineAsyncComponent(() => import('../demos/DemoCoordinateSpaces.vue'))
    case 'vectors':
      return defineAsyncComponent(() => import('../demos/DemoVectorMath.vue'))
    case 'topologyOps':
      return defineAsyncComponent(() => import('../demos/DemoDeleteMergeSplit.vue'))
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
    case 'DemoTest':
      return defineAsyncComponent(() => import('../demos/DemoTest.vue'))
    default:
      return defineAsyncComponent(() => import('../demos/DemoTransform.vue'))
  }
})

const currentMeta = computed(() => demos.find(d => d.key === current.value)!)
</script>

<template>
  <div style="display:flex; height: calc(100vh - 20px); gap: 12px; padding: 10px; box-sizing: border-box;">
    <aside
      style="
        width: 320px;
        border: 1px solid #2a2a2a;
        border-radius: 10px;
        padding: 10px;
        box-sizing: border-box;
        overflow: auto;
      "
    >
      <div style="font-weight: 700; margin-bottom: 10px;">Three 编辑器 Demos</div>

      <div
        v-for="d in demos"
        :key="d.key"
        @click="current = d.key"
        style="
          padding: 10px;
          border-radius: 8px;
          margin-bottom: 8px;
          cursor: pointer;
          user-select: none;
          border: 1px solid transparent;
        "
        :style="
          current === d.key
            ? 'border-color:#00ffff; background: rgba(0,255,255,0.08);'
            : 'border-color: rgba(255,255,255,0.08); background: rgba(255,255,255,0.02);'
        "
      >
        <div style="font-weight: 600;">{{ d.title }}</div>
        <div style="opacity: 0.75; font-size: 12px; margin-top: 4px;">{{ d.desc }}</div>
      </div>

      <div style="margin-top: 12px; font-size: 12px; opacity: 0.75; line-height: 1.5;">
        <div>提示：</div>
        <div>基础专题建议按“坐标系 -> 向量 -> 拓扑操作”的顺序看。</div>
        <div>每个 demo 都尽量是独立最小实现，方便你逐个拆开理解。</div>
      </div>
    </aside>

    <main
      style="
        flex: 1;
        border: 1px solid #2a2a2a;
        border-radius: 10px;
        padding: 10px;
        box-sizing: border-box;
        overflow: auto;
      "
    >
      <div
        style="display:flex; align-items:flex-end; justify-content: space-between; gap: 10px; margin-bottom: 10px;"
      >
        <div>
          <div style="font-size: 18px; font-weight: 700;">{{ currentMeta.title }}</div>
          <div style="opacity: 0.75; font-size: 12px; margin-top: 4px;">{{ currentMeta.desc }}</div>
        </div>

        <div style="opacity: 0.75; font-size: 12px;">
          当前：<b>{{ current }}</b>
        </div>
      </div>

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
