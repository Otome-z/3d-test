<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue'

type DemoKey =
  | 'coords'
  | 'vectors'
  | 'curves'
  | 'lathe'
  | 'shape'
  | 'extrude'
  | 'meshSprite'
  | 'spriteRain'
  | 'topologyOps'
  | 'transform'
  | 'mirror'
  | 'dirtyFlags'
  | 'light2'
  | 'grid'
  | 'selectOnly'
  | 'boxSelect'
  | 'vertex'
  | 'cut'
  | 'dif'
  | 'DemoEditableMesh'
  | 'DemoLight'
  | 'customTest'

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
    key: 'curves',
    title: '曲线 Curve',
    desc: '2D / 3D 曲线、选项卡切换、双曲线对比、控制点编辑'
  },
  {
    key: 'lathe',
    title: 'LatheGeometry',
    desc: '用 2D 轮廓绕 Y 轴旋转，生成旋转成型几何体'
  },
  {
    key: 'shape',
    title: 'ShapeGeometry',
    desc: '用二维闭合轮廓直接填充成面，可包含 holes 镂空'
  },
  {
    key: 'extrude',
    title: 'ExtrudeGeometry',
    desc: '把二维轮廓挤出厚度，生成有体积的立体几何'
  },
  {
    key: 'meshSprite',
    title: 'Mesh vs Sprite',
    desc: 'Plane Mesh 与 Sprite 的朝向和用途对比'
  },
  {
    key: 'spriteRain',
    title: 'Sprite Rain',
    desc: '使用精灵贴图批量模拟下雨效果'
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
    key: 'mirror',
    title: '镜像',
    desc: 'mirror preview + apply mirror edit'
  },
  {
    key: 'dirtyFlags',
    title: '脏标记 / Buffer',
    desc: 'dirtyVertexIds / topologyDirty / flush / indexed geometry'
  },
  {
    key: 'DemoLight',
    title: '灯光 / 颜色',
    desc: ''
  },
  {
    key: 'light2',
    title: '光源 / 材质对比',
    desc: 'AmbientLight / DirectionalLight / PointLight / PointLightHelper'
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
    key: 'customTest',
    title: '自定义测试',
    desc: '自定义测试'
  }
]

const current = ref<DemoKey>('customTest')

const DemoComponent = computed(() => {
  switch (current.value) {
    case 'coords':
      return defineAsyncComponent(() => import('../demos/DemoCoordinateSpaces.vue'))
    case 'vectors':
      return defineAsyncComponent(() => import('../demos/DemoVectorMath.vue'))
    case 'curves':
      return defineAsyncComponent(() => import('../demos/DemoCurves.vue'))
    case 'lathe':
      return defineAsyncComponent(() => import('../demos/DemoLatheGeometry.vue'))
    case 'shape':
      return defineAsyncComponent(() => import('../demos/DemoShapeGeometry.vue'))
    case 'extrude':
      return defineAsyncComponent(() => import('../demos/DemoExtrudeGeometry.vue'))
    case 'meshSprite':
      return defineAsyncComponent(() => import('../demos/DemoMeshSpriteDiff.vue'))
    case 'spriteRain':
      return defineAsyncComponent(() => import('../demos/DemoSpriteRain.vue'))
    case 'topologyOps':
      return defineAsyncComponent(() => import('../demos/DemoDeleteMergeSplit.vue'))
    case 'transform':
      return defineAsyncComponent(() => import('../demos/DemoOnlyTransform.vue'))
    case 'mirror':
      return defineAsyncComponent(() => import('../demos/DemoMirrorMode.vue'))
    case 'dirtyFlags':
      return defineAsyncComponent(() => import('../demos/DemoDirtyFlags.vue'))
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
    case 'light2':
      return defineAsyncComponent(() => import('../demos/DemoLight2.vue'))
    case 'customTest':
      return defineAsyncComponent(() => import('../demos/DemoCustomTest.vue'))
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
        <div>基础专题建议按“坐标系 -> 向量 -> 曲线 -> 拓扑操作”的顺序看。</div>
        <div>如果你想理解底层更新逻辑，可以看“脏标记 / Buffer”。</div>
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
