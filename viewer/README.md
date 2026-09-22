# 本地牙齿审阅查看器

这里直接保存可维护的 HTML/JS 源码。数据清单、模型、截图和问题标记放在独立的本地产物目录。

完整说明见 [主流程与交互式对照查看器](../../docs/pipeline_and_interactive_review.md)。从仓库根目录运行：

```powershell
python tools/review_viewer.py serve --data-root <审阅产物根目录> --port 8906
```

页面以阶段总览 `stages.html` 为唯一入口：左侧选 run，上方按 step1~step10 切换各阶段产物；有肩台对照数据的 run 会多出「肩台对照」阶段（左右对照 + 逐方向剖线）。另有 R6 基线 `index.html`、R7 配准诊断 `registration.html`。R8 `correction.html` 和 R9 `anatomical.html` 为未采用的历史对照。新前端不改写旧模型清单、配准变换或分割 PLY。

离线依赖为 Three.js r160 与同版本 OrbitControls，MIT 授权见 [THREE-LICENSE.txt](vendor/THREE-LICENSE.txt)。运行不需 npm；开发交互测试脚本需要 Node.js。

## 三维显示资源与故障恢复

所有审阅页通过 `render_runtime.js` 共用页面内唯一的 WebGL 渲染器，再将同一任务中渲染的左右视图复制到各自的显示画布。相机、三维拾取、裁剪平面及模型标签保持原样；这不是预生成截图。显示缓冲区每视图最多 200 万像素，模型不降采样。页面进入后台或离开时释放 GPU 上下文，回到前台使用保留的场景与相机重新绘制。

初始化失败会尝试不启用抗锯齿的方式；仍不可用时显示重试控件，自动重试次数有上限。重试成功不重新计算或修改分割。无法绘制期间隐藏旧帧，避免上一病例的画面残留在当前标题下。已访问模型最多缓存 8 个，剖线 JSON 最多缓存 4 个，防止逐例浏览持续积累内存。

如果浏览器仍显示旧的 `Error creating WebGL context`，刷新该页加载新查看器；此前已经打开、尚未刷新的旧版页面仍可能占用 GPU 资源。需要发布整个静态资源集合，不能漏掉新增的 `render_runtime.js`。

以下回归使用实际 Chrome 的 WebGL，包含初始化拒绝、有限重试、强制 context loss、前后台与页面生命周期恢复、抗锯齿回退，以及 13 个小型真实三维对照页同时打开。前后台事件由测试显式触发，未声称模拟了每个宿主应用的标签调度行为。

```powershell
# PLAYWRIGHT_MODULE 可指向现有 Playwright 安装位置。
node tests/browser_webgl_recovery.cjs http://127.0.0.1:8932 debug/webgl_recovery.json
```

```powershell
node scripts/check_shoulder_viewer.mjs --data-root <审阅产物根目录>
python scripts/check_review_browser.py --base-url http://127.0.0.1:8906 --output-dir debug/viewer_browser_check
```

前者在真实 Three.js 几何对象和模拟 DOM/渲染器上遍历病例与控件，不能代替浏览器；后者使用独立临时配置的无头 Chrome/Edge 真实渲染肩台页，不连接用户浏览器会话。可用 `--browser <浏览器可执行文件>` 指定浏览器。报告与截图均写入本地独立目录。
