import UIKit
import WebKit

/// 整个 App 就是一层 WebView 壳，对应安卓版的 MainActivity。
///
/// 和安卓那版的主要差异：
///   1. 没有返回键——导航全靠页面内的 hash 路由（返回箭头在顶栏）；
///   2. 横屏由 Info.plist 的 UISupportedInterfaceOrientations 锁死，
///      不需要 sensorLandscape 那种运行时处理；
///   3. 系统栏在 iOS 上本来就瘦，状态栏隐藏 + Home 条自动淡出就够，
///      不用「沉浸式 + 挖孔」那一套（灵动岛区域交给页面 CSS 的 env() 处理）。
final class WebViewController: UIViewController {

    private var web: WKWebView!

    /// 和 app.css 的 --page 对齐：浅色 #f2f2f7、深色 #000000。
    /// 网页首帧画出来之前会露这个底色，配错就是启动时闪一下白（或黑）。
    private var pageBackground: UIColor {
        UIColor { trait in
            trait.userInterfaceStyle == .dark
                ? UIColor(red: 0, green: 0, blue: 0, alpha: 1)
                : UIColor(red: 0.949, green: 0.949, blue: 0.969, alpha: 1)
        }
    }

    /// 安卓壳通过 addJavascriptInterface 注入了 window.AndroidTTS（见 MainActivity.TtsBridge），
    /// 网页的 sound.js 只在音频 play() 被系统拦下时才退回它。iOS 没有这个对象，
    /// 这里补一个同签名的实现，网页代码一行都不用改。
    private var ttsShim: WKUserScript {
        let js = """
        (function () {
          if (window.AndroidTTS) { return; }
          var synth = window.speechSynthesis;
          window.AndroidTTS = {
            ready: function () { return !!synth; },
            speak: function (text) {
              if (!synth || !text) { return; }
              try {
                synth.cancel();   // 对应安卓的 QUEUE_FLUSH：连对时让新词上位，别排队
                var u = new SpeechSynthesisUtterance(String(text));
                u.lang = 'zh-CN';
                u.rate = 1.0;
                synth.speak(u);
              } catch (e) {}
            },
            stop: function () { if (synth) { try { synth.cancel(); } catch (e) {} } }
          };
        })();
        """
        return WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = pageBackground

        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []   // 音效是合成的，不需要每次点一下才出声
        config.userContentController.addUserScript(ttsShim)

        guard let wwwRoot = Bundle.main.url(forResource: "www", withExtension: nil) else {
            assertionFailure("包内找不到 www 目录——检查 XcodeGen 里 Resources/www 有没有配成 folder reference")
            return
        }
        config.setURLSchemeHandler(LocalSchemeHandler(root: wwwRoot),
                                   forURLScheme: LocalSchemeHandler.scheme)

        web = WKWebView(frame: .zero, configuration: config)
        web.translatesAutoresizingMaskIntoConstraints = false
        web.isOpaque = false
        web.backgroundColor = pageBackground
        web.scrollView.backgroundColor = pageBackground
        // 安全区交给页面 CSS：index.html 的 viewport 已经带 viewport-fit=cover，
        // app.css 里到处是 env(safe-area-inset-*)。这里再让 WKWebView 缩一次，
        // 灵动岛和 Home 条就会留双份边距。
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.allowsBackForwardNavigationGestures = false
        view.addSubview(web)

        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: view.topAnchor),
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            web.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        web.load(URLRequest(url: LocalSchemeHandler.startURL))
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        syncTheme()
    }

    /// 跟随系统深浅色。安卓版是 MainActivity.syncTheme() 给页面加 html.dark，
    /// iOS 走同一套：页面 CSS 里已经有 html.dark 的一整份配色。
    override func traitCollectionDidChange(_ previous: UITraitCollection?) {
        super.traitCollectionDidChange(previous)
        guard previous?.userInterfaceStyle != traitCollection.userInterfaceStyle else { return }
        view.backgroundColor = pageBackground
        web?.backgroundColor = pageBackground
        web?.scrollView.backgroundColor = pageBackground
        syncTheme()
    }

    private func syncTheme() {
        let dark = traitCollection.userInterfaceStyle == .dark
        web?.evaluateJavaScript("document.documentElement.classList.toggle('dark', \(dark));")
    }

    // 安卓版是全屏沉浸式（状态栏 + 导航栏都收起来），iOS 保持一致
    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .landscape }
}
