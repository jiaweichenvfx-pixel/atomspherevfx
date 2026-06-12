好的，这是一份针对 AtmosphereFX 项目的难点分析与 Bug 预警报告。基于你确定的模块化原生 Three.js 方案，我梳理了从集成到性能最容易出问题的环节，并给出具体表现、原因和规避建议。

一、集成联调类 Bug（最高发）
难点 / Bug    具体表现    原因    预警与规避
后处理管线与透明背景冲突    Canvas 背景不再透明，变成全黑或出现闪屏。    EffectComposer 默认输出不透明帧缓冲，会覆盖掉 renderer 的 alpha 设置。    1. 创建 EffectComposer 时显式指定 { frameBufferType: THREE.HalfFloatType } 并确保输出纹理支持 alpha。
2. 在 GodraysPass 之后可能需要一个额外的 ShaderPass 来恢复 alpha 通道，或直接录制不带视频背景的 Canvas。
GodRays + WebGPU 模式冲突    控制台报错 "WGSL compilation error" 或光束不显示。    three-good-godrays 和 postprocessing 内部使用 GLSL 编写，WebGPURenderer 无法解析。    在 main.js 初始化时，检测到 WebGPURenderer 可用但需要后处理时，强制设置 forceWebGL: true。这是当前阶段最稳妥的解法，TSL 迁移是后话。
多模块共享同一个 scene 和 renderer 导致状态污染    粒子系统或烟雾模块意外修改了全局渲染状态（如混合模式、深度写入），导致模型渲染异常。    各模块在渲染时直接操作了 renderer 的全局状态，或 ShaderMaterial 没有正确隔离。    1. 所有自定义 ShaderMaterial 必须显式设置 depthWrite、blending、transparent。
2. 粒子/烟雾的 update 方法只做数据更新，不要在里面调用 renderer.render()，统一由 main.js 的 animate() 完成渲染。
CCapture.js 接管渲染循环后交互冻结    导出时页面卡死，无法取消或查看进度。    CCapture.js 会同步阻塞 requestAnimationFrame 来逐帧捕获，期间浏览器无法处理 UI 事件。    必须使用 Web Worker 或 requestAnimationFrame 中的异步标记来隔帧捕获，留出喘息时间处理 UI。如果做不到，至少要在开始捕获前禁用所有按钮并显示“正在渲染，请勿操作”的蒙层。
二、WebGPU / WebGL 兼容与降级（隐性高发）
难点 / Bug    具体表现    原因    预警与规避
纹理格式不兼容    WebGPU 下烟雾纹理显示为黑色或报 INVALID_TEXTURE_FORMAT。    透明纹理的编码格式（如 sRGB vs Linear）在 WebGPU 中要求更严格。    所有纹理加载后，统一设置 texture.colorSpace = THREE.SRGBColorSpace（颜色贴图）或 LinearSRGBColorSpace（数据贴图），不要使用默认值。
计算着色器粒子（如果未来启用）在 Firefox 或特定显卡上崩溃    浏览器直接崩溃或返回 GPUDeviceLost。    WebGPU 的实现在不同浏览器和驱动间差异很大，尤其是 Compute Shader。    1. 始终在 adapter 请求时设置 powerPreference: 'high-performance'。
2. 使用 device.onuncapturederror 捕获全局错误并降级到 WebGL。
forceWebGL 后渲染性能骤降    回到 WebGL 后，烟雾帧率从 60fps 掉到 20fps。    烟雾逻辑仍按 WebGPU 的并行度设计，在 WebGL 下 CPU 瓶颈暴露。    1. 提供烟雾“低配模式”：当检测到 WebGL 时，自动减少烟雾粒子数、限制丁达尔光束的步进步数。
2. 在 UIHandler 中显示当前渲染后端和性能建议。
三、粒子与烟雾系统的性能陷阱
难点 / Bug    具体表现    原因    预警与规避
每帧更新数十万粒子导致主线程阻塞    烟雾/粒子全开时，浏览器卡顿甚至无响应。    粒子位置更新全部在 JavaScript 中循环计算，CPU 瓶颈。    1. 粒子更新 for 循环中避免创建新对象（使用临时 Vector3 复用）。
2. 烟雾模块的 PlaneGeometry 必须共享（只创建一次），避免每粒子创建新几何体。
3. 引入 LOD（细节层次）：距离相机远的粒子减少更新频率或直接隐藏。
NativeSmoke 的 PlaneGeometry 始终面对相机    烟雾没有体积感，像纸片。    PlaneGeometry 本身不自动面朝相机，需要手动设置朝向。    每个烟雾粒子在 update 中调用 mesh.lookAt(camera.position)（或使用 Sprite 替代 Mesh），否则烟雾会穿帮。
深度排序错误导致粒子/烟雾穿透模型    粒子或烟雾块在某些角度错误地遮挡了模型，或自身出现闪烁。    透明物体渲染顺序依赖深度写入，但我们的粒子禁用了深度写入。    1. 将烟雾和粒子的 renderOrder 设置为较大的值，并确保 depthWrite: false。
2. 如果仍存在问题，需要将透明物体单独分组，在渲染循环中按距离排序后绘制（但性能开销大，建议先观察）。
四、FBX 解析与摄像机适配（容易出现奇怪表现）
难点 / Bug    具体表现    原因    预警与规避
FBX 内嵌摄像机切换后视角异常    切换到 FBX 摄像机后，OrbitControls 的 target 跳到极远处，或者模型不可见。    FBX 中的摄像机可能有缩放、父级变换、非标准 FOV 或正交投影。    切换摄像机时，必须将 camera 的 matrix 和 projectionMatrix 完全复制，并重置 controls.target 为摄像机 lookAt 方向上的一个点。需要编写一个健壮的 copyCamera() 函数，处理正交相机情况。
灯光提取后强度单位不一致    FBX 中的灯光在新场景中过亮或过暗。    不同 DCC 工具的灯光强度单位（如流明 vs 坎德拉）映射到 Three.js 无统一标准。    提供一个“灯光强度缩放”全局系数滑块，允许用户手动调整；提取的灯光强度统一乘以一个可配置系数（默认 1.0）。
模型材质丢失或全黑    导入 FBX 后模型没有纹理或全黑。    FBX 的材质路径依赖外部贴图文件，网页无法访问本地路径。    1. 加载 FBX 后，检测所有 MeshStandardMaterial 的 map 是否为 null，并自动设置为中灰色度材质。
2. 在 UI 中提示用户“缺失纹理已用灰色材质替代，可手动替换贴图”。
五、视频导出与 Alpha 通道（最容易返工的部分）
难点 / Bug    具体表现    原因    预警与规避
MediaRecorder 录制的视频不带透明通道    导出视频背景是黑的，无法叠加到其他素材上。    WebM/MP4 容器默认不支持 alpha 通道，且 Canvas 的 alpha: true 在录制时会被忽略。    如果必须带透明通道，必须使用 CCapture.js 输出 PNG 序列，或使用支持 HEVC Alpha 的特定 mimeType（如 video/webm; codecs=vp9 但兼容性极差）。
建议：在文档中说明，透明通道仅支持图片序列导出。
CCapture.js 输出帧率与预期不符    导出的视频播放速度不对，像是快进或慢放。    CCapture 捕获间隔与 setTimeout 或 requestAnimationFrame 的配合出现累计误差。    在动画循环中，通过 clock.getDelta() 累计时间，当累计时间超过 1/fps 时才捕获一帧并重置累计时间，绝对不要依赖 rAF 的调用次数。
导出分辨率过高导致浏览器崩溃    选择 4K 导出后，页面直接崩溃。    单个 Canvas 的像素缓冲区超出浏览器内存限制。    限制最大导出分辨率为当前 Canvas 尺寸的 2 倍，并在导出前检查 width * height * 4 是否超过 256MB。超过时弹出警告并建议降低分辨率。
六、UI 状态同步与内存泄漏（容易被忽略的慢性病）
难点 / Bug    具体表现    原因    预警与规避
用户快速拖拽滑块导致模块重复创建    调节烟雾数量时，页面逐渐变卡，内存飙升。    每次滑块 input 事件都触发 createParticles() 重建整个粒子系统，但旧几何体/材质未销毁。    1. 对所有重建操作加防抖（debounce），150ms。
2. 重建前必须调用旧对象的 geometry.dispose() 和 material.dispose()。
多次加载 FBX 后场景残留旧模型    导入新模型后，旧模型依然在场景中（可能看不见但仍消耗性能）。    FBXHandler 加载新模型时仅 add 了 new model，忘记 remove old model。    在 FBXHandler.load() 开始时，先查找场景中已有的 fbxModel 并执行 scene.remove(fbxModel) 和资源清理，再加载新模型。
窗口 resize 后 UI 错乱或 Canvas 比例异常    缩放浏览器窗口后，按钮重叠，或模型被拉伸/压扁。    CSS 使用固定 px 定位，Canvas 尺寸更新不完整。    1. 底部工具栏使用 % 或 vw 配合 flex。
2. resize 监听中同时更新 renderer.setSize()、camera.aspect 和 labelRenderer.setSize()。
💡 总结：构建时的检查清单
为了系统性地避免上述问题，建议你在开发时按以下顺序验证：

能跑起来吗？ → 渲染器自动降级是否生效、基本网格和球体能否添加。

FBX 导入正常吗？ → 摄像机列表是否正确显示、切换视角是否可用。

透明背景还在吗？ → 添加视频背景后，3D 场景是否能透过透明区域看到视频。

粒子/烟雾效果叠加正常吗？ → 多个透明物体间不闪烁、不穿透模型。

GodRays 能出光束吗？ → 阴影是否正确投射，遮光片形状是否生效。

录制能下载文件吗？ → MediaRecorder 和 CCapture 都分别测试，检查文件大小和播放速度。

连续操作 10 分钟内存稳定吗？ → 反复加载 FBX、拖动滑块，内存使用曲线是否平稳。

这份预警清单可以直接交给 AI Agent，作为每个模块开发后的单元测试参考。需要我进一步补充某个具体模块的测试用例吗？

