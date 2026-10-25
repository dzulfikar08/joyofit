// Port of WorkoutSportTypes.kt (Derived from Gadgetbridge, AGPL-3.0-or-later): HuaweiWorkoutGbParser.HuaweiActivityType (Huawei sport type byte ->
// ActivityKind) and model/ActivityKind (isPaceActivity, isSwimActivity). Display names are GB's English strings for each ActivityKind.
import Foundation

/// One Huawei sport type: GB's `ActivityKind` constant name and its English display name.
public struct Sport: Equatable, Sendable {
    public let kind: String
    public let name: String
}

/// Maps the sport type byte of a workout (FitnessData 0x17/0x08 tag 0x14, read unsigned) to GB's names. Unknown types are shown as
/// `Workout (type N)`; GB maps them to `ActivityKind.UNKNOWN`.
public enum WorkoutSportTypes {
    public static let unknownKind = "UNKNOWN"

    private static let table: [Int: Sport] = [
        1: Sport(kind: "RUNNING", name: "Running"),
        2: Sport(kind: "WALKING", name: "Walking"),
        3: Sport(kind: "CYCLING", name: "Biking"),
        4: Sport(kind: "MOUNTAIN_HIKE", name: "Mountain Hike"),
        5: Sport(kind: "INDOOR_RUNNING", name: "Indoor Running"),
        6: Sport(kind: "POOL_SWIM", name: "Pool Swimming"),
        7: Sport(kind: "INDOOR_CYCLING", name: "Indoor Cycling"),
        8: Sport(kind: "SWIMMING_OPENWATER", name: "Swimming (Open water)"),
        11: Sport(kind: "TRAIL_RUN", name: "Trail run"),
        13: Sport(kind: "INDOOR_WALKING", name: "Indoor Walking"),
        14: Sport(kind: "HIKING", name: "Hiking"),
        21: Sport(kind: "JUMP_ROPING", name: "Jumping Rope"),
        22: Sport(kind: "FREE_DIVING", name: "Free Diving"),
        23: Sport(kind: "APNEA_TRAINING", name: "Apnea Training"),
        24: Sport(kind: "APNEA_TEST", name: "Apnea Test"),
        25: Sport(kind: "SCUBA_DIVING", name: "SCUBA Diving"),
        128: Sport(kind: "PINGPONG", name: "Ping Pong"),
        129: Sport(kind: "BADMINTON", name: "Badminton"),
        130: Sport(kind: "TENNIS", name: "Tennis"),
        131: Sport(kind: "SOCCER", name: "Soccer"),
        132: Sport(kind: "BASKETBALL", name: "Basketball"),
        133: Sport(kind: "VOLLEYBALL", name: "Volleyball"),
        134: Sport(kind: "ELLIPTICAL_TRAINER", name: "Elliptical Trainer"),
        135: Sport(kind: "ROWING_MACHINE", name: "Rowing Machine"),
        136: Sport(kind: "STEPPER", name: "Stepper"),
        137: Sport(kind: "YOGA", name: "Yoga"),
        138: Sport(kind: "PILATES", name: "Pilates"),
        139: Sport(kind: "AEROBICS", name: "Aerobics"),
        140: Sport(kind: "STRENGTH_TRAINING", name: "Strength Training"),
        141: Sport(kind: "SPINNING", name: "Spinning"),
        142: Sport(kind: "AIR_WALKER", name: "Air walker"),
        143: Sport(kind: "HIIT", name: "High-intensity Interval Training"),
        145: Sport(kind: "CROSSFIT", name: "Crossfit"),
        146: Sport(kind: "FUNCTIONAL_TRAINING", name: "Functional training"),
        147: Sport(kind: "PHYSICAL_TRAINING", name: "Physical training"),
        148: Sport(kind: "TAEKWONDO", name: "Taekwondo"),
        149: Sport(kind: "BOXING", name: "Boxing"),
        150: Sport(kind: "FREE_SPARRING", name: "Free sparring"),
        151: Sport(kind: "KARATE", name: "Karate"),
        152: Sport(kind: "FENCING", name: "Fencing"),
        153: Sport(kind: "BELLY_DANCE", name: "Belly dance"),
        154: Sport(kind: "JAZZ_DANCE", name: "Jazz dance"),
        155: Sport(kind: "LATIN_DANCE", name: "Latin dance"),
        156: Sport(kind: "BALLET", name: "Ballet"),
        157: Sport(kind: "CORE_TRAINING", name: "Core Training"),
        158: Sport(kind: "BODY_COMBAT", name: "Body combat"),
        159: Sport(kind: "KENDO", name: "Kendo"),
        160: Sport(kind: "HORIZONTAL_BAR", name: "Horizontal bar"),
        161: Sport(kind: "PARALLEL_BARS", name: "Parallel bars"),
        162: Sport(kind: "STREET_DANCE", name: "Street Dance"),
        163: Sport(kind: "ROLLER_SKATING", name: "Roller skating"),
        164: Sport(kind: "MARTIAL_ARTS", name: "Martial arts"),
        165: Sport(kind: "PLAZA_DANCING", name: "Plaza dancing"),
        166: Sport(kind: "TAI_CHI", name: "Tai chi"),
        167: Sport(kind: "DANCE", name: "Dance"),
        168: Sport(kind: "HULA_HOOP", name: "Hula hoop"),
        169: Sport(kind: "FRISBEE", name: "Frisbee"),
        170: Sport(kind: "DARTS", name: "Darts"),
        171: Sport(kind: "ARCHERY", name: "Archery"),
        172: Sport(kind: "HORSE_RIDING", name: "Horse riding"),
        173: Sport(kind: "LASER_TAG", name: "Laser tag"),
        174: Sport(kind: "KITE_FLYING", name: "Kite Flying"),
        175: Sport(kind: "TUG_OF_WAR", name: "Tug of war"),
        176: Sport(kind: "SWING", name: "Swing"),
        177: Sport(kind: "STAIRS", name: "Stairs"),
        178: Sport(kind: "OBSTACLE_RACE", name: "Obstacle race"),
        179: Sport(kind: "BILLIARD_POOL", name: "Pool"),
        180: Sport(kind: "BOWLING", name: "Bowling"),
        181: Sport(kind: "SHUTTLECOCK", name: "Shuttlecock"),
        182: Sport(kind: "HANDBALL", name: "Handball"),
        183: Sport(kind: "BASEBALL", name: "Baseball"),
        184: Sport(kind: "SOFTBALL", name: "Softball"),
        185: Sport(kind: "CRICKET", name: "Cricket"),
        186: Sport(kind: "RUGBY", name: "Rugby"),
        187: Sport(kind: "BEACH_SOCCER", name: "Beach Soccer"),
        188: Sport(kind: "BEACH_VOLLEYBALL", name: "Beach Volleyball"),
        189: Sport(kind: "GATEBALL", name: "Gateball"),
        190: Sport(kind: "HOCKEY", name: "Hockey"),
        191: Sport(kind: "SQUASH", name: "Squash"),
        192: Sport(kind: "SEPAK_TAKRAW", name: "Sepak Takraw"),
        193: Sport(kind: "DODGEBALL", name: "Dodgeball"),
        194: Sport(kind: "SAILING", name: "Sailing"),
        195: Sport(kind: "SURFING", name: "Surfing"),
        196: Sport(kind: "FISHING", name: "Fishing"),
        197: Sport(kind: "RAFTING", name: "Rafting"),
        198: Sport(kind: "DRAGON_BOAT", name: "Dragon boat"),
        199: Sport(kind: "CANOEING", name: "Canoeing"),
        200: Sport(kind: "ROWING", name: "Rowing"),
        201: Sport(kind: "WATER_SCOOTER", name: "Water scooter"),
        202: Sport(kind: "STAND_UP_PADDLEBOARDING", name: "Standup Paddleboarding"),
        203: Sport(kind: "ICE_SKATING", name: "Ice Skating"),
        204: Sport(kind: "ICE_HOCKEY", name: "Ice hockey"),
        205: Sport(kind: "CURLING", name: "Curling"),
        206: Sport(kind: "BOBSLEIGH", name: "Bobsleigh"),
        207: Sport(kind: "SLEDDING", name: "Sledding"),
        208: Sport(kind: "BIATHLON", name: "Biathlon"),
        209: Sport(kind: "SKATEBOARDING", name: "Skateboarding"),
        210: Sport(kind: "ROCK_CLIMBING", name: "Rock climbing"),
        211: Sport(kind: "BUNGEE_JUMPING", name: "Bungee jumping"),
        212: Sport(kind: "PARKOUR", name: "Parkour"),
        213: Sport(kind: "BMX", name: "BMX"),
        214: Sport(kind: "ORIENTEERING", name: "Orienteering"),
        215: Sport(kind: "PARACHUTING", name: "Parachuting"),
        216: Sport(kind: "AUTO_RACING", name: "Auto racing"),
        223: Sport(kind: "ESPORTS", name: "Esports"),
        224: Sport(kind: "PADEL", name: "Padel"),
        255: Sport(kind: "EXERCISE", name: "Exercise"),
    ]

    public static func sport(_ type: Int) -> Sport? { table[type & 0xFF] }

    public static func name(_ type: Int) -> String { sport(type)?.name ?? "Workout (type \(type & 0xFF))" }

    /// The first of `candidates` that is a code of the table: a status answer carries the sport in more than one tag, and only a known code is
    /// believed (WorkoutSportTypes.kt `pick`).
    public static func pick(_ candidates: Int?...) -> Int? { candidates.first { $0.map { sport($0) != nil } ?? false } ?? nil }

    /// GB `ActivityKind` constant name, `unknownKind` for types GB does not know.
    public static func kind(_ type: Int) -> String { sport(type)?.kind ?? unknownKind }

    /// GB `ActivityKind.isSwimActivity`.
    public static func isSwim(_ kind: String) -> Bool { kind.contains("SWIM") }

    /// GB `ActivityKind.isPaceActivity`: pace (time per distance) rather than speed is the natural figure.
    public static func isPace(_ kind: String) -> Bool {
        kind.contains("RUN") || kind.contains("SWIM") || kind.contains("TREADMILL") || kind.contains("WALK")
    }

    /// Free diving and scuba: the "elevation loss" is the maximum depth.
    public static func isDiving(_ kind: String) -> Bool { kind == "FREE_DIVING" || kind == "SCUBA_DIVING" }
}
