import AppKit
let pid = pid_t(CommandLine.arguments[1])!
if let a = NSRunningApplication(processIdentifier: pid) { print("activationPolicy(0=regular,1=accessory,2=prohibited):", a.activationPolicy.rawValue, "hidden:", a.isHidden) } else { print("no app") }
