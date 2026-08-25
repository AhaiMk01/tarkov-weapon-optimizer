# 塔科夫武器模组优化器 (Web 版)

[English](README.md) | [中文](README_ZH.md) | [Español](README_ES.md)

一个纯客户端的《逃离塔科夫》武器改装优化工具。它利用 WebAssembly (WASM) 和 HiGHS 求解器直接在浏览器中运行，根据你设定的优先级和限制条件，计算数学上最优的改装方案。

没有后端。所有计算逻辑，包括繁重的优化运算，都通过 WASM 在本地机器上完成。

![项目概览](https://img.shields.io/badge/Tarkov-Optimizer-blue.svg)
![React](https://img.shields.io/badge/React-19%2B-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue.svg)
![Vite](https://img.shields.io/badge/Vite-6%2B-purple.svg)
![WASM](https://img.shields.io/badge/WASM-Powered-orange.svg)

## 功能特点

### 数学优化引擎
- **多目标求解器**：基于编译为 WebAssembly 的高性能 [HiGHS](https://highs.dev/) 混合整数线性规划 (MILP) 求解器，在 Web Worker 中运行，毫秒级平衡人机工效、垂直后坐力和价格。
- **甜点模式 (增广切比雪夫标量化 / Sweet Spot)**：以武器的 3D 理想点 ($z^*_E, z^*_R, z^*_P$) 为基准求解非凸帕累托最优配置，挖掘出线性加权求和在数学上无法触达的平衡“甜点改装”。
- **EvoErgo（重量自适应人机工效）优化**：基于切线 $k$-sweep 候选求解算法，优化二次非线性 EvoErgoDelta 指标（$\text{EED} = (100 - 0.015 \cdot (100 - \text{Ergo})^2) - 15 \cdot \text{Weight}$），贴合游戏内实际开镜速度与枪口过冲物理机制。
- **冲突消解与整数可行性**：通过 LP 松弛、扰动分析与贪婪取整算法，精准处理复杂的配件树、互斥槽位、父级依赖与多槽位冲突。

### 硬性约束与改装定制
- **防止开镜过冲硬约束 (Prevent Overswing)**：利用一阶切线割平面精确约束 $W \le \text{Threshold}(E_{\text{eff}}) \iff \text{EED} \ge 0$，确保在快速开镜甩枪时绝无晃动过冲。
- **装备人机惩罚系数 ($b$)**：可自定义 $-40\%$ 至 $0\%$ 的护甲/头盔/背包负重惩罚，确保实战全装状态下的零过冲。
- **属性上下限**：可设定最大垂直后坐力、最低人机工效、最大重量 (kg) 及预算上限 (₽)。
- **精度与 MOA 限制**：采用 BSG 游戏内真实精度换算常数 ($K \approx 34.3$) 与可替换枪管规则，支持设定最大 MOA 散布上限。
- **功能性约束**：支持指定最低弹匣容量、最低瞄准距离及口径转换方案。
- **商人等级与跳蚤过滤**：根据你的 PMC 等级和商人忠诚度等级 (LL1–LL4) 过滤可购买配件，支持一键开关跳蚤市场。
- **预设保留与配件锁定**：一键保留武器自带原厂配件，支持锁定心仪配件（如特定光学瞄具/消音器）或排除不想要的配件。

### 分析图表与使用体验
- **AUGMECON2 加速 2D 帕累托前沿探索**：采用增广 $\epsilon$-约束与松弛绕过算法，极速绘制人机-后坐力、人机-价格、后坐力-价格权衡曲线。
- **实时 EED & EvoErgo 指标卡**：直观颜色编码（绿/红）展示开镜过冲状态与重量人机效率。
- **交互式原理与方法论指南**：内置 KaTeX 数学公式排版的算法与游戏物理机制解析文档。
- **100% 纯客户端运行**：无需后端，零延迟，无数据上传，支持离线与 PWA。
- **支持 16 种语言**：cs、de、en、es、fr、hu、it、ja、ko、pl、pt、ro、ru、sk、tr、zh。

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
