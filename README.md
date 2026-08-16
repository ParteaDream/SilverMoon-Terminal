# 银月终端 · SilverMoon Terminal

<div align="center">
本地化游戏维基数据库应用 · 支持查询、编辑与管理游戏数据

[![Version](https://img.shields.io/badge/version-2.0.1-blue.svg)](https://github.com/ParteaDream/SilverMoon-Terminal)
[![Electron](https://img.shields.io/badge/electron-31-blue.svg)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/react-18-61dafb.svg)](https://react.dev/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/ParteaDream/SilverMoon-Terminal/blob/main/LICENSE)
</div>

---

## 简介

SilverMoon Terminal（银月终端）是一款基于 Electron 的桌面端定制数据库应用，提供本地化的数据查询、编辑与管理功能。数据存储于本地 SQLite 数据库，无需网络即可离线使用。

除常规的数据库管理功能外，应用还内置了仿桌面系统的**终端板块**，提供养成计算、抽卡记录拉取、账号数据看板、大地图标注、祈愿概率模拟等一系列小工具。

开发目的为个人使用，感兴趣的话欢迎体验，请勿传播。

---

## 主要功能

- 📊 **数据浏览与编辑** — 角色、武器、圣遗物、材料、祈愿、挑战、游戏数据等板块的表格/画廊双视图，支持增删改查、批量操作、多列排序与筛选
- 🖥️ **终端板块** — 仿桌面系统：桌面图标网格（自由拖拽、框选、群组移动、右键收起）、Dock 菜单栏、可拖拽/缩放/全屏的独立应用窗口（macOS 风格吸入/展开动画），内置 10 个应用 + 3 个系统工具
- 📦 **资源库** — 参考 iOS App 资源库：全局快捷键（Ctrl+Tab / control+Tab）呼出小窗，按拼音排序浏览全部小程序，可拖拽图标到桌面重新添加，快捷键可自定义
- 🧮 **养成计算器** — 角色升级/天赋培养材料需求计算，双端范围滑块设定区间，旅行者元素切换，支持从世界树账号一键填入当前练度
- 📈 **祈愿分析** — 基于数据库词条建模的精确概率引擎（列式马尔可夫 DP），多卡池抽取顺序规划、蒙特卡洛模拟验证
- 🎰 **祈愿捕捉站** — 米哈游官方登录（扫码）拉取抽卡记录，五星时间线可视化，按 UID 多档案管理
- 🌍 **摹忆中枢** — 交互式原神大地图：分层切片渲染、标点/文本框标注、分层地图（地面/地下/地上层）、地图标定与开发者工具
- 🏦 **北国银行** — 按日期的原石/纠缠之缘/创世结晶/星辉收支记账，差额自动换算，联动祈愿分析
- 🌳 **世界树** — 米游社账号数据看板：探索度、角色面板、深境螺旋/剧诗/危战挑战、实时便笺、圣遗物练度分析（有效副词条/权重/评级）
- 🖼️ **图包管理** — 智能识别数据库文件夹下的图包，多版本优先级选择，增量更新 + 断点续传下载
- 🎨 **主题定制** — 9 套内置主题 + 自定义配色方案，元素颜色可独立配置
- 🔍 **全局搜索** — 各板块内快速检索所有数据
- 💾 **备份与恢复** — 数据库自动/手动备份，支持导入导出、多基准库切换
- 🔄 **软件更新检查** — GitHub Release 发布
- 🌐 **网站收藏** — 内置常用网站快捷访问

---

## 技术栈

| 类型 | 技术 |
|------|------|
| **前端** | React 18 + TailwindCSS + Lucide Icons + React Router |
| **桌面框架** | Electron 31 |
| **数据库** | SQLite (sql.js WASM)，双库模式（基准库 + 用户增量库） |
| **构建工具** | Vite 5 + electron-builder |
| **语言** | JavaScript (JSX) |

---

## 项目结构

```
├── electron/               # Electron 主进程
│   ├── main.js             # 主进程入口：窗口管理、IPC 通信、爬虫、地图切片、下载管理等
│   ├── preload.js          # 预加载脚本（contextBridge 暴露 window.electronAPI）
│   ├── schema.sql          # 数据库表结构定义（28 张表）
│   ├── seed.sql            # 种子数据（主文件）
│   └── seed_part1-5.sql    # 种子数据（分卷）
├── src/                    # React 渲染进程
│   ├── main.jsx            # Vite 入口
│   ├── App.jsx             # 路由配置 + 全局布局（自定义标题栏/浮动导航）
│   ├── index.css           # 全局样式 + 主题变量 + 动画
│   ├── context/            # React Context
│   │   ├── DbContext.jsx       # 数据库门面：query/readImage/全部后端 API 封装
│   │   ├── ThemeContext.jsx    # 主题系统（9 套预设 + 自定义配色）
│   │   ├── NavContext.jsx      # 导航历史栈 + 页面状态持久化
│   │   ├── TerminalContext.jsx # 终端窗口管理（启动/召唤/隐藏/置顶）
│   │   ├── PageMemoryContext.jsx # 详情页状态记忆（滚动位置等）
│   │   └── SidebarContext.jsx    # 侧边栏事件
│   ├── pages/              # 页面组件
│   │   ├── CharactersPage.jsx       # 角色列表（表格/画廊 + 元素筛选条）
│   │   ├── CharacterDetailPage.jsx  # 角色详情（9 模块：天赋/命座/素材/时装/故事/料理/名片/图库）
│   │   ├── WeaponsPage.jsx          # 武器列表（表格/画廊/装备三视图）
│   │   ├── WeaponDetailPage.jsx     # 武器详情（精炼滑块动态替换倍率）
│   │   ├── ArtifactsPage.jsx        # 圣遗物列表
│   │   ├── ArtifactDetailPage.jsx   # 圣遗物详情（五部件联动查看）
│   │   ├── MaterialsPage.jsx        # 材料列表（9 类材料类型）
│   │   ├── MaterialDetailPage.jsx   # 材料详情
│   │   ├── WishesPage.jsx           # 祈愿卡池档案（卡池图/详情双视图）
│   │   ├── ChallengesPage.jsx       # 挑战（深境螺旋/幻想真境剧诗/幽境危战）
│   │   ├── GameDataPage.jsx         # 游戏数据（计算公式/元素反应/游戏机制词条）
│   │   ├── WebsitesPage.jsx         # 网站收藏
│   │   ├── TerminalPage.jsx         # 终端桌面（图标网格 + 应用窗口系统）
│   │   ├── SettingsPage.jsx         # 设置（通用/外观/颜色/版本/高级）
│   │   └── ChangelogPage.jsx        # 版本速览
│   ├── components/         # 通用组件
│   │   ├── DataTable.jsx / EditModal.jsx   # 通用数据表格与编辑弹窗
│   │   ├── SetupWizard.jsx                 # 首次设置向导
│   │   ├── Sidebar.jsx / SearchBar.jsx     # 侧边导航 / 搜索框
│   │   ├── ColoredText.jsx / ColorTextInput.jsx / ColorPicker.jsx  # 彩色标记文本体系
│   │   ├── Lightbox.jsx / ItemThumb.jsx / NoteSpan.jsx             # 图片灯箱/缩略图/附注
│   │   ├── WishAnalysis.jsx / TableEditor.jsx / DevToolbar.jsx     # 祈愿分析/表格编辑/开发者工具栏
│   │   ├── MapCalibration.jsx / LayerMapModal.jsx / MarkerCreatorModal.jsx
│   │   ├── PlacementEditor.jsx / TextboxCreatorModal.jsx           # 地图标定与标注工具
│   │   ├── appRegistry.js      # 应用注册表（APPS/SYS_TOOLS）+ 快捷键解析
│   │   ├── AppLibrary.jsx      # 资源库（iOS 风格程序小窗，可拖拽到桌面）
│   │   └── TerminalDock.jsx + 10 个终端应用（详见下方终端板块）
│   ├── hooks/              # 自定义 Hooks
│   │   ├── useLazyImage.js     # 图片懒加载
│   │   ├── useImageDrag.js     # 图片拖出窗口
│   │   ├── useDetailState.js   # 详情页状态持久化
│   │   ├── useTypeColor.js     # 标签颜色稳定分配
│   │   └── useDownloadProgress.js # 图包下载进度
│   └── utils/              # 工具函数
│       ├── colorMarkup.js      # BBCode 彩色标记解析/渲染
│       ├── wishAnalysis.js     # 祈愿概率引擎（马尔可夫 DP + 蒙特卡洛）
│       ├── pageStateStore.js   # 页面状态持久化层
│       ├── mapViewport.mjs / annotationViewport.mjs / tileResolution.mjs
│       ├── markerOverlap.mjs / idleLoader.js    # 大地图性能支撑
├── assets/                 # 应用图标
├── public/                 # 静态资源（元素图标、蛇素材、预设壁纸、星级背景）
├── dist/                   # 构建产物
├── scripts/                # 辅助脚本（测试/种子导出/签名/性能基准等）
├── doc/                    # 备忘录文档
├── index.html              # HTML 模板
├── package.json            # 项目依赖与构建配置
├── vite.config.js          # Vite 配置
├── tailwind.config.js      # Tailwind 配置
└── postcss.config.js       # PostCSS 配置
```

---

## 板块功能详解

### 1. 数据管理板块（角色 / 武器 / 圣遗物 / 材料）

四类实体均采用「列表页 + 详情页」结构，共享同一套架构：

- **列表页**：表格/画廊双视图（武器额外有"装备"密集小图标视图）；支持搜索、多列排序、筛选（角色支持 7 元素图标多选筛选条）、多选批量删除、右键菜单；行右键可直接唤起养成计算器；所有状态（视图模式/搜索/排序/滚动位置）自动持久化，返回列表时精确恢复滚动位置
- **详情页**：横幅 Banner + 可折叠模块卡片 + 图片灯箱；编辑弹窗支持图片导入（拖拽/文件选择器）与改 ID 时级联更新关联表

| 板块 | 特色 |
|------|------|
| **角色** | 9 个可开关模块：基本信息（等级/元素滑块切换面板属性）、天赋技能（Excel 风格倍率表，支持直接粘贴 Excel/TSV）、命之座、培养素材、角色故事（全屏阅读器，三主题 + 章节/滚动双模式）、时装（点击切换激活时装并联动列表头像）、特殊料理、名片、图库（多图拖放导入）；相关效果引用库（`[effect:名称]` 标记自动展开） |
| **武器** | 三视图列表；详情页精炼滑块 1~5 实时替换被动描述各精炼等级下的倍率；武器分类（武器/皮肤/TPS） |
| **圣遗物** | 编辑表单覆盖五件套完整文案与图片；详情页五部件 Tab 联动查看（名称/图片/介绍/故事四维切换） |
| **材料** | 9 类材料类型（角色突破/武器突破/天赋书/料理/特产/通用/掉落/周本/活动）彩色胶囊徽章；类型中英文自动归一化 |

### 2. 祈愿板块

- **祈愿卡池**：按「版本 + 期数」组织卡池档案（角色活动/武器活动/集录/常驻四类），卡池图/详情双视图，F 键快速切换；进行中的卡池显示彩虹边框动画；卡池内物品可拖拽排序，联动用户时装选择显示角色立绘
- **祈愿分析**（北国银行联动）：输入本期资源余额（原石/纠缠/结晶/星辉），自定义多卡池抽取顺序，计算各目标达成概率与期望/乐观/保守抽数；完整建模软保底、四星 10 抽保底、捕获明光、定轨命定值、星辉回收再利用，40,000 次蒙特卡洛模拟输出分布；支持从世界树账号自动填充命座、从祈愿捕捉站自动推算垫池

### 3. 挑战板块

三期高难内容档案：**深境螺旋**（渊月祝福、地脉 Buff、三间敌人配置）、**幻想真境剧诗**（推荐元素、开幕/特邀角色、六格敌人配置）、**幽境危战**（三难度 × 3 BOSS，优势/劣势支持 `{元素ID}` 占位符混排元素图标）。

### 4. 数据板块（游戏数据）

自由格式 Wiki 词条管理（计算公式/元素反应/游戏机制三类）：Markdown 渲染（自实现解析器，支持彩色标记）、多图、内嵌数据表格（TableEditor，支持 Excel 粘贴）、跨板块**相关链接**体系（可关联到角色/武器/圣遗物/材料任意条目，点击直达）。

### 5. 站点板块

网站收藏（米游社、Enka 等）：表格/画廊双视图，画廊可拖拽排序，站点数据表损坏时自动修复。

### 6. 版本速览（Changelog）

按游戏版本纵向汇总该版本新增内容（角色/武器/圣遗物/时装/材料/数据词条/祈愿卡池），版本封面图 + 随机背景，所有条目可点击直达详情；编辑弹窗支持 7 类新增条目管理与标签配色。

### 7. 终端板块

仿桌面系统的独立子界面：桌面图标网格（自由拖拽 + 松手对齐网格、框选、群组拖动、右键菜单含打开/收起）、自定义壁纸（拖拽导入/预设）、底部 Dock 菜单栏（hover 放大、运行指示点、右键关闭）。

- **桌面程序收起**：右键菜单「收起」可将程序从桌面移除（程序仍保留在资源库），从资源库拖拽图标到桌面可重新添加，已存在则不重复
- **资源库**（Dock 系统工具）：参考 iOS App 资源库，点击图标从图标位置展开小窗（面板中心与图标中心对齐），按名称/拼音排序 + 搜索，点击程序直接打开并收起小窗；支持拖拽图标到桌面
- **全局快捷键**：默认 `Ctrl+Tab`（Windows）/ `control+Tab`（Mac）在任意板块呼出资源库，可在「终端 → 自定义 → 通用」中自定义（存 user.json，即时生效）
- 所有应用均可作为**独立窗口**拖拽移动、八向缩放、双击/按钮全屏、隐藏（macOS 风格吸入 Dock 动画，唤起时从 Dock 图标位置展开），并可被 Dock 召唤到任意板块页面上层

#### 应用清单

| 应用 | 功能 |
|------|------|
| **养成计算器** | 计算角色等级/三项天赋从当前到目标等级的全部材料需求（摩拉、经验书、元素石、Boss 掉落、特产、天赋书、周本、智识之冕）；双端范围滑块（左键设起点/右键设终点），旅行者（主角）全套材料硬编码支持 + 元素切换，角色列表页/详情页右键可一键唤起并预选角色；可从世界树账号一键填入当前角色等级与技能等级（自动扣除命座/固有天赋加成）作为左端点 |
| **Beta备忘录** | 测试服任务管理：每个任务挂多张测试截图（任务汇总/命座测试/问卷汇总 + 自定义类型），内置三种画笔（OK 绿色覆盖条、自由画笔 10 色、橡皮擦）在图片上标注完成痕迹，撤销/重做，400ms 防抖自动保存 |
| **非完备证明** | 贪吃蛇小游戏：图片素材蛇身渲染（头部/身体/尾巴朝向旋转）、双方向缓冲防自杀、动态加速、双食物机制、最高纪录持久化；顶部速度仪表盘（指针随蛇变长从绿色渐变为红色，实时显示每秒格数），纯休闲彩蛋 |
| **世界树** | 米游社账号数据看板（扫码/密码登录爬取）：概览（角色/成就/深境/剧诗/危战/活跃天数）、探索度（国家-子区域层级、宝箱/神瞳/神像/声望）、角色面板（等级/命座/武器/圣遗物/面板属性）、挑战（深渊上下期/剧诗/危战）、实时便笺（树脂/委托/周本/派遣等，60 秒自动刷新）；多账号管理，角色头像可跳转对应详情页；角色模块支持按练度评级排序（SSS/S/A/B/C），圣遗物练度分析（有效副词条 + 档位换算 + 收益权重 + 评级，配置按角色存 user.db，开发者可设默认配置与评级标准） |
| **切片辖域·鸽** | 本地相册管理器：选择文件夹识别为相簿（manifest 索引驱动，支持 jpg/png/webp/gif/avif/heic 等 10 种格式），网格/列表双视图、三级懒加载 + 空闲预取管线、灯箱查看（滚轮缩放/拖拽平移/胶片条）、彩色标签系统（收藏/自定义标签 + 跨目录递归筛选）、显示偏好设置 |
| **RateFetcher** | 角色技能倍率导出器：拉取线上 JSON 数据解析 `{paramN}` 占位符，按 Lv.1~15 展开倍率表，批量生成带 BOM 的 CSV 文件；任务队列管理、自定义输出目录、10/13/15 级上限可选 |
| **北国银行** | 原石收支记账本：按日期多期快照（原石/纠缠之缘/创世结晶/星辉），自动计算相邻期消耗/获取差额并换算纠缠之缘等价（160:1 换算，星辉 5:1），每期可一键发起祈愿分析 |
| **祈愿捕捉站** | 米哈游官方登录（扫码）拉取祈愿记录，按 UID 多档案存档（多服务器）；6 种卡池类型的五星时间线（大保底区蓝色/30+ 金色/彩虹流光动画，末段虚位等待提示）、逐条记录查看，联动祈愿分析自动推算垫池 |
| **摹忆中枢** | 交互式原神大地图：分层切片瓦片渲染 + 低缩放整图回退、惯性拖拽平移、指数缩放、标点系统（模板化标点 + 放置管理，支持自定义底盘样式/特殊功能 switch_map 切换地图/tooltip 详情/分层角标）、文本框标注、分层地图（G 地面/B 地下/F 地上层，基座层常显）、开发者模式（两点锚定标定、切片生成、全图生成、批量坐标缩放、地图/标点拖拽排序管理） |
| **时之沙** | 基准库差异对比器：导入外部 .db 文件与当前基准库深度对比角色/武器/圣遗物条目差异，词级 diff 高亮 + 技能倍率表格单元格级对比 + 左右对齐滚动，中文可读差异路径 |

#### 系统工具

| 工具 | 功能 |
|------|------|
| **资源** | 内置文件管理器：浏览数据库目录（图标/列表双视图、图片缩略图预览、搜索），支持拖出到访达/Finder、双击用系统默认应用打开 |
| **自定义** | 终端桌面壁纸管理（拖拽导入/系统选择导入/2 张内置预设壁纸 ToTheMoon、Columbina）+ 资源库快捷键设置（录制新组合，即时生效） |
| **资源库** | 全局程序小窗：按名称/拼音排序浏览全部小程序，点击打开，图标可拖拽到桌面重新添加 |

### 8. 设置板块

| 模块 | 功能 |
|------|------|
| **通用** | 数据库文件夹选择、基准库切换（识别 `silvermoon_terminal-v{version}.db`）、基准数据更新（增量补齐）、图包管理（切换/恢复自动/删除）、图包下载（CDN 增量更新 + 断点续传 + 多余文件清理）、默认启动页、清理缓存 |
| **外观** | 9 套预设主题切换、自定义配色（7 关键色自动生成调色板）、已存方案管理、**应用图标**（canvas 合成 + 一键替换 .exe/.app，可撤回）、时装批量设置、各板块默认视图模式 |
| **颜色** | 7 元素颜色与图标配置（供挑战页/字体编辑等处使用）、通用颜色预设管理、字体颜色忽略列表（粘贴时自动剥离） |
| **版本信息** | 软件/数据版本、版本标签（beta 等）、检查更新、自动更新开关、GitHub/百度网盘手动下载入口 |
| **高级** | 开发者模式（解锁爬虫/地图工具/危险操作）、双数据库模式开关（非开发者修改存 user.db 增量）、数据库备份/导入/导出种子/重新初始化 |

> 💡 点击左下角版本号可快速跳转到版本信息设置。

---

## 快速开始

### 环境要求
- **Node.js** >= 18
- **npm** >= 9
- macOS (arm64) 或 Windows (x64)

### 安装与运行

```bash
# 1. 克隆仓库
git clone https://github.com/ParteaDream/SilverMoon-Terminal.git
cd silvermoon-terminal

# 2. 安装依赖
npm install

# 3. 开发模式（Vite + Electron 热重载）
npm run electron:dev

# 4. 仅启动前端（浏览器预览，部分功能受限）
npm run dev
```

### 构建

```bash
# macOS (ARM64)
npm run electron:build

# Windows (x64)
npm run electron:build:win

# 构建 + 发布到 GitHub Release
npm run electron:publish

# 构建产物在 release/ 目录下
```

### 测试与性能基准

```bash
npm run test:memoryhub   # 摹忆中枢核心算法单测（marker overlap / idle loader / map viewport）
npm run test:wish        # 祈愿概率引擎测试
npm run perf:memoryhub   # 地图缩放性能基准
```

> ⚠️ **macOS 用户须知**
>
> SilverMoon Terminal 使用 ad-hoc（自签名）构建，未通过 Apple 公证。macOS 可能会弹窗提示"已阻止恶意软件"或"无法验证开发者"——**这不是病毒**，仅因应用无 Apple 签名。
>
> ### 首次启动步骤
>
> 1. **将 .app 移到「应用程序」文件夹**（不要放在「下载」中，macOS 对其限制更严）
> 2. **运行解隔离脚本（推荐）**
>    ```bash
>    bash scripts/fix-mac-quarantine.sh
>    ```
>    脚本会自动查找 .app，移除隔离属性并执行 ad-hoc 签名。
>
> 3. **右键 → 打开（首次必须！）**
>    在 Finder 中**右键**点击 `SilverMoon-Terminal.app` → 选择「打开」，在弹出的对话框中点击「打开」。之后就可以正常双击启动了。
>
> ### 备选方案
>
> - **手动清除隔离**：在终端执行 `xattr -cr /Applications/SilverMoon-Terminal.app`
> - **系统设置允许**：打开 **系统设置 → 隐私与安全性 → 安全性**，在页面底部点击「仍然允许」
>
> > 💡 若以上方法均无效，请确认已将 .app 移出**下载**文件夹，并确保运行了 ad-hoc 签名（`codesign --force --deep --sign -`）。<br>
> > 每次从新版本替换 .app 后，都需要重新执行上述步骤。

---

## 图包管理

SilverMoon Terminal 支持从数据库文件夹自动识别图包。任何名称包含 `images` 的文件夹都会被识别为图包。

### 自动选择优先级
1. **`images-版本号-类型`** 格式的文件夹优先（版本越新越优先，同版本 `Extreme` > `Medium` > `Lite`）
   - 示例：`images-1.2.0-Extreme` > `images-1.1.0-Medium`
2. 名称为 **`images`** 的文件夹（精确匹配）
3. 剩余文件夹中**大小最大**的

### 手动选择
进入 **设置 → 通用 → 图包管理**，可手动选择使用的图包，或点击"恢复自动"回到系统默认优先级。图包下载支持 CDN 增量更新（对比远程 manifest）、断点续传与多余文件清理。

---

## 数据架构

- **双库模式**：基准库（`silvermoon_terminal-v{version}.db`，种子数据）+ 用户库（`user.db`）。非开发者模式下，用户的增删改通过 `_user_delta` 增量表记录并合并读取，数据库更新时用户修改不丢失；开发者模式可直接写基准库
- **用户库附加表**：`worldtree_build_configs`（圣遗物练度分析有效副词条/权重配置，按角色存）、`betamemo_tasks`、`northlandbank_records`、`wish_analysis_plans`、`genshin_accounts`（世界树）、`gacha_archives/gacha_items`（祈愿捕捉站）、`map_marker_placements` 等
- **用户配置（user.json）**：开发者模式开关、默认启动页、默认视图模式、时装选择、终端桌面图标（`terminalDesktopIcons`，小程序默认不自动上桌面）、终端壁纸、资源库快捷键（`libraryShortcut`）等
- **图片体系**：图片按文件名存储于图包目录，渲染层经 IPC 读取 base64，带 LRU 缓存与并发队列；支持懒加载与拖放导入
- **彩色标记文本**：`[color=#xxxxxx]` / `[b]` / `[i]` / `[note="附注"]` BBCode 风格标记，全应用统一解析渲染，编辑器支持所见即所得编辑

---

## 许可证

MIT License

---

## 致谢

- [DeepSeek](https://platform.deepseek.com) — VibeCoding
- [Electron](https://www.electronjs.org/) — 跨平台桌面应用框架
- [React](https://react.dev/) — UI 框架
- [TailwindCSS](https://tailwindcss.com/) — 原子化 CSS 框架
- [sql.js](https://sql.js.org/) — WebAssembly SQLite
- [Lucide](https://lucide.dev/) — 图标库
