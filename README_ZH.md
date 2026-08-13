# 塔科夫武器模组优化器 (Web 版)

[English](README.md) | [中文](README_ZH.md) | [Español](README_ES.md)

一个纯客户端的《逃离塔科夫》武器改装优化工具。它利用 WebAssembly (WASM) 和 HiGHS 求解器直接在浏览器中运行，根据你设定的优先级和限制条件，计算数学上最优的改装方案。

没有后端。所有计算逻辑，包括繁重的优化运算，都通过 WASM 在本地机器上完成。

![项目概览](https://img.shields.io/badge/Tarkov-Optimizer-blue.svg)
![React](https://img.shields.io/badge/React-19%2B-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue.svg)
![Vite](https://img.shields.io/badge/Vite-6%2B-purple.svg)
![WASM](https://img.shields.io/badge/WASM-Powered-orange.svg)

## 功能

求解过程在浏览器里跑，所以没有服务器延迟。它使用编译为 WebAssembly 的 HiGHS 线性规划求解器，按照你给出的权重在人机工效、后坐力和价格之间取得平衡。

线性规划松弛解是小数解，因此还有一步“贪婪取整”，把它转换成有效、无冲突且整数最优的配置。

有些取舍没法用一个数字概括，这时可以用帕累托前沿视图画出权衡曲线（例如人机工效与后坐力的对比），看清每个选择的代价。

可以设定的硬性约束：

- 预算限制 (₽)
- 最低人机工效
- 最大垂直后坐力
- 最小弹匣容量
- 最小瞄准距离
- 最大重量 (kg)

可购买范围会按你的 PMC 等级和商人忠诚度过滤，跳蚤市场也可以单独关掉。

界面已本地化为 16 种语言，包括 English、Русский、中文 和 Español。

## 技术栈

- 前端：[React](https://react.dev/)、[Vite](https://vitejs.dev/)、[TypeScript](https://www.typescriptlang.org/)
- UI 组件：[Ant Design](https://ant.design/) v6
- 求解器：[HiGHS](https://highs.dev/)，通过 WebAssembly 运行，流程为线性规划松弛 (LP Relaxation)、扰动 (Perturbation)、贪婪取整 (Greedy Rounding)
- 数据源：[Tarkov.dev JSON API](https://json.tarkov.dev/endpoints)

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
