# 塔科夫武器模组优化器 (Web 版) 🔫

[English](README.md) | [中文](README_ZH.md)

一个先进的、**纯客户端**《逃离塔科夫》武器改装优化工具。该工具利用 **WebAssembly (WASM)** 和 **HiGHS 求解器** 直接在您的浏览器中运行，根据您的优先级和限制条件，为您找到数学上最优的改装方案。

> **无需后端**: 所有计算逻辑（包括繁重的优化数学运算）均通过 WASM 在您的本地机器上运行。

![项目概览](https://img.shields.io/badge/Tarkov-Optimizer-blue.svg)
![React](https://img.shields.io/badge/React-18%2B-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue.svg)
![Vite](https://img.shields.io/badge/Vite-5.0%2B-purple.svg)
![WASM](https://img.shields.io/badge/WASM-Powered-orange.svg)

## 🚀 主要功能

- **🚀 即时优化**: 直接在浏览器中运行，无服务器延迟。
- **🧠 高级求解器**: 使用编译为 WebAssembly 的 **HiGHS** 线性规划求解器，提供工业级的优化能力。
- **🎯 寻找最优改装**: 根据您的自定义权重，在 **人机工效**、**后坐力** 和 **价格** 之间取得平衡。
- **📊 帕累托前沿探索**: 可视化权衡曲线（例如人机 vs 后坐力），助您做出明智决策。
- **💡 智能取整**: 实施了强大的“贪婪取整”算法，确保从线性规划松弛解中生成有效、无冲突且整数最优的配置。
- **🛡️ 硬性约束**:
    - 预算限制 (₽)
    - 最低人机工效
    - 最大垂直后坐力
    - 最小弹匣容量
    - 最小瞄准距离
    - 最大重量 (kg)
- **🛒 智能过滤**:
    - PMC 等级和商人忠诚度设置。
    - 跳蚤市场开关。
- **🌍 多语言支持**: 完全本地化支持 **English**、**Русский** 和 **中文**。

## 🛠️ 技术栈

- **前端**: [React](https://react.dev/) + [Vite](https://vitejs.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **求解器**: [HiGHS](https://highs.dev/) (via WebAssembly)
    - *策略*: 线性规划松弛 (LP Relaxation) + 扰动 (Perturbation) + 贪婪取整 (Greedy Rounding)
- **数据源**: [Tarkov.dev API](https://tarkov.dev/api/) (GraphQL)
- **样式**: [TailwindCSS](https://tailwindcss.com/)

## 📥 安装与运行

### 前置要求
- [Node.js](https://nodejs.org/) (v18 或更高版本)
- [npm](https://www.npmjs.com/) (通常随 Node.js 一起安装)

### 步骤

1. **克隆仓库**:
   ```bash
   git clone https://github.com/AhaiMk01/tarkov-weapon-optimizer.git
   cd tarkov-weapon-optimizer
   ```

2. **进入前端目录**:
   ```bash
   cd frontend
   ```

3. **安装依赖**:
   ```bash
   npm install
   ```
   *注意: 这将验证 `highs` WASM 包是否正确安装。*

4. **启动开发服务器**:
   ```bash
   npm run dev
   ```

5. **在浏览器中打开**:
   访问 `http://localhost:5173` (或终端中显示的 URL)。

## 🐳 使用 Docker 部署（自托管）

每次发布打标签（`v*`）时，都会向 GitHub Container Registry 推送多架构预构建镜像（`linux/amd64`、`linux/arm64`），适用于家庭服务器、VPS 以及树莓派等设备。

> 容器仅是一个纯静态 Web 服务器（`nginx:alpine`，约 30 MB）。所有优化计算都在访问者浏览器中通过 WASM 运行——无需后端、无需数据库、无需环境变量。

### 快速开始（使用预构建镜像）

```bash
docker run -d \
  --name tarkov-optimizer \
  --restart unless-stopped \
  -p 8080:80 \
  ghcr.io/ahaimk01/tarkov-optimizer-frontend:latest
```

然后访问 `http://<your-host>:8080`。

宿主端口 `8080` 可改为任意端口；容器内部始终监听 `80`。如需锁定具体版本，可将 `:latest` 替换为例如 `:2.4.2`。

### 从源码构建

如需自行构建镜像（例如基于分叉仓库）：

```bash
cd frontend
docker build -t tarkov-optimizer .
docker run --rm -d -p 8080:80 --name tarkov-optimizer tarkov-optimizer
```

### 置于反向代理之后

应用为单页面应用（SPA），已配置 fallback 路由，任何深链 URL（例如 `/explore`）都会返回 `index.html`。按普通静态站点反代容器端口即可——无需 WebSocket、无需会话粘连。

### 停止 / 更新

```bash
docker stop tarkov-optimizer && docker rm tarkov-optimizer
docker pull ghcr.io/ahaimk01/tarkov-optimizer-frontend:latest
# 然后重新执行“快速开始”中的命令
```

## 🧪 验证与测试

本项目包含一套严格的验证套件，以确 WASM 求解器的稳定性和正确性。

- **运行验证脚本**:
  ```bash
  npx tsx test_multi_weapon_verification.ts
  ```
  该脚本针对复杂的现实世界武器（例如 AK-74, M4A1）测试优化器，确保其在不崩溃的情况下生成有效的整数最优改装。

## 🤝 贡献

欢迎贡献代码！请随时提交 Pull Request。

## 📜 许可证

本项目仅供教育和个人使用。所有数据由 [Tarkov.dev](https://tarkov.dev/) 提供。
