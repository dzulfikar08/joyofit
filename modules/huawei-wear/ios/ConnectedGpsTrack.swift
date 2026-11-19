// Port of ConnectedGpsTrack.kt: retains phone Connected GPS trajectories recorded during a LiveWorkout session and merges them into
// synced WorkoutRecords from wearables without built-in GNSS (Huawei Band 8/9/10/11, etc., where trajectoriesData == 0).
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

public struct ConnectedGpsSession: Sendable {
    public let id: String
    public let startSec: Int64
    public let endSec: Int64
    public let sportType: Int?
    public let distanceM: Double
    public let riseM: Double
    public let points: [WorkoutLinkWire.Fix]

    public init(
        id: String,
        startSec: Int64,
        endSec: Int64,
        sportType: Int?,
        distanceM: Double,
        riseM: Double,
        points: [WorkoutLinkWire.Fix]
    ) {
        self.id = id
        self.startSec = startSec
        self.endSec = endSec
        self.sportType = sportType
        self.distanceM = distanceM
        self.riseM = riseM
        self.points = points
    }

    public var effectiveEndSec: Int64 {
        max(endSec, (points.last?.timeMs ?? 0) / 1000)
    }

    public func fixesInWindow(
        workoutStartSec: Int64,
        workoutEndSec: Int64,
        slackSec: Int64 = ConnectedGpsStore.matchSlackSec
    ) -> [WorkoutLinkWire.Fix] {
        let effectiveEnd = workoutEndSec > workoutStartSec ? workoutEndSec : effectiveEndSec
        let lo = workoutStartSec - slackSec
        let hi = effectiveEnd + slackSec
        var seenSecs = Set<Int64>()
        var result: [WorkoutLinkWire.Fix] = []
        for fix in points {
            let sec = fix.timeMs / 1000
            guard sec > 0, sec >= lo, sec <= hi,
                  fix.latitude.isFinite, fix.longitude.isFinite,
                  (-90.0...90.0).contains(fix.latitude), (-180.0...180.0).contains(fix.longitude)
            else { continue }
            if seenSecs.insert(sec).inserted {
                result.append(fix)
            }
        }
        return result
    }
}

public final class ConnectedGpsStore: @unchecked Sendable {
    public static let matchSlackSec: Int64 = 180
    public static let maxSessions = 20
    public static let retentionSec: Int64 = 7 * 86_400

    public static let shared: ConnectedGpsStore = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
        let url = base?.appendingPathComponent("connected_gps_tracks.json")
        return ConnectedGpsStore(storageURL: url)
    }()

    private let lock = NSLock()
    private let storageURL: URL?
    private var sessions: [ConnectedGpsSession] = []
    private let ioQueue = DispatchQueue(label: "com.joyodigitama.huaweiwear.connectedgps.io", qos: .utility)

    public init(storageURL: URL? = nil) {
        self.storageURL = storageURL
        loadFromDisk()
    }

    public func clear() {
        lock.locked {
            sessions.removeAll()
            if let url = storageURL { try? FileManager.default.removeItem(at: url) }
        }
    }

    public func upsert(_ session: ConnectedGpsSession, persist: Bool = true) {
        guard session.points.count >= 2, session.startSec > 0 else { return }
        if WorkoutSportTypes.isIndoor(session.sportType) { return }
        lock.locked {
            let cutoff = max(0, session.effectiveEndSec - Self.retentionSec)
            sessions.removeAll {
                $0.id == session.id || abs($0.startSec - session.startSec) <= 10 || $0.effectiveEndSec < cutoff
            }
            sessions.append(session)
            while sessions.count > Self.maxSessions {
                sessions.removeFirst()
            }
            if persist { saveToDiskLocked() }
        }
    }

    private func saveToDiskLocked() {
        guard let url = storageURL else { return }
        let snapshot = sessions
        ioQueue.async {
            do {
                var arr: [[String: Any]] = []
                for s in snapshot {
                    var ptsArr: [[String: Any]] = []
                    for p in s.points {
                        var po: [String: Any] = ["t": p.timeMs, "lat": p.latitude, "lon": p.longitude]
                        if let alt = p.altitude, alt.isFinite { po["alt"] = alt }
                        if let acc = p.accuracy, acc.isFinite { po["acc"] = acc }
                        if let spd = p.speed, spd.isFinite { po["spd"] = spd }
                        ptsArr.append(po)
                    }
                    var obj: [String: Any] = [
                        "id": s.id,
                        "startSec": s.startSec,
                        "endSec": s.endSec,
                        "distanceM": s.distanceM,
                        "riseM": s.riseM,
                        "points": ptsArr
                    ]
                    if let sport = s.sportType { obj["sportType"] = sport }
                    arr.append(obj)
                }
                let data = try JSONSerialization.data(withJSONObject: arr, options: [])
                let dir = url.deletingLastPathComponent()
                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                try data.write(to: url, options: .atomic)
            } catch {
                // Silently ignore disk write errors
            }
        }
    }

    private func loadFromDisk() {
        guard let url = storageURL, FileManager.default.fileExists(atPath: url.path) else { return }
        do {
            let data = try Data(contentsOf: url)
            guard let arr = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return }
            var loaded: [ConnectedGpsSession] = []
            for obj in arr.prefix(Self.maxSessions) {
                guard let id = obj["id"] as? String,
                      let startSec = (obj["startSec"] as? NSNumber)?.int64Value,
                      let endSec = (obj["endSec"] as? NSNumber)?.int64Value,
                      let ptsArr = obj["points"] as? [[String: Any]]
                else { continue }
                var pts: [WorkoutLinkWire.Fix] = []
                for p in ptsArr.prefix(TrackAccumulator.maxTrackPoints) {
                    guard let lat = (p["lat"] as? NSNumber)?.doubleValue,
                          let lon = (p["lon"] as? NSNumber)?.doubleValue,
                          lat.isFinite, lon.isFinite
                    else { continue }
                    let t = (p["t"] as? NSNumber)?.int64Value ?? 0
                    let alt = (p["alt"] as? NSNumber)?.doubleValue
                    let acc = (p["acc"] as? NSNumber)?.doubleValue
                    let spd = (p["spd"] as? NSNumber)?.doubleValue
                    pts.append(WorkoutLinkWire.Fix(
                        latitude: lat,
                        longitude: lon,
                        timeMs: t,
                        speed: spd,
                        altitude: alt,
                        bearing: nil,
                        accuracy: acc
                    ))
                }
                if pts.count >= 2 {
                    let sport = (obj["sportType"] as? NSNumber)?.intValue
                    let dist = (obj["distanceM"] as? NSNumber)?.doubleValue ?? 0.0
                    let rise = (obj["riseM"] as? NSNumber)?.doubleValue ?? 0.0
                    loaded.append(ConnectedGpsSession(
                        id: id,
                        startSec: startSec,
                        endSec: endSec,
                        sportType: sport,
                        distanceM: dist,
                        riseM: rise,
                        points: pts
                    ))
                }
            }
            lock.locked {
                self.sessions = loaded
            }
        } catch {
            // Silently ignore corrupted cache
        }
    }

    public func match(workoutStartSec: Int64, workoutEndSec: Int64, sportType: Int?) -> ConnectedGpsSession? {
        guard workoutStartSec > 0, !WorkoutSportTypes.isIndoor(sportType) else {
            return nil
        }
        return lock.locked {
            sessions
                .filter { s in
                    let effectiveEnd = workoutEndSec > workoutStartSec ? workoutEndSec : s.effectiveEndSec
                    let sportOk = sportType == nil || s.sportType == nil || s.sportType == sportType
                    let overlap = min(effectiveEnd + Self.matchSlackSec, s.effectiveEndSec)
                        - max(workoutStartSec - Self.matchSlackSec, s.startSec)
                    return sportOk && overlap > 0 && s.fixesInWindow(workoutStartSec: workoutStartSec, workoutEndSec: effectiveEnd).count >= 2
                }
                .max { a, b in
                    let effectiveEndA = workoutEndSec > workoutStartSec ? workoutEndSec : a.effectiveEndSec
                    let countA = a.fixesInWindow(workoutStartSec: workoutStartSec, workoutEndSec: effectiveEndA).count
                    let effectiveEndB = workoutEndSec > workoutStartSec ? workoutEndSec : b.effectiveEndSec
                    let countB = b.fixesInWindow(workoutStartSec: workoutStartSec, workoutEndSec: effectiveEndB).count
                    if countA != countB { return countA < countB }
                    return abs(a.startSec - workoutStartSec) > abs(b.startSec - workoutStartSec)
                }
        }
    }
}

public enum ConnectedGpsMerger {
    public static func merge(_ record: WorkoutRecord, store: ConnectedGpsStore = .shared) -> WorkoutRecord {
        if record.points.contains(where: { $0.lat != nil && $0.lon != nil }) { return record }
        let nominalEnd = record.end > record.start ? record.end : (record.duration > 0 ? record.start + Int64(record.duration) : 0)
        guard let session = store.match(workoutStartSec: record.start, workoutEndSec: nominalEnd, sportType: record.sportType) else {
            return record
        }
        let effectiveEnd = nominalEnd > record.start ? nominalEnd : session.effectiveEndSec
        let fixes = session.fixesInWindow(workoutStartSec: record.start, workoutEndSec: effectiveEnd, slackSec: 0)
        let windowStart = record.start
        let windowEnd = max(record.start, effectiveEnd)
        let validFixes = fixes.filter { ($0.timeMs / 1000) >= windowStart && ($0.timeMs / 1000) <= windowEnd }
        guard validFixes.count >= 2 else { return record }

        let gpsPoints: [WorkoutPoint] = validFixes.map { fix in
            WorkoutPoint(ts: fix.timeMs / 1000, lat: fix.latitude, lon: fix.longitude, alt: fix.altitude, hr: nil, speed: fix.speed)
        }
        var mergedPoints = record.points + gpsPoints
        mergedPoints.sort { $0.ts < $1.ts }

        let routeDist = session.distanceM > 0 ? session.distanceM : routeDistanceM(validFixes)
        let newDistance = record.distance > 0 ? record.distance : Int(routeDist.rounded())
        let updatedSummary = enrichSummaryJson(
            record.summaryJson,
            fixes: validFixes,
            gpsPointsCount: gpsPoints.count,
            distanceM: newDistance,
            durationSec: record.duration,
            riseM: session.riseM
        )

        return WorkoutRecord(
            number: record.number,
            start: record.start,
            end: record.end > record.start ? record.end : effectiveEnd,
            sportType: record.sportType,
            sportName: record.sportName,
            duration: record.duration,
            distance: newDistance,
            calories: record.calories,
            steps: record.steps,
            avgHr: record.avgHr,
            maxHr: record.maxHr,
            summaryJson: updatedSummary,
            points: mergedPoints,
            complete: record.complete
        )
    }

    public static func enrichSummaryJson(
        _ summaryJson: String,
        fixes: [WorkoutLinkWire.Fix],
        gpsPointsCount: Int,
        distanceM: Int,
        durationSec: Int,
        riseM: Double
    ) -> String {
        var obj = (try? JSONSerialization.jsonObject(with: Data(summaryJson.utf8)) as? [String: Any]) ?? [:]
        obj["gps"] = "ok"
        obj["gpsPoints"] = gpsPointsCount
        obj["gpsSource"] = "phone"
        if distanceM > 0, durationSec > 0 {
            let avgSpeed = Double(distanceM) / Double(durationSec)
            if (obj["avgSpeed"] as? Double ?? 0) <= 0 {
                obj["avgSpeed"] = (avgSpeed * 100).rounded() / 100
            }
            if (obj["avgPaceSecPerKm"] as? Int ?? 0) <= 0, avgSpeed > 0 {
                obj["avgPaceSecPerKm"] = Int((1000.0 / avgSpeed).rounded())
            }
        }
        if (obj["elevationGain"] as? Double ?? 0) <= 0, riseM > 0 {
            obj["elevationGain"] = (riseM * 10).rounded() / 10
        }
        let alts = fixes.compactMap { $0.altitude }.filter { $0.isFinite }
        if let minAlt = alts.min(), let maxAlt = alts.max() {
            if obj["minAltitude"] == nil || obj["minAltitude"] is NSNull {
                obj["minAltitude"] = (minAlt * 10).rounded() / 10
            }
            if obj["maxAltitude"] == nil || obj["maxAltitude"] is NSNull {
                obj["maxAltitude"] = (maxAlt * 10).rounded() / 10
            }
        }
        guard let data = try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys]),
              let str = String(data: data, encoding: .utf8)
        else { return summaryJson }
        return str
    }

    public static func routeDistanceM(_ fixes: [WorkoutLinkWire.Fix]) -> Double {
        guard fixes.count >= 2 else { return 0 }
        var sum = 0.0
        for i in 1 ..< fixes.count {
            sum += fixes[i - 1].distance(to: fixes[i])
        }
        return sum
    }
}
