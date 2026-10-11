import UIKit
import UniformTypeIdentifiers

// "Share to Grammie" from Safari, Instagram, TikTok, Photos and so on.
//
// The extension does as little as possible (share extensions get very little
// memory): it copies shared photos into the App Group container as they are
// (no decoding or resizing), keeps shared links and text as strings, writes a
// small summary to the App Group's UserDefaults under "share-target-data", and
// opens Grammie with grammie://share. @capgo/capacitor-share-target reads the
// summary in the app and hands it to client/src/native/share-intake.ts, which
// starts the same import as pasting a link or choosing photos.
//
// If iOS doesn't let the extension open the app, the summary waits in the App
// Group and the plugin picks it up the next time Grammie comes to the front.

class ShareViewController: UIViewController {
    private let appGroupId = "group.ai.grammie.app"
    private let appURL = URL(string: "grammie://share")!
    private let maxImages = 10
    private let sharedFolder = "shared"

    private var texts: [String] = []
    private var files: [[String: Any]] = []
    private let lock = NSLock()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        clearOldFiles()

        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        let providers = items.flatMap { $0.attachments ?? [] }
        let title = items.first?.attributedContentText?.string ?? ""
        if providers.isEmpty {
            finish()
            return
        }

        let group = DispatchGroup()
        var imageCount = 0
        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                imageCount += 1
                if imageCount > maxImages { continue }
                group.enter()
                saveImage(provider) { group.leave() }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                group.enter()
                provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { item, _ in
                    if let url = item as? URL, !url.isFileURL {
                        self.add(text: url.absoluteString)
                    } else if let string = item as? String {
                        self.add(text: string)
                    }
                    group.leave()
                }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                group.enter()
                provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { item, _ in
                    if let string = item as? String {
                        self.add(text: string)
                    } else if let data = item as? Data, let string = String(data: data, encoding: .utf8) {
                        self.add(text: string)
                    }
                    group.leave()
                }
            }
        }

        group.notify(queue: .main) {
            // Instagram and TikTok share the caption and the link as two items;
            // the post text (when there is one) helps people recognise it
            if !title.isEmpty && !self.texts.contains(title) {
                self.texts.append(title)
            }
            self.save(title: title)
            self.openApp()
            self.finish()
        }
    }

    // MARK: - Photos

    private func saveImage(_ provider: NSItemProvider, done: @escaping () -> Void) {
        // A file copy keeps the photo exactly as it was (HEIC, full size); the
        // app shrinks it the same way it shrinks photos chosen in the app
        provider.loadFileRepresentation(forTypeIdentifier: UTType.image.identifier) { url, _ in
            if let url = url, let saved = self.copyIntoGroup(url) {
                self.add(file: saved)
                done()
                return
            }
            // Some apps only hand over the image itself
            provider.loadItem(forTypeIdentifier: UTType.image.identifier, options: nil) { item, _ in
                if let url = item as? URL, let saved = self.copyIntoGroup(url) {
                    self.add(file: saved)
                } else if let data = item as? Data, let saved = self.write(data, ext: "jpg") {
                    self.add(file: saved)
                } else if let image = item as? UIImage, let data = image.jpegData(compressionQuality: 0.9),
                          let saved = self.write(data, ext: "jpg") {
                    self.add(file: saved)
                }
                done()
            }
        }
    }

    private func groupFolder() -> URL? {
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId) else {
            return nil
        }
        let folder = container.appendingPathComponent(sharedFolder, isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder
    }

    private func copyIntoGroup(_ source: URL) -> [String: Any]? {
        guard let folder = groupFolder() else { return nil }
        let ext = source.pathExtension.isEmpty ? "jpg" : source.pathExtension.lowercased()
        let target = folder.appendingPathComponent("\(UUID().uuidString).\(ext)")
        do {
            try FileManager.default.copyItem(at: source, to: target)
        } catch {
            return nil
        }
        return describe(target, name: source.lastPathComponent)
    }

    private func write(_ data: Data, ext: String) -> [String: Any]? {
        guard let folder = groupFolder() else { return nil }
        let target = folder.appendingPathComponent("\(UUID().uuidString).\(ext)")
        do {
            try data.write(to: target)
        } catch {
            return nil
        }
        return describe(target, name: target.lastPathComponent)
    }

    private func describe(_ url: URL, name: String) -> [String: Any] {
        let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "image/jpeg"
        return ["uri": url.absoluteString, "name": name, "mimeType": mime]
    }

    /// Shares the app never opened shouldn't fill the phone
    private func clearOldFiles() {
        guard let folder = groupFolder(),
              let entries = try? FileManager.default.contentsOfDirectory(
                at: folder, includingPropertiesForKeys: [.creationDateKey]) else { return }
        let dayAgo = Date().addingTimeInterval(-24 * 60 * 60)
        for entry in entries {
            let created = (try? entry.resourceValues(forKeys: [.creationDateKey]))?.creationDate ?? Date()
            if created < dayAgo {
                try? FileManager.default.removeItem(at: entry)
            }
        }
    }

    // MARK: - Hand-off

    private func add(text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        lock.lock()
        if !texts.contains(trimmed) { texts.append(trimmed) }
        lock.unlock()
    }

    private func add(file: [String: Any]) {
        lock.lock()
        files.append(file)
        lock.unlock()
    }

    private func save(title: String) {
        guard let defaults = UserDefaults(suiteName: appGroupId) else { return }
        let data: [String: Any] = ["title": title, "texts": texts, "files": files]
        defaults.set(data, forKey: "share-target-data")
        defaults.synchronize()
    }

    private func openApp() {
        // Extensions can't call UIApplication.shared; walk the responder chain
        // to the application and ask it to open Grammie
        var responder: UIResponder? = self
        while let current = responder {
            if let application = current as? UIApplication {
                application.open(appURL, options: [:], completionHandler: nil)
                return
            }
            responder = current.next
        }
    }

    private func finish() {
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
}
