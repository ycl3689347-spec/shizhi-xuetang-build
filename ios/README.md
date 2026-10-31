# 拾知学堂 · iOS 版

安卓版（`android/`）的同一套网页，套一层 WKWebView 壳。功能、题库、界面完全一致，
只是外层从 `MainActivity.java` 换成了 `WebViewController.swift`。

## 先说清楚：为什么不能在 Windows 上直接出 ipa

iOS 应用的 `.app` 里必须有一个 **arm64 Mach-O 可执行文件**，它只能用 Apple 的
clang + iOS SDK 编译，并且要用 Apple 签发的证书签名、配一份绑定了设备 UDID 的
provisioning profile。缺任何一样，iOS 会直接拒绝启动。所以出 ipa 必须有 macOS。

本机是 Windows，于是拆成两步：

```
GitHub Actions（macOS 机器）        你的 Windows
编译 + 打包成未签名 ipa   ──────▶   Sideloadly 用免费 Apple ID 签名并装进手机
```

**未签名 ipa 不能直接双击安装**，第二步是必须的。免费 Apple ID 签出来的 app
有效期 7 天，到期重签一次即可（数据不会丢，进度存在 app 的 localStorage 里，
重签覆盖安装不会清除）。

---

## 路线一：云编译（当前可用）

> **现状（2026-10-31）**：这条线跑在 `ycl3689347-spec/shizhi-xuetang-build` 这个
> 专用仓库的 `ios-build` 分支上。它只是「把 `ios/` + 最新网页资源凑齐了送去编译」，
> 不承载题库主线，所以是单提交快照（原仓库 `cn-math-taxonomy` 是浅克隆，历史对象
> 不全，推送会报 `did not receive expected object`）。
>
> 两处必须记住的坑：
>
> 1. **runner 必须 `macos-15` 起步**。XcodeGen 2.46 生成的是 `objectVersion = 77`
>    （Xcode 16 的工程格式），`macos-14` 那台只有 Xcode 15.4，会直接报
>    `cannot be opened because it is in a future Xcode project file format (77)`。
>    workflow 里另外加了一层兜底：generate 完若仍是 77，就 `sed` 降成 56。
> 2. **改完 workflow 要走普通提交推**。force push 一份全新历史时，GitHub 算不出
>    前后 diff，`paths` 过滤会判成「没有相关改动」，构建不会启动。

### 1. 推代码触发构建

```bash
git add ios .github .gitignore
git commit -m "ios: 新增 iOS 版 WKWebView 壳与云编译流程"
git push
```

推上去后进 GitHub 仓库 → **Actions** 标签 → 左边选 `build-ios-ipa` →
右上 **Run workflow**。大约 3~5 分钟跑完。

> 只改了网页（`android/app/assets/www/`）也会自动触发——iOS 侧每次都从安卓侧
> 同步最新网页，不会出现两个版本对不上的情况。

### 2. 下载产物

构建页面底部 **Artifacts** → `ShizhiXuetang-unsigned-ipa`，解压得到
`ShizhiXuetang-unsigned.ipa`。

### 3. Windows 上签名安装

1. 装 **iTunes**（必须从 apple.com 下载的桌面版，Microsoft Store 那个版本
   Sideloadly 认不到设备）
2. 装 **Sideloadly**（sideloadly.io，免费）
3. iPhone 用数据线连电脑，「信任此电脑」
4. iPhone 上开 **设置 → 隐私与安全性 → 开发者模式**（iOS 16+ 必须，装完会提示
   重启一次；不开发者模式的话 app 装上了也点不开）
5. Sideloadly 里把 ipa 拖进去，Apple ID 填你的（免费账号就行），点 Start
6. 输入 Apple ID 密码，等手机弹出双重认证就填验证码
7. 装完手机上 **设置 → 通用 → VPN与设备管理 → 开发者应用**，点你的 Apple ID
   → 信任
8. 回桌面点开图标

> 想省掉每 7 天手动重签：装 **AltStore**（Windows 版 AltServer 常驻电脑，
> 同一 Wi-Fi 下会自动续签）。限制是一样的，只是自动化了。

免费账号的限制：**7 天有效期、最多同时 3 个自签 app、必须有开发者模式**。
想要 1 年有效期或上架 App Store，需要 688 元/年的 Apple Developer Program。

---

## 路线二：有 Mac 时（更省事）

```bash
brew install xcodegen
cd ios
bash scripts/prepare.sh     # 从 android/app/assets/www 同步网页
xcodegen generate
open ShizhiXuetang.xcodeproj
```

Xcode 里选 iPhone 14 Pro Max 模拟器直接 ⌘R 就能跑，不需要任何账号。
装真机则在 Signing & Capabilities 里选自己的 Team（免费 Apple ID 也行），
接上手机 ⌘R。

要正式 ipa：Product → Archive → Distribute App。

---

## 代码结构

```
ios/
├── project.yml                  XcodeGen 工程描述（改配置改这里，别手改 .xcodeproj）
├── Sources/
│   ├── AppDelegate.swift        建窗口、挂 WebViewController
│   ├── WebViewController.swift  WKWebView 壳：锁横屏、隐藏状态栏、跟系统深浅色、TTS 垫片
│   ├── LocalSchemeHandler.swift 用 app:// 加载包内网页（不用 file://，见下）
│   └── Info.plist               横屏锁定、启动屏、图标声明
├── Resources/
│   ├── Assets.xcassets/         AppIcon（1024 单尺寸）+ 启动底色
│   └── www/                     构建时从 android/app/assets/www 同步，不进 git
└── scripts/
    ├── prepare.sh               同步网页资源
    └── make-icon.js             从安卓那套图标源图生成 iOS 用的 1024 方图
```

## 几个必须知道的坑

**为什么用 `app://` 而不是 `file://` 加载网页。** iOS 的 WKWebView 在 `file://`
页面里 localStorage 不保证持久化——而这个应用的进度、错题本、连对记录、静音开关
全在 localStorage。换成自定义 scheme 后页面有了稳定 origin，行为和安卓 WebView
一致。`LocalSchemeHandler` 里的 MIME 表也不能省：给成 `application/octet-stream`
的话 WKWebView 会把 js/css 当下载，页面直接白屏。

**横屏锁定。** 靠 `Info.plist` 的 `UISupportedInterfaceOrientations` 只留两个横屏，
代码里的 `supportedInterfaceOrientations` 是兜底。iPhone 14 Pro Max 横屏是
932×430 CSS，已经过 16 档视口 + 13 档答题页的自动检查，零溢出。

**安全区。** `index.html` 的 viewport 带 `viewport-fit=cover`，`app.css` 里用
`env(safe-area-inset-*)` 处理灵动岛和 Home 条。所以 WKWebView 这边设的是
`contentInsetAdjustmentBehavior = .never`，让页面自己算——否则会留双份边距。

**朗读。** 网页调的是 `window.AndroidTTS.speak(text)`（安卓壳用原生 TTS 实现）。
iOS 没有这个对象，`WebViewController` 在 documentStart 注入了一个基于
`speechSynthesis` 的同签名实现，网页代码一行没改。振动走 `navigator.vibrate`，
iOS 不支持，静默失败——不影响做答。

**图标。** 安卓那套是圆角蒙版 + 各档 mipmap，iOS 只认一张 1024×1024 方图，圆角
由系统裁。`make-icon.js` 从 `android/shots/icon-src-shizhi-cream.png` 裁图案重新
出图，别直接拿安卓的 192px 图标放大。
