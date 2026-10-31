import UIKit

/// 不用 Scene 生命周期：一个窗口、一个 WebView，AppDelegate 里 setRoot 干净利落，
/// 主线程上的 window 也不会因为 Scene 重连而在切后台时被重建。
@main
final class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = WebViewController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
}
