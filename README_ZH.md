# 塔科夫武器模组优化器 🔫

[English](README.md) | [中文](README_ZH.md)

专为《逃离塔科夫》打造的高级武器改装优化工具。该工具利用 **约束规划**（通过 Google OR-Tools CP-SAT求解器），根据您的优先级和限制条件，为您找到任何武器在数学上的最优改装方案。

![项目概览](https://img.shields.io/badge/Tarkov-Optimizer-blue.svg)
![Python](https://img.shields.io/badge/Python-3.10%2B-blue.svg)
![Streamlit](https://img.shields.io/badge/Streamlit-1.30%2B-red.svg)
![平台](https://img.shields.io/badge/平台-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)
[![GitHub Actions](https://github.com/AhaiMk01/tarkov-weapon-optimizer/actions/workflows/build.yml/badge.svg)](https://github.com/AhaiMk01/tarkov-weapon-optimizer/actions)
[![下载](https://img.shields.io/badge/下载-Releases-green.svg)](https://github.com/AhaiMk01/tarkov-weapon-optimizer/releases)

## 🚀 主要功能

- **寻找最优改装**: 使用加权目标函数在 **人机工效**、**后坐力** 和 **价格** 之间取得平衡。
- **帕累托前沿探索**: 可视化不同属性（例如后坐力 vs 价格）之间的权衡曲线，在优化前了解可达到的效果。
- **硬性约束**: 设置严格的要求，例如：
    - 预算限制 (₽)
    - 最低人机工效
    - 最大垂直后坐力
    - 最小弹匣容量
    - 最小瞄准距离
    - 最大重量 (kg)
- **智能可用性过滤**:
    - 根据 PMC 等级过滤。
    - 开启/关闭跳蚤市场访问。
    - 设置各个商人的忠诚度等级 (LL1-LL4)。
- **预设支持**: 处理武器预设（捆绑包），并识别构建武器的最便宜方式。
- **多语言支持**: 完全本地化支持 **English**、**Русский** 和 **中文**。
- **导出**: 将您的改装方案保存为 JSON 用于数据分析，或保存为 Markdown 用于在 Discord/论坛上分享。

## 🛠️ 技术栈

- **前端**: [Streamlit](https://streamlit.io/)
- **求解器**: [Google OR-Tools (CP-SAT)](https://developers.google.com/optimization)
- **数据源**: [Tarkov.dev GraphQL API](https://tarkov.dev/api/)
- **可视化**: Plotly, Altair, 和 Pandas

## 📥 安装指南

### 下载预编译版本
从 [**Releases 页面**](https://github.com/AhaiMk01/tarkov-weapon-optimizer/releases) 下载最新版本。无需安装 - 直接运行可执行文件即可。

### 使用 Pixi (推荐)
如果您已安装 [pixi](https://pixi.sh/)：
```bash
pixi run start
```

### 使用 pip
1. 克隆仓库。
2. 安装依赖：
```bash
pip install -r requirements.txt
```
3. 运行应用程序：
```bash
streamlit run app.py
```

## 📖 使用说明

1. **选择武器**: 从侧边栏的可用武器列表中选择一把武器。
2. **配置权限**: 设置您的 PMC 等级和商人等级，以确保优化器仅建议您实际可以购买的物品。
3. **设置约束**: 使用 **硬性约束** 侧边栏设置您的预算或性能要求。
4. **选择权重**: 在 **优化配置** 选项卡中，使用三角形权重选择器来优先考虑人机、后坐力或价格。
5. **优化**: 点击 **优化配置** 运行求解器。几秒钟内，您将获得最佳的配置方案。

## 🤝 贡献

欢迎贡献代码！请随时提交 Pull Request。

## 📜 许可证

本项目仅供教育和个人使用。所有数据由 [Tarkov.dev](https://tarkov.dev/) 提供。
