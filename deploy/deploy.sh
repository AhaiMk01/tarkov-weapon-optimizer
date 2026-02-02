#!/bin/bash

set -e

PROJECT_DIR="/root/tarkov-weapon-optimizer"
SERVICE_FILE="/etc/systemd/system/tarkov-optimizer.service"
API_PORT=15000

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_info() { echo -e "${BLUE}[信息]${NC} $1"; }
print_success() { echo -e "${GREEN}[成功]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[警告]${NC} $1"; }
print_error() { echo -e "${RED}[错误]${NC} $1"; }

load_env() {
    if [ -f "$PROJECT_DIR/.env" ]; then
        while IFS='=' read -r key value; do
            key=$(echo "$key" | xargs)
            [[ -z "$key" || "$key" == \#* ]] && continue
            value=$(echo "$value" | sed 's/^["'\'']//' | sed 's/["'\'']$//')
            case "$key" in
                API_PORT) API_PORT="$value" ;;
            esac
        done < "$PROJECT_DIR/.env"
    fi
    API_PORT="${API_PORT:-15000}"
}

check_root() {
    if [ "$EUID" -ne 0 ]; then
        print_error "请使用 root 用户运行此脚本"
        exit 1
    fi
}

install_uv() {
    if command -v uv &> /dev/null; then
        print_info "uv 已安装，跳过安装"
        return
    fi
    print_info "安装 uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
    print_success "uv 安装完成"
}

setup_backend() {
    print_info "配置后端环境..."
    cd "$PROJECT_DIR"
    uv sync
    print_success "后端环境配置完成"
}

setup_frontend() {
    print_info "构建前端..."
    cd "$PROJECT_DIR/frontend"
    npm install
    npm run build
    print_success "前端构建完成"
}

setup_env() {
    if [ ! -f "$PROJECT_DIR/.env" ]; then
        print_info "创建环境配置文件..."
        cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
        print_warning "请编辑 $PROJECT_DIR/.env 配置文件"
    else
        print_info "环境配置文件已存在"
    fi
}

setup_systemd() {
    print_info "配置 systemd 服务..."
    cp "$PROJECT_DIR/deploy/tarkov-optimizer.service" "$SERVICE_FILE"
    systemctl daemon-reload
    systemctl enable tarkov-optimizer
    print_success "systemd 服务配置完成"
}

do_install() {
    print_info "开始安装 Tarkov Weapon Optimizer..."
    echo ""
    install_uv
    setup_env
    setup_backend
    setup_frontend
    setup_systemd
    echo ""
    print_success "安装完成!"
    echo ""
    print_info "下一步操作:"
    echo "  1. 编辑配置文件: vim $PROJECT_DIR/.env"
    echo "  2. 启动服务: $0 start"
    echo "  3. 查看状态: $0 status"
}

do_start() {
    load_env
    print_info "启动服务..."
    systemctl start tarkov-optimizer
    print_info "等待服务就绪..."
    local count=0
    until curl -s "http://127.0.0.1:${API_PORT}/api/status" > /dev/null 2>&1; do
        sleep 1
        count=$((count + 1))
        if [ $count -ge 30 ]; then
            print_error "服务启动超时"
            exit 1
        fi
    done
    echo ""
    print_success "服务启动成功!"
    echo ""
    echo "  访问地址: http://127.0.0.1:${API_PORT}"
    echo "  查看状态: $0 status"
}

do_stop() {
    print_info "停止服务..."
    systemctl stop tarkov-optimizer 2>/dev/null || true
    echo ""
    print_success "服务已停止"
}

do_restart() {
    do_stop
    do_start
}

do_status() {
    load_env
    echo ""
    echo "======================================"
    echo "   Tarkov Weapon Optimizer 服务状态"
    echo "======================================"
    echo ""
    echo "Systemd 服务:"
    echo "--------------------------------------"
    echo -n "  API 服务: "
    if systemctl is-active --quiet tarkov-optimizer; then
        echo -e "${GREEN}运行中${NC}"
    else
        echo -e "${RED}已停止${NC}"
    fi
    echo ""
    echo "端口状态:"
    echo "--------------------------------------"
    printf "  API (%s): " "$API_PORT"
    if curl -s "http://127.0.0.1:${API_PORT}/api/status" > /dev/null 2>&1; then
        echo -e "${GREEN}正常${NC}"
    else
        echo -e "${RED}异常${NC}"
    fi
    echo ""
    echo "======================================"
    echo "常用命令:"
    echo "  查看日志: journalctl -u tarkov-optimizer -f"
    echo "  重启服务: $0 restart"
    echo "======================================"
    echo ""
}

do_remove() {
    echo ""
    print_warning "此操作将移除服务配置!"
    echo ""
    read -p "确认移除? (输入 'yes' 确认): " confirm
    if [ "$confirm" != "yes" ]; then
        print_info "已取消移除操作"
        exit 0
    fi
    echo ""
    print_info "停止服务..."
    systemctl stop tarkov-optimizer 2>/dev/null || true
    print_info "移除 systemd 服务..."
    systemctl disable tarkov-optimizer 2>/dev/null || true
    rm -f "$SERVICE_FILE"
    systemctl daemon-reload
    echo ""
    print_success "服务已移除"
    print_info "项目代码目录 $PROJECT_DIR 已保留"
}

show_usage() {
    echo ""
    echo "Tarkov Weapon Optimizer 部署脚本"
    echo ""
    echo "用法: $0 <命令>"
    echo ""
    echo "命令:"
    echo "  install   安装 (安装依赖、构建前端、配置服务)"
    echo "  start     启动服务"
    echo "  stop      停止服务"
    echo "  restart   重启服务"
    echo "  status    查看服务状态"
    echo "  remove    移除服务配置"
    echo ""
    echo "示例:"
    echo "  $0 install    # 首次安装"
    echo "  $0 start      # 启动服务"
    echo "  $0 status     # 查看状态"
    echo ""
}

check_root

case "$1" in
    install)
        do_install
        ;;
    start)
        do_start
        ;;
    stop)
        do_stop
        ;;
    restart)
        do_restart
        ;;
    status)
        do_status
        ;;
    remove|uninstall)
        do_remove
        ;;
    *)
        show_usage
        exit 1
        ;;
esac
