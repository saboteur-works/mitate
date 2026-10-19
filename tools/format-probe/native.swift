import Foundation
import ImageIO
import AVFoundation
let dir = CommandLine.arguments[1]
let files = try! FileManager.default.contentsOfDirectory(atPath: dir).sorted()
func ms(_ t: Date) -> Int { Int(Date().timeIntervalSince(t) * 1000) }
for f in files {
  let url = URL(fileURLWithPath: dir).appendingPathComponent(f)
  let p = f.split(separator: "_").first!
  if p == "i" || p == "r" {
    var line = "IMG  \(f.padding(toLength: 22, withPad: " ", startingAt: 0))"
    guard let src = CGImageSourceCreateWithURL(url as CFURL, nil) else { print(line + " NOSOURCE"); continue }
    let t0 = Date()
    let full = CGImageSourceCreateImageAtIndex(src, 0, nil)
    line += full != nil ? " full=\(full!.width)x\(full!.height) \(ms(t0))ms" : " full=FAIL"
    // embedded thumbnail only (no full decode)
    let t1 = Date()
    let thumb = CGImageSourceCreateThumbnailAtIndex(src, 0, [kCGImageSourceCreateThumbnailFromImageIfAbsent: false, kCGImageSourceThumbnailMaxPixelSize: 4096, kCGImageSourceCreateThumbnailWithTransform: true] as CFDictionary)
    line += thumb != nil ? " embedded=\(thumb!.width)x\(thumb!.height) \(ms(t1))ms" : " embedded=none"
    let t2 = Date()
    let t512 = CGImageSourceCreateThumbnailAtIndex(src, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: 512, kCGImageSourceCreateThumbnailWithTransform: true] as CFDictionary)
    line += t512 != nil ? " thumb512 \(ms(t2))ms" : " thumb512=FAIL"
    print(line)
  } else if p == "v" || p == "a" {
    let asset = AVURLAsset(url: url)
    let sem = DispatchSemaphore(value: 0)
    var out = "AV   \(f.padding(toLength: 22, withPad: " ", startingAt: 0))"
    Task {
      do {
        let playable = try await asset.load(.isPlayable)
        let tracks = try await asset.load(.tracks)
        var desc: [String] = []
        for t in tracks {
          let fds = try await t.load(.formatDescriptions)
          let ok = try await t.load(.isPlayable)
          let cc = fds.first.map { CMFormatDescriptionGetMediaSubType($0) } ?? 0
          let s = String(bytes: [UInt8(cc >> 24 & 255), UInt8(cc >> 16 & 255), UInt8(cc >> 8 & 255), UInt8(cc & 255)], encoding: .ascii) ?? "?"
          desc.append("\(t.mediaType.rawValue):\(s)\(ok ? "" : "(unplayable)")")
        }
        out += " playable=\(playable) " + desc.joined(separator: " ")
      } catch { out += " ERROR \(error.localizedDescription)" }
      sem.signal()
    }
    sem.wait(); print(out)
  }
}
