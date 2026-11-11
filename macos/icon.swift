// Draws the app icon (1024px PNG): a rounded square in the email→WhatsApp
// accent colors with a white chat bubble. Usage: swift icon.swift out.png
import AppKit

let size = 1024.0
let image = NSImage(size: NSSize(width: size, height: size))
image.lockFocus()
let inset = size * 0.1
let rect = NSRect(x: inset, y: inset, width: size - 2 * inset, height: size - 2 * inset)
let bg = NSBezierPath(roundedRect: rect, xRadius: size * 0.18, yRadius: size * 0.18)
NSGradient(starting: NSColor(srgbRed: 0.18, green: 0.36, blue: 0.83, alpha: 1),
           ending: NSColor(srgbRed: 0.12, green: 0.56, blue: 0.35, alpha: 1))!.draw(in: bg, angle: -45)

// Chat bubble with a tail at the bottom left.
let bubble = NSBezierPath(roundedRect: NSRect(x: size * 0.27, y: size * 0.38, width: size * 0.46, height: size * 0.32),
                          xRadius: size * 0.09, yRadius: size * 0.09)
let tail = NSBezierPath()
tail.move(to: NSPoint(x: size * 0.33, y: size * 0.42))
tail.line(to: NSPoint(x: size * 0.29, y: size * 0.29))
tail.line(to: NSPoint(x: size * 0.45, y: size * 0.39))
tail.close()
NSColor.white.setFill()
bubble.fill()
tail.fill()

// Two lines of "text" inside the bubble.
NSColor(srgbRed: 0.18, green: 0.36, blue: 0.83, alpha: 0.85).setFill()
NSBezierPath(roundedRect: NSRect(x: size * 0.35, y: size * 0.57, width: size * 0.30, height: size * 0.045), xRadius: size * 0.02, yRadius: size * 0.02).fill()
NSColor(srgbRed: 0.12, green: 0.56, blue: 0.35, alpha: 0.85).setFill()
NSBezierPath(roundedRect: NSRect(x: size * 0.35, y: size * 0.48, width: size * 0.20, height: size * 0.045), xRadius: size * 0.02, yRadius: size * 0.02).fill()
image.unlockFocus()

let png = NSBitmapImageRep(data: image.tiffRepresentation!)!.representation(using: .png, properties: [:])!
try! png.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
