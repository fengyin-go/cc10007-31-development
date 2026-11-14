/**
 * 任务监控判定引擎（纯函数，无 DOM 依赖，可被页面与测试脚本共用）。
 *
 * 判定口径：
 * - 输入身份 inputIdentity = targetRef|metric|eventTime；
 *   补数重叠区间重复到达的采样身份相同，只认定第一次，其余标 duplicate，不参与告警判定。
 * - 迟到 = arrivalTime > expectedArrivalTime。迟到只产生「迟到事件」，
 *   不回改、不撤销已经发出的任何告警（告警 locked=true）。
 * - 连续缺测 = 预期采样槽位没有任何被认定的输入，连续次数达到 missingLimit 即告警。
 * - 真实越界 = 被认定的输入值落在阈值闭区间之外。
 * - 恢复 = 连续 recoverLimit 次正常（准时且不越界）采样；恢复后再异常生成新事件编号。
 * - 同任务多配置阈值冲突：priority 数字小者获胜，裁定过程写入告警事件 arbitration。
 */
import type {
  AlarmEvent,
  ArbitrationNote,
  BackfillWindow,
  EvaluationResult,
  MonitorConfig,
  SamplePoint,
  TimelineItem,
} from './types.ts'

const MINUTE = 60_000

export function buildInputIdentity(targetRef: string, metric: string, eventTime: string): string {
  return `${targetRef}|${metric}|${eventTime}`
}

function toTime(value: string): number {
  const time = new Time(value).getTime()
  if (Number.isNaN(time)) {
    throw new Error(`无法解析时间：${value}`)
  }
  return time
}

/** 小工具：集中时间解析，测试里可直接对照 */
export class Time {
  private readonly date: Date

  constructor(value: string) {
    this.date = new Date(value.replace(' ', 'T'))
  }

  getTime(): number {
    return this.date.getTime()
  }

  /** 分钟级时间戳 key，用于去重与槽位对齐 */
  get minuteKey(): number {
    return Math.floor(this.date.getTime() / MINUTE)
  }

  static fromMinuteKey(key: number): string {
    const pad = (n: number) => String(n).padStart(2, '0')
    const d = new Date(key * MINUTE)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
}

function medianInterval(samples: SamplePoint[]): number {
  if (samples.length < 2) {
    return 60
  }
  const keys = samples.map((s) => new Time(s.eventTime).minuteKey).sort((a, b) => a - b)
  const gaps = keys.slice(1).map((key, i) => key - keys[i]).filter((gap) => gap > 0)
  if (!gaps.length) {
    return 60
  }
  gaps.sort((a, b) => a - b)
  return gaps[Math.floor(gaps.length / 2)]
}

/**
 * 按输入身份去重：同一身份第一次到达被认定，其余标记 duplicate。
 * 保持到达顺序，返回带 duplicate 标记的新数组。
 */
export function dedupeByIdentity(samples: SamplePoint[]): SamplePoint[] {
  const seen = new Set<string>()
  return samples.map((sample) => {
    if (seen.has(sample.inputIdentity)) {
      return { ...sample, duplicate: true }
    }
    seen.add(sample.inputIdentity)
    return { ...sample, duplicate: false }
  })
}

/** 迟到判定 */
export function isLate(sample: SamplePoint): boolean {
  return toTime(sample.arrivalTime) > toTime(sample.expectedArrivalTime)
}

/** 真实越界判定：null 值不参与阈值比较（缺测走缺测口径） */
export function isBreach(sample: SamplePoint, config: MonitorConfig): boolean {
  if (sample.value === null) {
    return false
  }
  if (config.thresholdLower !== null && sample.value < config.thresholdLower) {
    return true
  }
  if (config.thresholdUpper !== null && sample.value > config.thresholdUpper) {
    return true
  }
  return false
}

function thresholdText(config: MonitorConfig): string {
  const lower = config.thresholdLower === null ? '∞小' : config.thresholdLower
  const upper = config.thresholdUpper === null ? '∞大' : config.thresholdUpper
  return `[${lower}, ${upper}]，连缺${config.missingLimit}次`
}

/**
 * 多配置冲突裁定：同一被监视对象 + 同一指标，阈值口径不一致时，
 * priority 数字小者获胜。返回当前配置的裁定记录（无冲突时返回 null）。
 */
export function arbitrate(
  config: MonitorConfig,
  configs: MonitorConfig[],
): ArbitrationNote | null {
  const peers = configs.filter(
    (c) =>
      c.enabled &&
      c.targetRef === config.targetRef &&
      c.metric === config.metric &&
      c.id !== config.id,
  )
  if (!peers.length) {
    return null
  }
  const conflicts = peers
    .filter((c) => thresholdText(c) !== thresholdText(config))
    .map((c) => ({ code: c.code, priority: c.priority, threshold: thresholdText(c) }))
  if (!conflicts.length) {
    return null
  }
  const all = [...peers, config].sort((a, b) => a.priority - b.priority)
  const winner = all[0]
  return {
    winnerCode: winner.code,
    winnerPriority: winner.priority,
    conflicts: [
      ...conflicts,
      { code: config.code, priority: config.priority, threshold: thresholdText(config) },
    ],
    rule: '同一被监视对象存在冲突阈值时，priority 数字最小者生效',
  }
}

let alarmSeq = 0

/** 重置事件序号：整库重算时调用，保证种子事件编号稳定可复现 */
export function resetAlarmSequence(seq = 0): void {
  alarmSeq = seq
}

function makeAlarm(params: {
  config: MonitorConfig
  kind: AlarmEvent['kind']
  eventTime: string
  arrivalTime: string
  detail: string
  identity: string | null
  arbitration: ArbitrationNote | null
  overridden: boolean
}): AlarmEvent {
  alarmSeq += 1
  return {
    id: alarmSeq,
    eventCode: `ALM-${String(alarmSeq).padStart(4, '0')}`,
    configId: params.config.id,
    configCode: params.config.code,
    targetRef: params.config.targetRef,
    metric: params.config.metric,
    kind: params.kind,
    severity: params.config.severity,
    status: '活动中',
    eventTime: params.eventTime,
    dataArrivalTime: params.arrivalTime,
    recoveredAt: null,
    recoverCondition: params.config.recoverCondition,
    triggerDetail: params.detail,
    inputIdentity: params.identity,
    locked: true,
    overridden: params.overridden,
    arbitration: params.arbitration ?? undefined,
  }
}

export interface EvaluateOptions {
  /** 采样间隔（分钟），不传则从样本间隔中位数推断 */
  intervalMinutes?: number
}

/**
 * 评估单个监控配置，产出告警事件与统一时间轴。
 */
export function evaluateConfig(
  config: MonitorConfig,
  rawSamples: SamplePoint[],
  allConfigs: MonitorConfig[],
  options: EvaluateOptions = {},
): EvaluationResult {
  const arbitration = arbitrate(config, allConfigs)
  // 裁定发生且获胜者不是本配置：本配置告警仍生成并锁定，但标记为被覆盖
  const overridden = arbitration !== null && arbitration.winnerCode !== config.code
  const deduped = dedupeByIdentity(
    rawSamples
      .filter((s) => s.configId === config.id)
      .sort((a, b) => toTime(a.eventTime) - toTime(b.eventTime)),
  )
  const accepted = deduped.filter((s) => !s.duplicate)
  const interval = options.intervalMinutes ?? medianInterval(accepted)
  const alarms: AlarmEvent[] = []
  const timeline: TimelineItem[] = []

  let missingStreak = 0
  let goodStreak = 0
  let lateCount = 0
  let missingAlarmCount = 0
  let breachAlarmCount = 0

  const activeAlarms = () => alarms.filter((a) => a.status === '活动中')

  const recoverIfDue = (slotTime: string) => {
    if (goodStreak < config.recoverLimit) {
      return
    }
    for (const alarm of activeAlarms()) {
      alarm.status = '已恢复'
      alarm.recoveredAt = slotTime
      timeline.push({
        kind: '恢复',
        time: slotTime,
        title: `${alarm.eventCode} 恢复`,
        detail: `连续 ${config.recoverLimit} 次正常采样，满足恢复条件：${config.recoverCondition}`,
        tone: 'recover',
        refCode: alarm.eventCode,
      })
    }
    goodStreak = 0
  }

  if (!accepted.length) {
    return {
      configId: config.id,
      alarms,
      timeline,
      acceptedCount: 0,
      duplicateCount: deduped.length - accepted.length,
      lateCount: 0,
      missingAlarmCount: 0,
      breachAlarmCount: 0,
    }
  }

  const firstKey = new Time(accepted[0].eventTime).minuteKey
  const lastKey = new Time(accepted[accepted.length - 1].eventTime).minuteKey
  const bySlot = new Map<number, SamplePoint>()
  for (const sample of accepted) {
    bySlot.set(new Time(sample.eventTime).minuteKey, sample)
  }

  for (let key = firstKey; key <= lastKey; key += interval) {
    const slotTime = Time.fromMinuteKey(key)
    const sample = bySlot.get(key)

    if (!sample) {
      // 预期槽位无任何被认定输入：累计连续缺测，恢复计数清零
      missingStreak += 1
      goodStreak = 0
      timeline.push({
        kind: '采样',
        time: slotTime,
        title: '连续缺测',
        detail: `第 ${missingStreak} 次预期采样无输入`,
        tone: 'alarm',
        refCode: config.code,
      })
      if (missingStreak === config.missingLimit) {
        const alarm = makeAlarm({
          config,
          kind: '连续缺测',
          eventTime: slotTime,
          arrivalTime: slotTime,
          detail: `连续 ${missingStreak} 个采样槽位无被认定输入，达到缺测阈值 ${config.missingLimit}`,
          identity: null,
          arbitration,
          overridden,
        })
        alarms.push(alarm)
        missingAlarmCount += 1
        timeline.push({
          kind: '告警',
          time: slotTime,
          title: `${alarm.eventCode} 连续缺测告警`,
          detail: alarm.triggerDetail,
          tone: 'alarm',
          refCode: alarm.eventCode,
        })
      }
      continue
    }

    // 有输入：缺测链中断
    missingStreak = 0
    const late = isLate(sample)
    const breach = !late && isBreach(sample, config)
    sample.late = late
    sample.breach = breach

    if (late) {
      lateCount += 1
      goodStreak = 0
      // 迟到只形成迟到事件；已发出的告警保持锁定，不因此撤销
      const alarm = makeAlarm({
        config,
        kind: '迟到事件',
        eventTime: sample.eventTime,
        arrivalTime: sample.arrivalTime,
        detail: `数据于 ${sample.arrivalTime} 到达，晚于预期 ${sample.expectedArrivalTime}`,
        identity: sample.inputIdentity,
        arbitration,
        overridden,
      })
      alarms.push(alarm)
      timeline.push({
        kind: '告警',
        time: sample.eventTime,
        title: `${alarm.eventCode} 迟到事件`,
        detail: `${alarm.triggerDetail}；历史告警保持有效，不做回抹`,
        tone: 'late',
        refCode: alarm.eventCode,
      })
      continue
    }

    if (breach) {
      goodStreak = 0
      const alarm = makeAlarm({
        config,
        kind: '真实越界',
        eventTime: sample.eventTime,
        arrivalTime: sample.arrivalTime,
        detail: `实际值 ${sample.value} 超出阈值 ${thresholdText(config)}`,
        identity: sample.inputIdentity,
        arbitration,
        overridden,
      })
      alarms.push(alarm)
      breachAlarmCount += 1
      timeline.push({
        kind: '告警',
        time: sample.eventTime,
        title: `${alarm.eventCode} 真实越界告警`,
        detail: alarm.triggerDetail,
        tone: 'alarm',
        refCode: alarm.eventCode,
      })
      continue
    }

    // 准时且不越界：正常采样，累计恢复计数
    goodStreak += 1
    timeline.push({
      kind: '采样',
      time: sample.eventTime,
      title: sample.fromBackfill ? '补数采样（已认定）' : '正常采样',
      detail: `值 ${sample.value}，到达 ${sample.arrivalTime}`,
      tone: sample.fromBackfill ? 'backfill' : 'normal',
      refCode: sample.inputIdentity,
    })
    recoverIfDue(slotTime)
  }

  // 被去重的重复样本也要上时间轴，解释补数重叠区间的重复显示
  for (const dup of deduped.filter((s) => s.duplicate)) {
    timeline.push({
      kind: '采样',
      time: dup.eventTime,
      title: '重复采样（按输入身份去重）',
      detail: `输入身份 ${dup.inputIdentity} 已认定过，本次到达不重复参评${
        dup.backfillRef ? `；来源补数区间 ${dup.backfillRef}` : ''
      }`,
      tone: 'duplicate',
      refCode: dup.inputIdentity,
    })
  }

  timeline.sort((a, b) => toTime(a.time) - toTime(b.time))

  return {
    configId: config.id,
    alarms,
    timeline,
    acceptedCount: accepted.length,
    duplicateCount: deduped.length - accepted.length,
    lateCount,
    missingAlarmCount,
    breachAlarmCount,
  }
}

/** 把补数区间并入某配置的时间轴 */
export function withBackfillWindows(
  timeline: TimelineItem[],
  windows: BackfillWindow[],
  targetRef: string,
): TimelineItem[] {
  const items: TimelineItem[] = [
    ...timeline,
    ...windows
      .filter((w) => w.targetRef === targetRef)
      .map<TimelineItem>((w) => ({
        kind: '补数区间',
        time: w.startTime,
        endTime: w.endTime,
        title: `补数区间 ${w.backfillRef}`,
        detail: `${w.startTime} ~ ${w.endTime}${w.overlapWith ? `；与 ${w.overlapWith} 重叠` : ''}；${w.note}`,
        tone: 'backfill',
        refCode: w.backfillRef,
      })),
  ]
  return items.sort((a, b) => toTime(a.time) - toTime(b.time))
}
