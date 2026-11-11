// Outreach.app: a native window around the local web UI. On launch it starts
// the Node server and the WhatsApp bridge (unless they're already running),
// shows the UI in a WKWebView, and stops whatever it started on quit.
// Paths come from Info.plist, written by macos/build.sh.
import Cocoa
import WebKit

let info = Bundle.main.infoDictionary ?? [:]
let projectDir = info["OutreachProjectDir"] as? String ?? ""
let nodePath = info["OutreachNode"] as? String ?? "/opt/homebrew/bin/node"
let port = info["OutreachPort"] as? String ?? "3000"
let bridgeDir = projectDir + "/vendor/whatsapp-mcp/whatsapp-bridge"
let appURL = URL(string: "http://localhost:\(port)/")!
let logDir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/Outreach")

// True if anything answers HTTP at the URL (any status), false if nothing listens.
func isUp(_ url: String) -> Bool {
    var up = false
    let done = DispatchSemaphore(value: 0)
    var req = URLRequest(url: URL(string: url)!)
    req.timeoutInterval = 1
    URLSession.shared.dataTask(with: req) { _, res, _ in up = res != nil; done.signal() }.resume()
    done.wait()
    return up
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var started: [Process] = []

    func applicationDidFinishLaunching(_ note: Notification) {
        buildMenu()
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1100, height: 800),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "Outreach"
        window.minSize = NSSize(width: 420, height: 400)
        window.center()
        window.setFrameAutosaveName("OutreachMain")
        web = WKWebView(frame: .zero)
        web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground") // no white flash in dark mode
        window.contentView = web
        message("Starting…")
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        DispatchQueue.global().async { self.startServices() }
    }

    func startServices() {
        if !isUp("http://127.0.0.1:8080/api/history") {
            spawn(bridgeDir + "/whatsapp-bridge", [], cwd: bridgeDir, log: "whatsapp-bridge.log")
        }
        if !isUp("http://127.0.0.1:\(port)/api/status") {
            spawn(nodePath, ["--env-file-if-exists=.env", "server.js"], cwd: projectDir, log: "server.log")
        }
        for _ in 0..<40 where !isUp("http://127.0.0.1:\(port)/api/status") { Thread.sleep(forTimeInterval: 0.25) }
        DispatchQueue.main.async {
            if isUp("http://127.0.0.1:\(port)/api/status") { self.web.load(URLRequest(url: appURL)) }
            else { self.message("The Outreach server didn't start. See ~/Library/Logs/Outreach/server.log") }
        }
    }

    func spawn(_ exe: String, _ args: [String], cwd: String, log: String) {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: exe)
        p.arguments = args
        p.currentDirectoryURL = URL(fileURLWithPath: cwd)
        try? FileManager.default.createDirectory(at: logDir, withIntermediateDirectories: true)
        let logURL = logDir.appendingPathComponent(log)
        FileManager.default.createFile(atPath: logURL.path, contents: nil)
        let out = try? FileHandle(forWritingTo: logURL)
        p.standardOutput = out
        p.standardError = out
        p.standardInput = FileHandle.nullDevice
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
        p.environment = env
        do { try p.run(); started.append(p) } catch { NSLog("Outreach: could not start \(exe): \(error)") }
    }

    func message(_ text: String) {
        web.loadHTMLString("""
            <style>body{font:14px -apple-system,system-ui;color:#75746f;display:grid;place-items:center;height:90vh}
            @media(prefers-color-scheme:dark){body{color:#a3a29c}}</style><p>\(text)</p>
            """, baseURL: nil)
    }

    // Links to anything but the app itself open in the default browser.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.navigationType == .linkActivated, let url = action.request.url, url.host != appURL.host {
            NSWorkspace.shared.open(url)
            return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
    }

    // Stop only what this app started (SIGTERM lets both shut down cleanly).
    func applicationWillTerminate(_ note: Notification) {
        for p in started where p.isRunning { p.terminate() }
        for p in started { for _ in 0..<20 where p.isRunning { Thread.sleep(forTimeInterval: 0.1) } }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

    @objc func reload() { web.load(URLRequest(url: appURL)) }

    func buildMenu() {
        let main = NSMenu()
        func menu(_ title: String, _ items: [NSMenuItem]) {
            let item = NSMenuItem(), sub = NSMenu(title: title)
            items.forEach(sub.addItem)
            item.submenu = sub
            main.addItem(item)
        }
        func it(_ title: String, _ action: Selector?, _ key: String, _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
            let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
            i.keyEquivalentModifierMask = mods
            return i
        }
        menu("Outreach", [
            it("About Outreach", #selector(NSApplication.orderFrontStandardAboutPanel(_:)), ""),
            .separator(),
            it("Hide Outreach", #selector(NSApplication.hide(_:)), "h"),
            it("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
            .separator(),
            it("Quit Outreach", #selector(NSApplication.terminate(_:)), "q"),
        ])
        menu("Edit", [
            it("Undo", Selector(("undo:")), "z"),
            it("Redo", Selector(("redo:")), "z", [.command, .shift]),
            .separator(),
            it("Cut", #selector(NSText.cut(_:)), "x"),
            it("Copy", #selector(NSText.copy(_:)), "c"),
            it("Paste", #selector(NSText.paste(_:)), "v"),
            it("Select All", #selector(NSText.selectAll(_:)), "a"),
        ])
        let reloadItem = it("Reload Page", #selector(reload), "r")
        reloadItem.target = self
        menu("View", [reloadItem])
        menu("Window", [
            it("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"),
            it("Zoom", #selector(NSWindow.performZoom(_:)), ""),
        ])
        NSApp.mainMenu = main
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
