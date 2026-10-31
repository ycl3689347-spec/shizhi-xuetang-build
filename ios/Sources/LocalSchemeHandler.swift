import UIKit
import WebKit

/// 用自定义 scheme（`app://local/…`）加载包内网页，而不是 `file://`。
///
/// 为什么不用 file://：iOS 的 WKWebView 在 file:// 页面里 localStorage 不保证持久化
/// ——进度、错题本、连对记录、静音开关全都在 localStorage 里，重启就丢就白做了；
/// 而且 file:// 没有正常的 origin，fetch/XHR 会被当成跨域拦掉。
/// 换成自定义 scheme 之后页面有稳定的 origin，localStorage / IndexedDB 行为和
/// 安卓 WebView 里一致。
final class LocalSchemeHandler: NSObject, WKURLSchemeHandler {

    static let scheme = "app"
    static let host = "local"
    static var startURL: URL { URL(string: "app://local/index.html")! }

    private let root: URL

    /// - Parameter root: 包内 www 目录（Bundle.main 里的 folder reference）
    init(root: URL) {
        self.root = root.standardizedFileURL
        super.init()
    }

    private static let mimeTypes: [String: String] = [
        "html": "text/html; charset=utf-8",
        "htm": "text/html; charset=utf-8",
        "js": "application/javascript; charset=utf-8",
        "mjs": "application/javascript; charset=utf-8",
        "css": "text/css; charset=utf-8",
        "json": "application/json; charset=utf-8",
        "svg": "image/svg+xml",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "gif": "image/gif",
        "webp": "image/webp",
        "ico": "image/x-icon",
        "woff": "font/woff",
        "woff2": "font/woff2",
        "ttf": "font/ttf",
        "wav": "audio/wav",
        "mp3": "audio/mpeg"
    ]

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else { return }

        let path = URLComponents(url: url, resolvingAgainstBaseURL: false)?.path ?? "/"
        let relative = (path.isEmpty || path == "/") ? "index.html" : String(path.dropFirst())
        let target = root.appendingPathComponent(relative).standardizedFileURL

        // 目录穿越（app://local/../../etc/passwd）直接挡掉
        guard target.path.hasPrefix(root.path) else {
            finish(urlSchemeTask, url: url, status: 403, text: "forbidden")
            return
        }
        guard let data = try? Data(contentsOf: target) else {
            finish(urlSchemeTask, url: url, status: 404, text: "not found")
            return
        }

        // MIME 必须给对。给成 application/octet-stream 的话 WKWebView 会把 js/css 当下载，
        // 页面直接白屏——这是自定义 scheme 最常见的坑。
        let mime = LocalSchemeHandler.mimeTypes[target.pathExtension.lowercased()]
            ?? "application/octet-stream"

        guard let resp = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                         headerFields: [
                                            "Content-Type": mime,
                                            "Content-Length": "\(data.count)",
                                            "Cache-Control": "no-cache"
                                         ]) else { return }
        urlSchemeTask.didReceive(resp)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // 本地文件读取是一次性的，没有可取消的东西
    }

    private func finish(_ task: WKURLSchemeTask, url: URL, status: Int, text: String) {
        let body = Data(text.utf8)
        guard let resp = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1",
                                         headerFields: [
                                            "Content-Type": "text/plain; charset=utf-8",
                                            "Content-Length": "\(body.count)"
                                         ]) else { return }
        task.didReceive(resp)
        task.didReceive(body)
        task.didFinish()
    }
}
