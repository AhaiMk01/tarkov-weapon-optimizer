# 塔科夫武器模组优化器

[English](README.md) | [中文](README_ZH.md)

专为《逃离塔科夫》打造的高级武器改装优化工具。该工具利用 **约束规划**（通过 Google OR-Tools CP-SAT求解器），根据您的优先级和限制条件，为您找到任何武器在数学上的最优改装方案。

![项目概览](https://img.shields.io/badge/Tarkov-Optimizer-blue.svg)
![Python](https://img.shields.io/badge/Python-3.10%2B-blue.svg)
![React](https://img.shields.io/badge/React-19.2-61dafb.svg)
![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-green.svg)
![平台](https://img.shields.io/badge/平台-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)

## 架构

本项目采用现代化的 **FastAPI + React/TypeScript** 架构：

- **后端** (`backend/`): FastAPI 服务器，处理数据获取和优化计算
- **前端** (`frontend/`): React 19 + TypeScript + Vite + Ant Design 5 网页界面

## 主要功能

- **最优改装搜索**: 使用加权目标函数在 **人机工效**、**后坐力** 和 **价格** 之间取得平衡
- **帕累托前沿探索**: 可视化不同属性（后坐力 vs 价格等）之间的权衡曲线
- **硬性约束**: 设置预算、最低人机工效、最大后坐力、弹匣容量、瞄准距离、重量限制
- **智能可用性过滤**: 根据 PMC 等级、跳蚤市场访问权限、商人忠诚度等级 (LL1-LL4) 过滤
- **匠心任务**: 游戏内所有匠心任务列表及优化解决方案
- **多语言支持**: 支持 16 种语言（英语、俄语、中文、西班牙语、德语、法语、意大利语、日语、韩语、波兰语、葡萄牙语、土耳其语、捷克语、匈牙利语、罗马尼亚语、斯洛伐克语）
- **导出功能**: 将改装方案保存为 JSON 或 Markdown 格式分享

## 技术栈

- **后端**: FastAPI, Google OR-Tools (CP-SAT), Pydantic, Loguru
- **前端**: React 19, TypeScript, Vite, Ant Design 5, i18next, Recharts
- **数据源**: Tarkov.dev GraphQL API

## 快速开始

### 前置要求

- Python 3.10+
- Node.js 18+
- npm 或 pip

### 安装

**使用 npm（推荐）:**
```bash
npm run install:all
```

**手动安装:**

后端:
```bash
pip install -r backend/requirements.txt
```

前端:
```bash
npm install --prefix frontend
```

### 运行应用

**开发模式（推荐）:**
```bash
npm run build:frontend && npm run dev:backend
```
访问 `http://localhost:15000`

前端代码修改后，运行 `npm run build:frontend` 并刷新浏览器。

## API 端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/info` | GET | 获取所有可用武器列表 |
| `/api/info/{weapon_id}/mods` | GET | 获取特定武器的兼容模组 |
| `/api/optimize` | POST | 执行单一优化 |
| `/api/explore` | POST | 探索帕累托前沿 |
| `/api/gunsmith/tasks` | GET | 获取所有匠心任务 |

## 项目结构

```
tarkov-weapon-optimizer/
├── backend/
│   ├── app/
│   │   ├── api/          # API 路由 (info, optimize, explore, gunsmith, status)
│   │   ├── models/       # Pydantic 模型
│   │   ├── services/     # CP-SAT 优化器
│   │   ├── config.py     # Pydantic Settings 配置
│   │   ├── state.py      # 状态管理, Redis 缓存
│   │   └── main.py       # FastAPI 应用入口
│   └── pyproject.toml
├── frontend/
│   ├── src/
│   │   ├── components/   # React 组件 (common, explore, gunsmith, optimize)
│   │   ├── layouts/      # 布局组件
│   │   ├── api/          # API 客户端
│   │   └── App.tsx       # 主应用
│   ├── public/locales/   # 16 种语言翻译文件
│   └── package.json
├── deploy/               # 部署脚本和 systemd 服务
└── package.json          # 根目录脚本
```

## 贡献

欢迎贡献代码！请随时提交 Pull Request。

## 许可证

本项目仅供教育和个人使用。所有数据由 [Tarkov.dev](https://tarkov.dev/) 提供。
