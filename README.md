# 银月终端 · SilverMoon Terminal

<div align="center">

**本地化游戏维基数据库应用 · 支持查询、编辑与管理游戏数据**

[![Version](https://img.shields.io/badge/version-1.0-blue.svg)](package.json)
[![Electron](https://img.shields.io/badge/electron-31-blue.svg)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/react-18-61dafb.svg)](https://react.dev/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

</div>

---

## 简介

SilverMoon Terminal（银月终端）是一款基于 Electron 的原神桌面端数据库应用，提供本地化的数据查询、编辑与管理功能。数据存储于本地 SQLite 数据库，无需网络即可离线使用。

### 主要功能
- 📊 **数据浏览与编辑** — 角色、武器、圣遗物、材料、祈愿、挑战等数据的表格/详情双视图
- 🖼️ **图包管理** — 智能识别数据库文件夹下的图包，支持多版本图包优先级选择
- 🎨 **主题定制** — 6 套内置主题 + 自定义颜色方案，元素颜色可独立配置
- 🔍 **全局搜索** — 快速检索所有数据表
- 💾 **备份与恢复** — 数据库自动/手动备份，支持导入导出
- 🌐 **网站收藏** — 内置常用网站快捷访问

---

## 技术栈

| 类型 | 技术 |
|------|------|
| **前端** | React 18 + TailwindCSS + Lucide Icons |
| **桌面框架** | Electron 31 |
| **数据库** | SQLite (sql.js WASM) |
| **构建工具** | Vite 5 |
| **语言** | JavaScript (JSX) |

---

## 项目结构

```
├── electron/               # Electron 主进程
│   ├── main.js             # 主进程入口 + IPC 通信
│   ├── preload.js          # 预加载脚本（contextBridge）
│   ├── schema.sql          # 数据库表结构定义
│   ├── seed.sql            # 种子数据（主文件）
│   └── seed_part1-5.sql    # 种子数据（分卷）
├── src/                    # React 渲染进程
│   ├── main.jsx            # Vite 入口
│   ├── App.jsx             # 路由配置
│   ├── index.css           # 全局样式 + 主题变量
│   ├── context/            # React Context
│   │   ├── DbContext.jsx       # 数据库上下文
│   │   ├── ThemeContext.jsx    # 主题上下文
│   │   └── SidebarContext.jsx  # 侧边栏上下文
│   ├── components/         # 通用组件
│   │   ├── Sidebar.jsx         # 侧边导航栏
│   │   ├── SearchBar.jsx       # 搜索框
│   │   ├── DataTable.jsx       # 通用数据表格
│   │   ├── DataDetail.jsx      # 详情视图
│   │   ├── EditModal.jsx       # 编辑弹窗
│   │   └── SetupWizard.jsx     # 首次设置向导
│   ├── pages/              # 页面组件
│   │   ├── CharactersPage.jsx      # 角色列表
│   │   ├── CharacterDetailPage.jsx # 角色详情
│   │   ├── WeaponsPage.jsx         # 武器列表
│   │   ├── ArtifactsPage.jsx       # 圣遗物列表
│   │   ├── MaterialsPage.jsx       # 材料列表
│   │   ├── WishesPage.jsx          # 祈愿卡池
│   │   ├── ChallengesPage.jsx      # 挑战
│   │   ├── GameDataPage.jsx        # 游戏数据
│   │   ├── WebsitesPage.jsx        # 网站收藏
│   │   └── SettingsPage.jsx        # 设置（通用/外观/颜色/版本/高级）
│   ├── hooks/              # 自定义 Hooks
│   │   ├── useLazyImage.js     # 图片懒加载
│   │   └── useImageDrag.js     # 图片拖拽
│   └── utils/              # 工具函数
├── assets/                 # 应用图标
├── public/                 # 静态资源
├── scripts/                # 辅助脚本
├── index.html              # HTML 模板
├── package.json            # 项目依赖与构建配置
├── vite.config.js          # Vite 配置
├── tailwind.config.js      # Tailwind 配置
└── postcss.config.js       # PostCSS 配置
```

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

# 4. 仅启动前端（浏览器预览）
npm run dev
```

### 构建

```bash
# macOS (ARM64)
npm run electron:build

# Windows (x64)
npm run electron:build:win

# 构建产物在 release/ 目录下
```

### 快捷脚本

| 文件 | 作用 |
|------|------|
| `运行.command` | macOS 开发模式快速启动 |
| `#Mac.command` | macOS 构建 |
| `#Win.command` | Windows 构建 |

---

## 图包管理

SilverMoon Terminal 支持从数据库文件夹自动识别图包。任何名称包含 `images` 的文件夹都会被识别为图包。

### 自动选择优先级
1. **`images-版本号-类型`** 格式的文件夹优先（版本越新越优先，同版本 `Extreme` > `Medium` > `Lite`）
   - 示例：`images-1.2.0-Extreme` > `images-1.1.0-Medium`
2. 名称为 **`images`** 的文件夹（精确匹配）
3. 剩余文件夹中**大小最大**的

### 手动选择
进入 **设置 → 版本信息 → 图包管理**，可手动选择使用的图包，或点击"恢复自动"回到系统默认优先级。

---

## 设置模块

| 模块 | 功能 |
|------|------|
| **通用** | 数据库文件夹选择、初始数据补缺 |
| **外观** | 6 套主题切换、自定义配色、默认视图模式 |
| **颜色预设** | 7 种元素颜色自定义、图标导入 |
| **版本信息** | 查看软件版本、图包管理与切换 |
| **高级** | 开发者模式、数据库备份/导入/重初始化 |

> 💡 点击左下角版本号可快速跳转到版本信息设置。

---

## 许可证

MIT License

---

## 致谢

- [Electron](https://www.electronjs.org/) — 跨平台桌面应用框架
- [React](https://react.dev/) — UI 框架
- [TailwindCSS](https://tailwindcss.com/) — 原子化 CSS 框架
- [sql.js](https://sql.js.org/) — WebAssembly SQLite
- [Lucide](https://lucide.dev/) — 图标库
