import AppKit
import Foundation

let scriptURL = URL(fileURLWithPath: #filePath)
let desktopRoot = scriptURL.deletingLastPathComponent().deletingLastPathComponent()
let assets = desktopRoot.appendingPathComponent("assets", isDirectory: true)
let sourceURL = assets.appendingPathComponent("icon.svg")
let source = try String(contentsOf: sourceURL, encoding: .utf8)

func replacingColor(_ source: String, from: String, to: String) throws -> String {
  let count = source.components(separatedBy: from).count - 1
  guard count == 1 else {
    throw NSError(domain: "IconGenerator", code: 1, userInfo: [NSLocalizedDescriptionKey: "Expected one occurrence of \(from), found \(count)"])
  }
  return source.replacingOccurrences(of: from, with: to)
}

func pngData(svg: String, size: Int) throws -> Data {
  guard let image = NSImage(data: Data(svg.utf8)) else {
    throw NSError(domain: "IconGenerator", code: 2, userInfo: [NSLocalizedDescriptionKey: "Could not render SVG"])
  }
  image.size = NSSize(width: size, height: size)
  guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: size,
    pixelsHigh: size,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bitmapFormat: [],
    bytesPerRow: 0,
    bitsPerPixel: 0
  ) else {
    throw NSError(domain: "IconGenerator", code: 3, userInfo: [NSLocalizedDescriptionKey: "Could not allocate bitmap"])
  }
  NSGraphicsContext.saveGraphicsState()
  let graphicsContext = NSGraphicsContext(bitmapImageRep: bitmap)!
  NSGraphicsContext.current = graphicsContext
  image.draw(in: NSRect(x: 0, y: 0, width: size, height: size), from: .zero, operation: .copy, fraction: 1)
  graphicsContext.flushGraphics()
  NSGraphicsContext.restoreGraphicsState()
  guard let data = bitmap.representation(using: .png, properties: [:]) else {
    throw NSError(domain: "IconGenerator", code: 4, userInfo: [NSLocalizedDescriptionKey: "Could not encode PNG"])
  }
  return data
}

func writePNG(_ data: Data, to url: URL) throws {
  try data.write(to: url, options: .atomic)
}

func createICNS(svg: String, name: String) throws {
  let iconset = FileManager.default.temporaryDirectory.appendingPathComponent("bb-icon-\(UUID().uuidString).iconset", isDirectory: true)
  defer { try? FileManager.default.removeItem(at: iconset) }
  try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
  let sizes: [(String, Int)] = [
    ("icon_16x16.png", 16),
    ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32),
    ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128),
    ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256),
    ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512),
    ("icon_512x512@2x.png", 1024)
  ]
  for (filename, size) in sizes {
    try writePNG(pngData(svg: svg, size: size), to: iconset.appendingPathComponent(filename))
  }
  let output = assets.appendingPathComponent(name)
  let process = Process()
  process.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
  process.arguments = ["-c", "icns", iconset.path, "-o", output.path]
  try process.run()
  process.waitUntilExit()
  guard process.terminationStatus == 0 else {
    throw NSError(domain: "IconGenerator", code: Int(process.terminationStatus), userInfo: [NSLocalizedDescriptionKey: "iconutil failed for \(name)"])
  }
}

let nightly = try replacingColor(source, from: "#101722", to: "#17132A")
  .replacingOccurrences(of: "#65E4DA", with: "#C59BFF")
  .replacingOccurrences(of: "#F4F7FC", with: "#FFE8FA")

try writePNG(pngData(svg: source, size: 1024), to: assets.appendingPathComponent("icon.png"))
try writePNG(pngData(svg: source, size: 1024), to: assets.appendingPathComponent("icon-dev.png"))
try writePNG(pngData(svg: nightly, size: 1024), to: assets.appendingPathComponent("icon-nightly.png"))
try createICNS(svg: source, name: "icon.icns")
try createICNS(svg: nightly, name: "icon-nightly.icns")
