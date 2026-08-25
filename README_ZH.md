# 塔科夫武器模组优化器 (Web 版)

[English](README.md) | [中文](README_ZH.md) | [Español](README_ES.md)

一个纯客户端的《逃离塔科夫》武器改装优化工具。它利用 WebAssembly (WASM) 和 HiGHS 求解器直接在浏览器中运行，根据你设定的优先级和限制条件，计算数学上最优的改装方案。

没有后端。所有计算逻辑，包括繁重的优化运算，都通过 WASM 在本地机器上完成。

![项目概览](https://img.shields.io/badge/Tarkov-Optimizer-blue.svg)
![React](https://img.shields.io/badge/React-19%2B-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue.svg)
![Vite](https://img.shields.io/badge/Vite-6%2B-purple.svg)
![WASM](https://img.shields.io/badge/WASM-Powered-orange.svg)

## 主要功能

### 智能优化模式
- **“甜点”平衡模式 (Sweet Spot)**：自动寻找人机工效、低后坐力和性价比兼备的均衡改装方案，避免在边际效益递减的配件上过度花费。
- **EvoErgo（重量自适应人机）**：综合考虑枪械重量对操控的影响，优化实际游戏中的开镜速度与操控手感。
- **自定义权重滑块**：根据打法自由调节人机工效、垂直后坐力压制和价格的优先级。

### 实战约束与自由定制
- **防止开镜过冲 (Prevent Overswing)**：严格限制武器重量与人机工效的配比，彻底消除快速开镜瞄准（ADS）时的枪口晃动与过冲甩头。
- **护甲负重人机惩罚**：支持设置全套防弹衣、头盔和背包的人机扣减（-40% 至 0%），保证全装实战状态下依然顺畅开镜。
- **硬性属性限制**：支持指定最大后坐力上限、最低人机底线、最大重量、预算上限（₽）以及最大精度散布（MOA）。
- **功能性配置**：支持指定最低弹匣容量、最低瞄准镜视距及口径转换。
- **商人等级与跳蚤过滤**：根据你的 PMC 等级和商人忠诚等级（LL1–LL4）筛选可用配件，支持一键开关跳蚤市场。
- **保留原厂件与锁定配件**：一键保留武器自带零件，支持固定心仪配件（如指定光学瞄具或消音器），或排除不想要的配件。

### 权衡分析与内置指南
- **2D 权衡曲线探索**：直观探索人机 vs 后坐力、人机 vs 价格、后坐力 vs 价格图表，看清每提升 1 点属性需要付出多少代价。
- **多武器同图对比**：在同一「选择武器」栏用 +/− 叠加多把枪的帕累托前沿（一把就是 n = 1），共用商人与预算条件，任意点可导出到 EFTForge。
- **实时属性指示卡**：直观展示开镜过冲状态、重量效率与各项关键数据。
- **内置改装与机制指南**：内置详细的使用指南，解析塔科夫枪械属性、弹道散布、开镜物理与优化原理。
- **100% 纯本地运行**：完全在浏览器端秒级计算，无需后端、无需登录、无服务器延迟。
- **支持 16 种语言**：中文、English、Русский、Español、Deutsch、Français 等 16 种语言。
## 技术栈

- **前端**：[React](https://react.dev/) 19、[Vite](https://vitejs.dev/) 6、[TypeScript](https://www.typescriptlang.org/)
- **UI 与可视化**：[Ant Design](https://ant.design/) v6、[Recharts](https://recharts.org/)、[KaTeX](https://katex.org/)
- **求解器**：[HiGHS](https://highs.dev/)（WebAssembly / MILP / 线性规划松弛 / 增广切比雪夫标量化 / AUGMECON2 / 割平面法）
- **数据源**：[Tarkov.dev JSON API](https://json.tarkov.dev/endpoints)
## 安装与运行

需要 [Node.js](https://nodejs.org/) v18 或更高版本，以及 [npm](https://www.npmjs.com/)（通常随 Node.js 一起安装）。

1. 克隆仓库：
   ```bash
   git clone https://github.com/AhaiMk01/tarkov-weapon-optimizer.git
   cd tarkov-weapon-optimizer
   ```

2. 进入前端目录：
   ```bash
   cd frontend
   ```

3. 安装依赖：
   ```bash
   npm install
   ```
   这一步同时会验证 `highs` WASM 包是否安装正确。

4. 启动开发服务器：
   ```bash
   npm run dev
   ```

5. 打开 `http://localhost:5173`，或终端里显示的那个 URL。

## 使用 Docker 部署（自托管）

每次发布打标签（`v*`）时，都会向 GitHub Container Registry 推送多架构预构建镜像（`linux/amd64`、`linux/arm64`），可以跑在家庭服务器、VPS 和树莓派上。

容器本身只是一个静态 Web 服务器（`nginx:alpine`，约 30 MB）。所有优化计算都在访问者浏览器中通过 WASM 完成，所以你不需要准备后端、数据库或任何环境变量。

### 快速开始（使用预构建镜像）

```bash
docker run -d \
  --name tarkov-optimizer \
  --restart unless-stopped \
  -p 8080:80 \
  ghcr.io/ahaimk01/tarkov-optimizer-frontend:latest
```

然后访问 `http://<your-host>:8080`。

宿主端口 `8080` 可以换成任意端口，容器内部始终监听 `80`。如果要锁定具体版本，把 `:latest` 换成例如 `:2.4.2`。

### 从源码构建

如果你想自己构建镜像（例如基于分叉仓库）：

```bash
cd frontend
docker build -t tarkov-optimizer .
docker run --rm -d -p 8080:80 --name tarkov-optimizer tarkov-optimizer
```

### 置于反向代理之后

应用是单页面应用（SPA），已配置 fallback 路由，任何深链 URL（例如 `/explore`）都会返回 `index.html`。像反代普通静态站点那样转发容器端口即可，它不用 WebSocket，也不需要会话粘连。

### 停止与更新

```bash
docker stop tarkov-optimizer && docker rm tarkov-optimizer
docker pull ghcr.io/ahaimk01/tarkov-optimizer-frontend:latest
# 然后重新执行“快速开始”中的命令
```

## 验证与测试

仓库里有一个验证脚本，用真实武器跑一遍 WASM 求解器：

```bash
npx tsx test_multi_weapon_verification.ts
```

它会优化 AK-74、M4A1 这类结构复杂的武器，并检查结果是有效的整数最优配置，而不是崩溃。

## 贡献

欢迎提交 Pull Request。

## 许可证

本项目仅供教育和个人使用。所有数据由 [Tarkov.dev](https://tarkov.dev/) 提供。
