项目代号：AtmosphereFX
1. 项目概述
开发一个纯静态网页工具，允许用户导入FBX模型，在三维场景中添加实时视觉特效（尘埃粒子、写实烟雾、丁达尔光束），并通过视频背景、摄像机切换等功能辅助预览。最终支持将渲染结果导出为高质量视频。

核心约束：

不依赖任何前端框架（React/Vue等），纯原生JavaScript + Three.js

所有代码采用ES模块，通过Import Map从CDN加载依赖

优先使用WebGPU渲染器，不支持时自动降级WebGL

采用模块化文件架构，禁止将所有代码写在一个HTML文件中

需要考虑未来可能接入Babylon.js或其他引擎（通过双Canvas叠加实现）

2. 技术栈与关键依赖
依赖    版本    用途
Three.js    0.168.0    核心3D引擎（WebGPU优先，自动降级WebGL）
postprocessing    6.34.0    后处理管线（EffectComposer、RenderPass）
three-good-godrays    0.29.0    屏幕空间丁达尔光束（GodraysPass）
通过 Import Map 声明：

json
{
  "imports": {
    "three": "https://unpkg.com/three@0.168.0/build/three.module.js",
    "three/addons/": "https://unpkg.com/three@0.168.0/examples/jsm/",
    "postprocessing": "https://esm.sh/postprocessing@6.34.0",
    "three-good-godrays": "https://esm.sh/three-good-godrays@0.29.0"
  }
}
3. 项目文件架构
text
project-root/
├── index.html                  # 入口：HTML布局、所有UI控件的DOM结构
├── css/
│   └── style.css               # 全部样式：面板、按钮、状态栏、视频背景层
├── js/
│   ├── main.js                 # 核心调度：初始化渲染器/场景/相机/动画循环
│   ├── SceneManager.js         # 场景管理：物体增删、灯光管理、背景控制
│   ├── FBXHandler.js           # FBX加载、摄像机提取、动画信息解析
│   ├── OrbitController.js      # 鼠标/键盘交互（封装OrbitControls）
│   ├── ParticleSystem.js       # WebGL尘埃粒子（自定义ShaderMaterial）
│   ├── NativeSmoke.js          # 写实烟雾（从react-smoke剥离的粒子系统）
│   ├── GodRaysEffect.js        # 丁达尔光束管理（遮光片 + GodraysPass）
│   ├── VideoExporter.js        # 视频导出（MediaRecorder + CCapture.js双模式）
│   └── UIHandler.js            # UI事件绑定、面板参数与特效模块的桥梁
├── assets/
│   ├── textures/
│   │   └── smoke-default.png   # 烟雾粒子纹理（从react-smoke仓库获取）
│   └── masks/                  # 可选：自定义光束遮罩
└── libs/                       # 可选：本地存放第三方库（生产环境用）
4. 各模块职责与技术规格
4.1 main.js — 核心调度
创建渲染器：优先 WebGPURenderer({alpha: true, antialias: true})，catch后降级 WebGLRenderer({alpha: true})

设置 setClearColor(0x000000, 0) 确保透明背景

创建主场景、主相机（PerspectiveCamera）、场景网格辅助线

初始化所有子模块实例，传入必要引用（renderer, scene, camera）

实现 animate() 循环：计算deltaTime → 更新OrbitController → 更新ParticleSystem → 更新NativeSmoke → 渲染场景

创建一个 THREE.Clock 用于精确deltaTime计算

4.2 SceneManager.js — 场景管理
维护一个 lightsGroup（Group）用于统一管理用户添加的灯光

提供方法：addPointLight(), addDirectionalLight(), addCube(), addSphere()

管理视频背景：通过操作 <video> 元素的 display 属性实现开关

持有对场景中所有动态添加对象的引用，方便清理

4.3 FBXHandler.js — FBX处理
使用 FBXLoader 加载用户选择的 .fbx 文件

加载完成后遍历模型，提取所有 PerspectiveCamera 和 OrthographicCamera

将提取的摄像机列表传递给 UIHandler 用于显示可点击列表

提供 switchToCamera(index) 方法，将OrbitControls的目标跳转到指定摄像机视角

在加载过程中更新顶部状态栏信息

4.4 OrbitController.js — 视图控制
封装 OrbitControls，绑定 enableDamping = true

提供 setTarget(target) 和 setFromCamera(camera) 方法

支持右键平移、滚轮缩放、左键旋转（与三维软件一致）

4.5 ParticleSystem.js — 尘埃粒子
使用 THREE.Points + 自定义 ShaderMaterial

顶点着色器：实现点精灵大小随距离缩放

片元着色器：圆形遮罩、根据深度（vDepth）调整透明度实现远处淡出

使用 AdditiveBlending、depthWrite: false、transparent: true

暴露参数：数量(100-5000)、大小(0.05-1.0)、颜色、速度(0.1-2.0)、分布范围(5-50)

update(deltaTime)：驱动粒子在边界内运动，越界时反向

所有参数可通过 setParams({count, size, color, speed, range}) 动态调整，内部重建geometry和material

4.6 NativeSmoke.js — 写实烟雾
从 react-smoke 库提取核心逻辑，重写为原生Three.js类

使用 PlaneGeometry + MeshLambertMaterial + 烟雾纹理贴图

每个烟雾粒子是一个独立的 THREE.Mesh，存储在数组中

构造函数接收 scene 引用，加载纹理后调用 initParticles()

update(deltaTime)：遍历所有粒子，更新位置、应用边界检查和速度限制

暴露可调参数：密度(粒子数量)、不透明度、颜色、风力方向/强度、湍流强度

提供 dispose() 方法清理所有粒子和材质

4.7 GodRaysEffect.js — 丁达尔光束
创建 EffectComposer，添加 RenderPass 和 GodraysPass

创建一盏能投射阴影的 SpotLight 作为体积光光源

创建一个 PlaneGeometry + alphaMap（Canvas生成的黑白纹理）作为遮光片

确保遮光片 castShadow = true，场景中模型也启用阴影投射/接收

渲染器开启 shadowMap.enabled = true，使用 PCFSoftShadowMap

暴露参数：光束密度、最大密度、边缘强度、光线步进步数、光源颜色

注意：由于 postprocessing 库基于GLSL，WebGPU模式下需设置 forceWebGL: true 或自动降级

4.8 VideoExporter.js — 视频导出
模式一（快速预览）：使用 MediaRecorder API

startQuickCapture(fps)：通过 canvas.captureStream(fps) 创建流，初始化 MediaRecorder

stopQuickCapture()：停止录制，生成Blob并触发下载

文件格式：video/webm

模式二（高质量输出）：使用 CCapture.js

startHQCapture(fps)：初始化CCapture实例，设置固定帧率和格式

接管渲染循环，逐帧调用 capturer.capture(canvas)

stopHQCapture()：完成捕获，保存为图片序列（TAR格式）

提示用户需用ffmpeg等工具合成最终视频

暴露统一接口：startRecording(fps, mode) / stopRecording()

4.9 UIHandler.js — UI桥梁
在DOMContentLoaded后绑定所有按钮事件

摄像机列表更新：接收 FBXHandler 提供的摄像机数组，动态生成可点击的列表项

粒子参数面板：监听滑块变化，实时调用 ParticleSystem.setParams()

烟雾参数面板：监听滑块变化，实时调用 NativeSmoke 的属性更新

丁达尔光参数面板：监听滑块变化，实时更新 GodraysPass 的uniforms

视频导出按钮：调用 VideoExporter 的录制方法

背景开关按钮：调用 SceneManager 的视频背景开关方法

5. UI布局规格
采用深色半透明主题，所有面板使用 rgba(0,0,0,0.7) 背景 + 圆角边框。

布局结构：

顶部状态栏：position: absolute; top: 20px; left: 20px; 显示当前状态文字

左侧摄像机列表：position: absolute; top: 100px; left: 20px; 可折叠，点击切换视角

右上参数面板：position: absolute; top: 20px; right: 20px; 可折叠，包含三个子选项卡（粒子/烟雾/光束）

底部工具栏：position: absolute; bottom: 30px; left: 50%; transform: translateX(-50%); 使用flex布局，gap: 15px

视频背景层：<video> 元素，z-index: 0，object-fit: cover，默认隐藏

Canvas层：z-index: 1，背景透明

6. 关键兼容性处理
WebGPU/WebGL兼容：渲染器初始化时 try-catch，WebGPU不可用时自动降级WebGL

GLSL着色器兼容：由于 postprocessing（含GodraysPass）使用GLSL，在WebGPU模式下这些着色器会被忽略。解决方案：

阶段一：检测到WebGPU时，设置 forceWebGL: true 确保所有功能正常

阶段二（未来）：将核心GLSL用TSL Transpiler转译为TSL，实现真正的WebGPU/WebGL双后端

浏览器兼容：目标Chrome 116+、Edge 116+，Firefox需开启WebGPU flag

7. 未来扩展接口
预留 registerEngine(name, canvas, syncCallback) 方法，允许外部注入第二个渲染引擎（如Babylon.js）的Canvas，实现双Canvas叠加

粒子系统、烟雾系统均暴露 setParams() 统一接口，方便未来接入AI自动调参或预设系统

8. 执行优先级
优先级    任务    产出文件
P0    项目骨架搭建    index.html, css/style.css, js/main.js, js/SceneManager.js
P1    FBX导入 + 摄像机控制    js/FBXHandler.js, js/OrbitController.js
P2    尘埃粒子效果    js/ParticleSystem.js
P3    写实烟雾效果    js/NativeSmoke.js（需 smoke-default.png）
P4    丁达尔光束    js/GodRaysEffect.js
P5    视频导出    js/VideoExporter.js
P6    UI面板绑定    js/UIHandler.js
P7    视频背景功能    集成到 SceneManager.js
请AI Agent按照以上规格，从P0开始逐模块生成完整的、可直接运行的JavaScript代码。每个模块需包含必要的导入语句、类定义、导出语句，并在代码注释中标明与哪些其他模块存在依赖关系。
