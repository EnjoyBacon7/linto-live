// Usage: swift list-windows.swift <pid>   — lists all windows of a process (on-screen flag, layer, bounds, title)
import CoreGraphics
import Foundation
let pid = Int(CommandLine.arguments[1])!
let ws = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as! [[String: Any]]
for w in ws where (w[kCGWindowOwnerPID as String] as? Int) == pid {
  let b = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
  print("id=\(w[kCGWindowNumber as String] ?? "?") onscreen=\(w[kCGWindowIsOnscreen as String] ?? false) layer=\(w[kCGWindowLayer as String] ?? "?") \(b["Width"] ?? "?")x\(b["Height"] ?? "?")@\(b["X"] ?? "?"),\(b["Y"] ?? "?") title=\"\(w[kCGWindowName as String] ?? "")\"")
}
