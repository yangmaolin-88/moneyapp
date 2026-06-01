---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 331a07b66c276b081f9a783c76e9c571_fd25fb205d6411f1b2415254002afed2
    ReservedCode1: S3sWGc908EXUm1OB+EdzlIuhVxxQ2hx3/5+6z22xVnces76nlDB6MtfhtiWlrUwW6+eiZcdPLRTJG3ZA6j+epcbTEJiAfIjKsrzLCKArOVPsxIoSf20y6orY/lQ53DWSdmi1jXrXGHWhX/I6Ed2XY8Lt4pG3UiJoI5rV7EB/Xz+IRadZGNz4id44U30=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 331a07b66c276b081f9a783c76e9c571_fd25fb205d6411f1b2415254002afed2
    ReservedCode2: S3sWGc908EXUm1OB+EdzlIuhVxxQ2hx3/5+6z22xVnces76nlDB6MtfhtiWlrUwW6+eiZcdPLRTJG3ZA6j+epcbTEJiAfIjKsrzLCKArOVPsxIoSf20y6orY/lQ53DWSdmi1jXrXGHWhX/I6Ed2XY8Lt4pG3UiJoI5rV7EB/Xz+IRadZGNz4id44U30=
---

# 小杨专属记账 v15.0 - iOS 部署指南

## 部署方式一：通过 Safari 直接使用
1. 将所有文件上传到支持 HTTPS 的服务器
2. 在 iPhone 的 Safari 中打开你的网址
3. 点击底部「分享」按钮 → 「添加到主屏幕」
4. 输入名称后点击「添加」

## 部署方式二：使用 GitHub Pages（免费）
1. 创建 GitHub 仓库，上传所有文件
2. Settings → Pages → 选择 main 分支 → Save
3. 等待几分钟后获得 `https://你的用户名.github.io/仓库名` 地址
4. 在 iPhone Safari 中打开该地址，按方式一添加到主屏幕

## 必需条件
- 网站必须使用 HTTPS（GitHub Pages 自带 HTTPS）
- index.html 必须包含完整的 PWA meta 标签

## 技术特性
- 支持离线使用（Service Worker 缓存）
- 独立窗口模式（无 Safari 工具栏）
- 适配 iPhone 刘海屏/灵动岛安全区
- iOS 原生风格交互
- 支持添加到主屏幕后像原生 App 一样使用
*（内容由AI生成，仅供参考）*
