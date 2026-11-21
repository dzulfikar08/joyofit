/**
 * Health Kit workout types ("Workout Type Constants", docs/huawei-health-kit.md) mapped to JoyoFit's sport bytes
 * (`workouts.sport_type`, the watch's own codes in `WorkoutSportTypes.kt`). A Health Kit type that is not listed is stored as
 * `EXERCISE` (255), the watch's own catch-all, and its Health Kit number is kept in `summary_json.huaweiActivityType`.
 *
 * `SPORTS` repeats the rows of `WorkoutSportTypes.kt` this file uses (kind and English name); `sports.test.ts` checks they match.
 */

/** The watch's "Exercise": every sport JoyoFit does not name. */
export const OTHER_SPORT = 255;

/** Health Kit `activityType` -> JoyoFit sport byte. The comment is Health Kit's name of the type. */
export const HEALTH_KIT_SPORTS: Readonly<Record<number, number>> = {
  1: 139, // aerobics
  2: 171, // archery
  3: 129, // badminton
  4: 183, // baseball
  5: 132, // basketball
  6: 208, // biathlon
  7: 149, // boxing
  10: 185, // cricket
  12: 205, // curling
  13: 3, // cycling
  14: 167, // dancing
  17: 134, // elliptical
  20: 152, // fencing
  23: 131, // football.soccer
  24: 169, // flying_disc
  28: 182, // handball
  29: 143, // interval_training.high_intensity
  30: 14, // hiking
  31: 190, // hockey
  32: 172, // horse_riding
  34: 203, // ice_skating
  37: 21, // jumping_rope
  38: 199, // kayaking
  40: 148, // taekwondo
  42: 164, // martial_arts
  45: 2, // on_foot
  49: 138, // pilates
  52: 210, // rock_climbing
  53: 200, // rowing
  54: 135, // rowing.machine
  55: 186, // rugby
  56: 1, // running
  57: 5, // running.machine
  58: 194, // sailing
  59: 25, // scuba_diving
  61: 209, // skateboarding
  62: 203, // skating
  64: 207, // sledding
  73: 184, // softball
  74: 191, // squash
  75: 177, // stair_climbing
  77: 202, // standup_paddleboarding
  79: 140, // strength_training
  80: 195, // surfing
  81: 8, // swimming
  82: 8, // swimming.open_water
  83: 6, // swimming.pool
  84: 128, // table_tennis
  86: 130, // tennis
  88: 133, // volleyball
  90: 2, // walking
  95: 137, // yoga
  97: 7, // cycling_indoor
  98: 170, // darts
  99: 179, // billiards
  100: 181, // shuttlecock
  101: 180, // bowling
  103: 175, // tug_of_war
  104: 187, // beach_soccer
  105: 188, // beach_volleyball
  106: 189, // gateball
  107: 192, // sepaktakraw
  108: 193, // dodge_ball
  109: 136, // treadmill (stair stepper)
  110: 141, // spinning
  111: 142, // stroll_machine
  112: 145, // cross_fit
  113: 146, // functional_training
  114: 147, // physical_training
  115: 153, // belly_dance
  116: 154, // jazz
  117: 155, // latin
  118: 156, // ballet
  119: 157, // core_training
  120: 160, // horizontal_bar
  121: 161, // parallel_bars
  122: 162, // hip_hop
  123: 165, // square_dance
  124: 168, // hu_la_hoop
  125: 213, // bmx
  126: 214, // orienteering
  127: 13, // indoor_walk
  128: 5, // indoor_running
  129: 4, // mountain_climbing
  130: 11, // cross_country_race
  131: 163, // roller_skating
  133: 174, // fly_a_kite
  134: 176, // swing
  135: 178, // obstacle_race
  136: 211, // bungee_jumping
  137: 212, // parkour
  138: 215, // parachute
  139: 216, // racing_car
  141: 204, // ice_hockey
  143: 207, // sled
  144: 196, // fishing
  145: 197, // drifting
  146: 198, // dragon_boat
  147: 201, // motorboat
  148: 202, // sup
  149: 150, // free_sparring
  150: 151, // karate
  151: 158, // body_combat
  152: 159, // kendo
  153: 166, // tai_chi
  154: 22, // freediving
  155: 23, // apnea_training
  156: 24, // apnea_test
  159: 223, // e_sports
  160: 224, // cage_tennts (padel)
  161: 1, // marathon
};

/** JoyoFit sport byte -> [Gadgetbridge `ActivityKind`, English name], the rows of `WorkoutSportTypes.kt` used above. */
export const SPORTS: Readonly<Record<number, readonly [string, string]>> = {
  1: ['RUNNING', 'Running'],
  2: ['WALKING', 'Walking'],
  3: ['CYCLING', 'Biking'],
  4: ['MOUNTAIN_HIKE', 'Mountain Hike'],
  5: ['INDOOR_RUNNING', 'Indoor Running'],
  6: ['POOL_SWIM', 'Pool Swimming'],
  7: ['INDOOR_CYCLING', 'Indoor Cycling'],
  8: ['SWIMMING_OPENWATER', 'Swimming (Open water)'],
  11: ['TRAIL_RUN', 'Trail run'],
  13: ['INDOOR_WALKING', 'Indoor Walking'],
  14: ['HIKING', 'Hiking'],
  21: ['JUMP_ROPING', 'Jumping Rope'],
  22: ['FREE_DIVING', 'Free Diving'],
  23: ['APNEA_TRAINING', 'Apnea Training'],
  24: ['APNEA_TEST', 'Apnea Test'],
  25: ['SCUBA_DIVING', 'SCUBA Diving'],
  128: ['PINGPONG', 'Ping Pong'],
  129: ['BADMINTON', 'Badminton'],
  130: ['TENNIS', 'Tennis'],
  131: ['SOCCER', 'Soccer'],
  132: ['BASKETBALL', 'Basketball'],
  133: ['VOLLEYBALL', 'Volleyball'],
  134: ['ELLIPTICAL_TRAINER', 'Elliptical Trainer'],
  135: ['ROWING_MACHINE', 'Rowing Machine'],
  136: ['STEPPER', 'Stepper'],
  137: ['YOGA', 'Yoga'],
  138: ['PILATES', 'Pilates'],
  139: ['AEROBICS', 'Aerobics'],
  140: ['STRENGTH_TRAINING', 'Strength Training'],
  141: ['SPINNING', 'Spinning'],
  142: ['AIR_WALKER', 'Air walker'],
  143: ['HIIT', 'High-intensity Interval Training'],
  145: ['CROSSFIT', 'Crossfit'],
  146: ['FUNCTIONAL_TRAINING', 'Functional training'],
  147: ['PHYSICAL_TRAINING', 'Physical training'],
  148: ['TAEKWONDO', 'Taekwondo'],
  149: ['BOXING', 'Boxing'],
  150: ['FREE_SPARRING', 'Free sparring'],
  151: ['KARATE', 'Karate'],
  152: ['FENCING', 'Fencing'],
  153: ['BELLY_DANCE', 'Belly dance'],
  154: ['JAZZ_DANCE', 'Jazz dance'],
  155: ['LATIN_DANCE', 'Latin dance'],
  156: ['BALLET', 'Ballet'],
  157: ['CORE_TRAINING', 'Core Training'],
  158: ['BODY_COMBAT', 'Body combat'],
  159: ['KENDO', 'Kendo'],
  160: ['HORIZONTAL_BAR', 'Horizontal bar'],
  161: ['PARALLEL_BARS', 'Parallel bars'],
  162: ['STREET_DANCE', 'Street Dance'],
  163: ['ROLLER_SKATING', 'Roller skating'],
  164: ['MARTIAL_ARTS', 'Martial arts'],
  165: ['PLAZA_DANCING', 'Plaza dancing'],
  166: ['TAI_CHI', 'Tai chi'],
  167: ['DANCE', 'Dance'],
  168: ['HULA_HOOP', 'Hula hoop'],
  169: ['FRISBEE', 'Frisbee'],
  170: ['DARTS', 'Darts'],
  171: ['ARCHERY', 'Archery'],
  172: ['HORSE_RIDING', 'Horse riding'],
  174: ['KITE_FLYING', 'Kite Flying'],
  175: ['TUG_OF_WAR', 'Tug of war'],
  176: ['SWING', 'Swing'],
  177: ['STAIRS', 'Stairs'],
  178: ['OBSTACLE_RACE', 'Obstacle race'],
  179: ['BILLIARD_POOL', 'Pool'],
  180: ['BOWLING', 'Bowling'],
  181: ['SHUTTLECOCK', 'Shuttlecock'],
  182: ['HANDBALL', 'Handball'],
  183: ['BASEBALL', 'Baseball'],
  184: ['SOFTBALL', 'Softball'],
  185: ['CRICKET', 'Cricket'],
  186: ['RUGBY', 'Rugby'],
  187: ['BEACH_SOCCER', 'Beach Soccer'],
  188: ['BEACH_VOLLEYBALL', 'Beach Volleyball'],
  189: ['GATEBALL', 'Gateball'],
  190: ['HOCKEY', 'Hockey'],
  191: ['SQUASH', 'Squash'],
  192: ['SEPAK_TAKRAW', 'Sepak Takraw'],
  193: ['DODGEBALL', 'Dodgeball'],
  194: ['SAILING', 'Sailing'],
  195: ['SURFING', 'Surfing'],
  196: ['FISHING', 'Fishing'],
  197: ['RAFTING', 'Rafting'],
  198: ['DRAGON_BOAT', 'Dragon boat'],
  199: ['CANOEING', 'Canoeing'],
  200: ['ROWING', 'Rowing'],
  201: ['WATER_SCOOTER', 'Water scooter'],
  202: ['STAND_UP_PADDLEBOARDING', 'Standup Paddleboarding'],
  203: ['ICE_SKATING', 'Ice Skating'],
  204: ['ICE_HOCKEY', 'Ice hockey'],
  205: ['CURLING', 'Curling'],
  207: ['SLEDDING', 'Sledding'],
  208: ['BIATHLON', 'Biathlon'],
  209: ['SKATEBOARDING', 'Skateboarding'],
  210: ['ROCK_CLIMBING', 'Rock climbing'],
  211: ['BUNGEE_JUMPING', 'Bungee jumping'],
  212: ['PARKOUR', 'Parkour'],
  213: ['BMX', 'BMX'],
  214: ['ORIENTEERING', 'Orienteering'],
  215: ['PARACHUTING', 'Parachuting'],
  216: ['AUTO_RACING', 'Auto racing'],
  223: ['ESPORTS', 'Esports'],
  224: ['PADEL', 'Padel'],
  255: ['EXERCISE', 'Exercise'],
};

export interface SportOf {
  type: number;
  kind: string;
  name: string;
}

/** The JoyoFit sport of a Health Kit workout type; unknown and missing types are `EXERCISE`. */
export function sportOfActivityType(activityType: number | null | undefined): SportOf {
  const type = (activityType != null && HEALTH_KIT_SPORTS[activityType]) || OTHER_SPORT;
  const [kind, name] = SPORTS[type] ?? SPORTS[OTHER_SPORT]!;
  return { type, kind, name };
}

/** `WorkoutSportTypes.isPace`: pace (time per distance) rather than speed is the natural figure. */
export const isPaceKind = (kind: string) => kind.includes('RUN') || kind.includes('SWIM') || kind.includes('TREADMILL') || kind.includes('WALK');
