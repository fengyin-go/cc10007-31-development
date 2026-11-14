/**
 * 任务监控演示数据。
 * 场景主线：
 * - MONI-0001/0002 同时监视同步链路 DATA-0001 的「同步延迟分钟」，阈值冲突，按 priority 裁定；
 * - 时间轴依次呈现：正常 → 连续缺测告警 → 迟到（不抹旧告警）→ 恢复 → 真实越界（新事件）
 *   → 恢复 → 再次越界（又一个新事件）→ 补数区间与重复采样；
 * - MONI-0003 监视补数任务 BACK-0001 的「补数完成率」，两个重叠补数区间制造重复采样，
 *   按输入身份去重；
 * - MONI-0004 监视源端连接 SOUR-0001 的「心跳成功率」。
 */
import type {
  BackfillWindow,
  FaultReceipt,
  ImpactEvidence,
  MonitorConfig,
  SamplePoint,
} from './types.ts'

export const SEED_CONFIGS: MonitorConfig[] = [
  {
    id: 1,
    code: 'MONI-0001',
    name: '订单链路同步延迟-平台级',
    status: '已启用',
    targetType: 'datasync',
    targetRef: 'DATA-0001',
    targetName: '订单库实时同步链路',
    metric: '同步延迟分钟',
    thresholdLower: 0,
    thresholdUpper: 30,
    missingLimit: 2,
    lateLimitMinutes: 30,
    recoverLimit: 2,
    severity: 'P1',
    priority: 1,
    silenceMinutes: 15,
    channel: '值班群+电话',
    recoverCondition: '延迟回落至 30 分钟内且连续 2 次准时采样',
    enabled: true,
    updatedAt: '2026-11-09 18:00',
  },
  {
    id: 2,
    code: 'MONI-0002',
    name: '订单链路同步延迟-业务线级',
    status: '已启用',
    targetType: 'datasync',
    targetRef: 'DATA-0001',
    targetName: '订单库实时同步链路',
    metric: '同步延迟分钟',
    thresholdLower: 0,
    thresholdUpper: 60,
    missingLimit: 3,
    lateLimitMinutes: 45,
    recoverLimit: 2,
    severity: 'P2',
    priority: 2,
    silenceMinutes: 30,
    channel: '业务线邮件',
    recoverCondition: '延迟回落至 60 分钟内且连续 2 次准时采样',
    enabled: true,
    updatedAt: '2026-11-09 18:10',
  },
  {
    id: 3,
    code: 'MONI-0003',
    name: '历史补数完成率监控',
    status: '已启用',
    targetType: 'backfill',
    targetRef: 'BACK-0001',
    targetName: '订单明细 11-01~11-05 补数任务',
    metric: '补数完成率',
    thresholdLower: 95,
    thresholdUpper: 100,
    missingLimit: 2,
    lateLimitMinutes: 60,
    recoverLimit: 2,
    severity: 'P2',
    priority: 1,
    silenceMinutes: 20,
    channel: '补数值班群',
    recoverCondition: '完成率回到 95% 以上且连续 2 次准时采样',
    enabled: true,
    updatedAt: '2026-11-10 09:00',
  },
  {
    id: 4,
    code: 'MONI-0004',
    name: '源端连接心跳监控',
    status: '已启用',
    targetType: 'source',
    targetRef: 'SOUR-0001',
    targetName: '订单生产库连接',
    metric: '心跳成功率',
    thresholdLower: 99,
    thresholdUpper: 100,
    missingLimit: 2,
    lateLimitMinutes: 10,
    recoverLimit: 2,
    severity: 'P1',
    priority: 1,
    silenceMinutes: 10,
    channel: '值班群',
    recoverCondition: '心跳成功率回到 99% 以上且连续 2 次准时采样',
    enabled: true,
    updatedAt: '2026-11-09 18:00',
  },
]

/** 原始采样（不含 id/inputIdentity，由仓储统一补全，避免身份手写不一致） */
type RawSample = Omit<SamplePoint, 'id' | 'inputIdentity'>

function sample(
  configId: number,
  eventTime: string,
  value: number | null,
  arrivalTime: string,
  extra: Partial<RawSample> = {},
): RawSample {
  return {
    configId,
    eventTime,
    arrivalTime,
    expectedArrivalTime: `${eventTime.slice(0, 13)}:05`,
    value,
    fromBackfill: false,
    backfillRef: null,
    ...extra,
  }
}

export const SEED_SAMPLES: RawSample[] = [
  // ---- MONI-0001：同步延迟，60 分钟槽位，含缺测/迟到/越界/恢复/再异常/补数 ----
  sample(1, '2026-11-10 03:00', 12, '2026-11-10 03:04'),
  sample(1, '2026-11-10 04:00', 18, '2026-11-10 04:05'),
  // 05:00、06:00 连续两个槽位无输入 → 连续缺测告警（06:00 触发）
  sample(1, '2026-11-10 07:00', 22, '2026-11-10 07:40', {
    // 07:40 才到达，晚于 07:05 → 迟到事件；缺测告警保持锁定
    fromBackfill: true,
    backfillRef: 'BACK-W01',
  }),
  sample(1, '2026-11-10 08:00', 20, '2026-11-10 08:04'),
  sample(1, '2026-11-10 09:00', 41, '2026-11-10 09:05'), // 真实越界（>30）开出新事件
  sample(1, '2026-11-10 10:00', 26, '2026-11-10 10:05'), // 正常
  sample(1, '2026-11-10 11:00', 24, '2026-11-10 11:04'), // 连续第 2 次正常 → 存量告警全部恢复
  sample(1, '2026-11-10 12:00', 55, '2026-11-10 12:05'), // 恢复后再次越界 → 形成新事件，不复用旧事件
  sample(1, '2026-11-10 13:00', 21, '2026-11-10 13:05'), // 正常（第 1 次）
  sample(1, '2026-11-10 14:00', 58, '2026-11-10 14:05'), // 又一次越界（>30），新事件保持活动中
  sample(1, '2026-11-10 15:00', 19, '2026-11-10 15:05'), // 正常，恢复计数重新累计

  // ---- MONI-0002：同对象同指标、阈值更宽松（≤60、连缺3次），冲突时被 MONI-0001 覆盖 ----
  sample(2, '2026-11-10 03:00', 12, '2026-11-10 03:04'),
  sample(2, '2026-11-10 04:00', 18, '2026-11-10 04:05'),
  sample(2, '2026-11-10 07:00', 22, '2026-11-10 07:40', {
    fromBackfill: true,
    backfillRef: 'BACK-W01',
  }),
  sample(2, '2026-11-10 08:00', 20, '2026-11-10 08:04'),
  sample(2, '2026-11-10 09:00', 41, '2026-11-10 09:05'), // ≤60 不越界，仅作正常采样 → 与 MONI-0001 同刻结论冲突
  sample(2, '2026-11-10 10:00', 26, '2026-11-10 10:05'),
  sample(2, '2026-11-10 11:00', 24, '2026-11-10 11:04'),
  sample(2, '2026-11-10 12:00', 55, '2026-11-10 12:05'),
  sample(2, '2026-11-10 13:00', 21, '2026-11-10 13:05'),
  sample(2, '2026-11-10 14:00', 58, '2026-11-10 14:05'), // MONI-0002 阈值 60 不越界，进一步呈现两配置口径对不上
  sample(2, '2026-11-10 15:00', 19, '2026-11-10 15:05'),

  // ---- MONI-0003：补数完成率，含重叠补数区间产生的重复采样 ----
  sample(3, '2026-11-11 02:00', 98, '2026-11-11 02:05', { fromBackfill: true, backfillRef: 'BACK-W01' }),
  sample(3, '2026-11-11 03:00', 97, '2026-11-11 03:05', { fromBackfill: true, backfillRef: 'BACK-W01' }),
  // 同一输入身份第二次到达：BACK-W02 与 W01 重叠导致重复采样，去重后不参评
  sample(3, '2026-11-11 03:00', 97, '2026-11-11 03:48', { fromBackfill: true, backfillRef: 'BACK-W02' }),
  // 04:00、05:00 两个槽位无输入 → 连续缺测
  sample(3, '2026-11-11 06:00', 96, '2026-11-11 06:05', { fromBackfill: true, backfillRef: 'BACK-W02' }),
  sample(3, '2026-11-11 07:00', 99, '2026-11-11 07:04', { fromBackfill: true, backfillRef: 'BACK-W03' }),
  // 又一条重复采样，身份与 02:00 相同
  sample(3, '2026-11-11 02:00', 98, '2026-11-11 07:52', { fromBackfill: true, backfillRef: 'BACK-W03' }),

  // ---- MONI-0004：源端心跳，含一次真实越界与恢复 ----
  sample(4, '2026-11-12 01:00', 99.9, '2026-11-12 01:04'),
  sample(4, '2026-11-12 02:00', 98.2, '2026-11-12 02:05'), // 低于 99 → 真实越界
  sample(4, '2026-11-12 03:00', 99.5, '2026-11-12 03:05'),
  sample(4, '2026-11-12 04:00', 99.8, '2026-11-12 04:04'),]

export const SEED_BACKFILL_WINDOWS: BackfillWindow[] = [
  {
    id: 1,
    backfillRef: 'BACK-W01',
    targetRef: 'DATA-0001',
    startTime: '2026-11-10 06:30',
    endTime: '2026-11-10 08:30',
    overlapWith: null,
    note: '首轮补数，补 05:00~07:00 缺测区间',
  },
  {
    id: 2,
    backfillRef: 'BACK-W02',
    targetRef: 'BACK-0001',
    startTime: '2026-11-11 02:30',
    endTime: '2026-11-11 05:30',
    overlapWith: 'BACK-W01',
    note: '与 W01 在 03:00 槽位重叠，重放产生重复采样',
  },
  {
    id: 3,
    backfillRef: 'BACK-W03',
    targetRef: 'BACK-0001',
    startTime: '2026-11-11 06:30',
    endTime: '2026-11-11 08:00',
    overlapWith: 'BACK-W02',
    note: '失败续做区间，跳过已认定输入身份后继续',
  },
]

/** 预置一条已确认证据，演示同步任务失败续做如何读取 */
export const SEED_EVIDENCE: ImpactEvidence[] = [
  {
    id: 1,
    evidenceCode: 'EVD-0001',
    alarmEventCode: 'ALM-0001',
    targetType: 'datasync',
    targetRef: 'DATA-0001',
    confirmation: '连续缺测属实：源端 05:00~06:00 网络中断，07:40 补到的数据仅作迟到留痕，原告警维持有效',
    confirmer: '值班管理员',
    confirmedAt: '2026-11-10 08:20',
    resumeAdvice: '同步链路从水位 2026-11-10 05:00 续做，按输入身份跳过已到达的 07:00 采样',
    affectedIdentities: [
      'DATA-0001|同步延迟分钟|2026-11-10 05:00',
      'DATA-0001|同步延迟分钟|2026-11-10 06:00',
    ],
    consumedBy: [],
  },
]

/** 故障回执：逐项写明点不动、丢失、重复显示、对不上的处理结果 */
export const SEED_RECEIPTS: FaultReceipt[] = [
  {
    id: 1,
    receiptCode: 'RCP-0001',
    targetRef: 'DATA-0001',
    configCode: 'MONI-0001',
    issue: '点不动',
    symptom: '监控页 05:00、06:00 两个槽位长时间无新采样，刷新也不变化',
    verdict: '已恢复',
    handling: '定位为源端网络中断导致采集代理卡住，重启代理并补推心跳，07:00 槽位恢复进数',
    handler: '值班管理员',
    handledAt: '2026-11-10 07:50',
    relatedEventCode: 'ALM-0001',
  },
  {
    id: 2,
    receiptCode: 'RCP-0002',
    targetRef: 'DATA-0001',
    configCode: 'MONI-0001',
    issue: '丢失',
    symptom: '05:00、06:00 业务时间的采样在链路中断期间未落库',
    verdict: '确认丢失并补发',
    handling: '确认真实缺测后由 BACK-W01 补数任务补发，丢失区间写入影响证据 EVD-0001 供续做读取',
    handler: '值班管理员',
    handledAt: '2026-11-10 08:30',
    relatedEventCode: 'ALM-0001',
  },
  {
    id: 3,
    receiptCode: 'RCP-0003',
    targetRef: 'BACK-0001',
    configCode: 'MONI-0003',
    issue: '重复显示',
    symptom: 'BACK-W01 与 BACK-W02 重叠，03:00 槽位在时间轴上出现两条相同采样',
    verdict: '按输入身份去重',
    handling: '输入身份 BACK-0001|补数完成率|2026-11-11 03:00 只认定首次到达，第二条标注重复且不参评、不重复告警',
    handler: '补数值班员',
    handledAt: '2026-11-11 04:10',
    relatedEventCode: null,
  },
  {
    id: 4,
    receiptCode: 'RCP-0004',
    targetRef: 'DATA-0001',
    configCode: 'MONI-0002',
    issue: '对不上',
    symptom: '同一链路同一时刻，MONI-0001 报越界而 MONI-0002 显示正常，阈值口径不一致',
    verdict: '口径对齐',
    handling: '按 priority 裁定 MONI-0001（阈值≤30、优先级1）为权威口径，MONI-0002 同刻告警标注为被覆盖，业务线口径后续对齐到 30 分钟',
    handler: '数据治理负责人',
    handledAt: '2026-11-10 09:30',
    relatedEventCode: null,
  },
]
