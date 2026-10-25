// Expo module `MetronomeClick` for iOS: the JS API of src/MetronomeClick.ts. An AVAudioPlayer plays the synthesized click (ClickSound.swift)
// in an AVAudioSession of category `.playback` with `.mixWithOthers`: other audio keeps playing at full volume, a mixable session never
// becomes the Now Playing app (remote commands stay with the music app), and the click follows the media route (a Bluetooth headset when
// one is connected) also with the ringer switch on silent. The session is active only between `start` and `stop`; `stop` deactivates it
// with `.notifyOthersOnDeactivation`. With the screen locked the click needs the `audio` background mode (app.json `UIBackgroundModes`).
//
// Every call is queued on one serial queue, so start, click and stop run in the order JS called them and never block JS.
#if canImport(ExpoModulesCore) && canImport(AVFoundation)
import AVFoundation
import ExpoModulesCore

public final class MetronomeClickModule: Module {
    private let queue = DispatchQueue(label: "com.joyodigitama.metronomeclick")
    // Touched only on `queue`.
    private var player: AVAudioPlayer?

    public func definition() -> ModuleDefinition {
        Name("MetronomeClick")

        // A JS reload must not leave the session active.
        OnDestroy {
            self.queue.async { self.close() }
        }

        Function("start") {
            self.queue.async { self.open() }
        }

        Function("click") {
            self.queue.async { self.play() }
        }

        Function("stop") {
            self.queue.async { self.close() }
        }
    }

    private func open() {
        guard player == nil else { return }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
            try session.setActive(true)
            let created = try AVAudioPlayer(data: ClickSound.wav(), fileTypeHint: AVFileType.wav.rawValue)
            created.prepareToPlay()
            player = created
        } catch {
            NSLog("MetronomeClick: start failed: \(error)")
        }
    }

    private func play() {
        guard let player else { return }
        player.currentTime = 0
        if player.play() { return }
        // An interruption (a call, Siri) deactivated the session: activate it again and retry once.
        do {
            try AVAudioSession.sharedInstance().setActive(true)
            player.play()
        } catch {
            NSLog("MetronomeClick: click failed: \(error)")
        }
    }

    private func close() {
        guard let player else { return }
        player.stop()
        self.player = nil
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        } catch {
            NSLog("MetronomeClick: deactivating the session failed: \(error)")
        }
    }
}
#endif
