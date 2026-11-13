// Test-only fixtures, built from the response examples in Huawei's Health Kit REST documentation (docs/huawei-health-kit.md,
// "Sync from the cloud API"). Values Huawei's examples have are kept as they are; what an example lacks (a route, more heart rate
// points) is added in the same documented shape and marked.
import type { HkActivityRecord, HkGroup } from './mapping';

/**
 * "Running Exercise Records" (running-scene-0000001212292245), the response of
 * `GET /healthkit/v2/activityRecords?...&activityType=56&detailDataType=com.huawei.instantaneous.exercise_heart_rate`, verbatim.
 */
export const RUNNING_RECORD: HkActivityRecord = {
  id: '1592905552721',
  desc: 'running',
  startTime: 1592905552721,
  endTime: 1592906207222,
  timeZone: '+0800',
  modifyTime: 1599290412916,
  activitySummary: {
    dataSummary: [
      { startTime: 1592905552721000000, endTime: 1592906207222000000, dataTypeName: 'com.huawei.continuous.steps.total', value: [{ integerValue: 949, fieldName: 'steps' }] },
      { startTime: 1592905552721000000, endTime: 1592906207222000000, dataTypeName: 'com.huawei.continuous.distance.total', value: [{ floatValue: 610, fieldName: 'distance' }] },
      {
        startTime: 1592905552721000000,
        endTime: 1592906207222000000,
        dataTypeName: 'com.huawei.continuous.calories.burnt.total',
        value: [{ floatValue: 16, fieldName: 'calories_total' }],
      },
      {
        startTime: 1592905552721000000,
        endTime: 1592906207222000000,
        dataTypeName: 'com.huawei.continuous.exercise_heart_rate.statistics',
        value: [
          { floatValue: 120, fieldName: 'avg' },
          { floatValue: 120, fieldName: 'max' },
          { floatValue: 120, fieldName: 'min' },
        ],
      },
      {
        startTime: 1592905552721000000,
        endTime: 1592906207222000000,
        dataTypeName: 'com.huawei.continuous.steps.rate.statistics',
        value: [
          { floatValue: 94, fieldName: 'avg' },
          { floatValue: 114, fieldName: 'max' },
          { floatValue: 78, fieldName: 'min' },
        ],
      },
      {
        startTime: 1592905552721000000,
        endTime: 1592906207222000000,
        dataTypeName: 'com.huawei.continuous.speed.statistics',
        value: [
          { floatValue: 0.68, fieldName: 'avg' },
          { floatValue: 1.05, fieldName: 'max' },
          { floatValue: 0.45, fieldName: 'min' },
        ],
      },
    ],
  },
  details: [
    {
      dataCollectorId: 'cmF3Omluc3RhbnRhbmVvdXMuZXhlcmNpc2VfaGVhcnRfcmF0ZQEwMTI3ODUwMTpqEF7rB3uBcGykpv6T2TisfTMhfZAvz1BP2Kcz70d1Sg',
      samplePoints: [
        {
          startTime: 1592905552722000000,
          endTime: 1592905552722000000,
          dataTypeName: 'com.huawei.instantaneous.exercise_heart_rate',
          value: [{ fieldName: 'bpm', floatValue: 120 }],
        },
      ],
    },
  ],
  activityType: 56,
  activeTime: 654501,
} as HkActivityRecord & { desc: string };

/** The running record with a route added: `com.huawei.instantaneous.location.sample` points (Location data type page). */
export const RUNNING_WITH_ROUTE: HkActivityRecord = {
  ...RUNNING_RECORD,
  details: [
    ...(RUNNING_RECORD.details ?? []),
    {
      dataCollectorId: 'added-location',
      samplePoints: [
        // Same second as the heart rate point: merged into one row.
        loc(1592905552722, -7.9666, 112.6326, 1),
        loc(1592905562722, -7.9667, 112.6328, 1),
        // GCJ-02 (mainland China grid): left out of the route.
        loc(1592905572722, 39.9, 116.4, 2),
      ],
    },
    {
      dataCollectorId: 'added-speed-altitude',
      samplePoints: [
        { startTime: 1592905562722000000, endTime: 1592905562722000000, dataTypeName: 'com.huawei.instantaneous.speed', value: [{ fieldName: 'speed', floatValue: 2.5 }] },
        { startTime: 1592905562722000000, endTime: 1592905562722000000, dataTypeName: 'com.huawei.instantaneous.steps.rate', value: [{ fieldName: 'step_rate', floatValue: 160.4 }] },
        { startTime: 1592905562722000000, endTime: 1592905562722000000, dataTypeName: 'com.huawei.instantaneous.altitude', value: [{ fieldName: 'altitude', floatValue: 440 }] },
        { startTime: 1592905582722000000, endTime: 1592905582722000000, dataTypeName: 'com.huawei.instantaneous.altitude', value: [{ fieldName: 'altitude', floatValue: 446 }] },
      ],
    },
  ],
};

function loc(ms: number, latitude: number, longitude: number, coordinate: number) {
  return {
    startTime: ms * 1_000_000,
    endTime: ms * 1_000_000,
    dataTypeName: 'com.huawei.instantaneous.location.sample',
    value: [
      { fieldName: 'latitude', floatValue: latitude },
      { fieldName: 'longitude', floatValue: longitude },
      { fieldName: 'precision', floatValue: 5 },
      { fieldName: 'coordinate', integerValue: coordinate },
    ],
  };
}

/** "Querying Created Exercise Records" (activityrecords_list-0000001050114862), the response's one record, verbatim. */
export const INDOOR_CYCLING_RECORD: HkActivityRecord = {
  id: '1623018048263',
  name: 'test',
  startTime: 1623018048263,
  endTime: 1623078048263,
  modifyTime: 1623057750126,
  activitySummary: {
    dataSummary: [
      { startTime: 1623018048263000000, endTime: 1623078048263000000, dataTypeName: 'com.huawei.continuous.distance.total', value: [{ fieldName: 'distance', floatValue: 1786.2 }] },
      {
        startTime: 1623018048263000000,
        endTime: 1623078048263000000,
        dataTypeName: 'com.huawei.continuous.speed.statistics',
        value: [
          { fieldName: 'avg', floatValue: 13.54 },
          { fieldName: 'max', floatValue: 15.82 },
          { fieldName: 'min', floatValue: 12.33 },
        ],
      },
    ],
  },
  timeZone: '+0800',
  activityType: 97,
  activeTime: 13921000,
};

/** "Querying Sampling Data Details" (sampleset_polymerize_detailed-0000001050114864), the response, verbatim. */
export const STEP_DETAILS: HkGroup[] = [
  {
    startTime: 1590700295000,
    endTime: 1591018695000,
    sampleSet: [
      {
        dataCollectorId: 'ZGVyaXZlZDpjb250aW51b3VzLnN0ZXBzLmRlbHRhEwMTI3ODUwMTpqEF7rB3uBcGykpv6T2TisfTMhfZAvz1BP2Kcz70d1Sg',
        samplePoints: [
          { startTime: 1590760340000000000, endTime: 1590760460000000000, dataTypeName: 'com.huawei.continuous.steps.delta', value: [{ fieldName: 'steps_delta', integerValue: 50 }] },
          { startTime: 1590760460000000000, endTime: 1590761060000000000, dataTypeName: 'com.huawei.continuous.steps.delta', value: [{ fieldName: 'steps_delta', integerValue: 60 }] },
          { startTime: 1590846740000000000, endTime: 1590846860000000000, dataTypeName: 'com.huawei.continuous.steps.delta', value: [{ fieldName: 'steps_delta', integerValue: 70 }] },
          { startTime: 1590846860000000000, endTime: 1590847460000000000, dataTypeName: 'com.huawei.continuous.steps.delta', value: [{ fieldName: 'steps_delta', integerValue: 80 }] },
        ],
      },
    ],
  },
];

/** "Querying Sampling Data Statistics of Multiple Days" (sampleset_daily_polymerize-0000001078113560), the response, verbatim (days in +0800). */
export const DAILY_STEPS: HkGroup[] = [
  {
    startTime: 1597075200000,
    endTime: 1597161600000,
    sampleSet: [
      {
        dataCollectorId: 'ZGVyaXZlZDpjb250aW51b3VzLnN0ZXBzLnRvdGFsEwMTI3ODUwMTpqEF7rB3uBcGykpv6T2TisfTMhfZAvz1BP2Kcz70d1Sg',
        samplePoints: [
          {
            startTime: 1597075200000000000,
            endTime: 1597161599999000000,
            dataTypeName: 'com.huawei.continuous.steps.total',
            value: [{ fieldName: 'steps', integerValue: 9000 }],
          },
        ],
      },
    ],
  },
  {
    startTime: 1597161600000,
    endTime: 1597247999999,
    sampleSet: [{ dataCollectorId: 'ZGVyaXZlZDpjb250aW51b3VzLnN0ZXBzLnRvdGFsEwMTI3ODUwMTpqEF7rB3uBcGykpv6T2TisfTMhfZAvz1BP2Kcz70d1Sg', samplePoints: [] }],
  },
];
