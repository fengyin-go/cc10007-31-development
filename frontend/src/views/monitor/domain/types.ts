/**
 * 任务监控领域模型。
 *
 * 设计约定（对应需求条款）：
 * 1. 告警事件、采样时间、历史补数区间共用同一条时间轴（timeline）。
 * 2. 监控配置可关联源端连接(source)、同步链路(datasync)或补数任务(backfill)。
 * 3. 补数重叠区间产生的重复采样只按「输入身份」inputIdentity 认定，不重复参评。
 * 4. 迟到事件只能补充说明，不能抹去已经发出的告警（告警一经发出即锁定）。
 * 5. 恢复后再次异常必须形成新事件，而不是复用旧事件。
 * 6. 多个配置监视同一任务且阈值冲突时，按 priority 数字小者优先的明确规则裁定。
 * 7. 监控确认结果写入影响证据，供同步/补数任务失败续做时读取。
 */

/** 监控配置可以关联的三类对象 */
export type TargetType = 'source' | 'datasync' | 'backfill'

/** 告警判定类型：连续缺测 / 迟到事件 / 真实越界 */
export type AlarmKind = '连续缺测' | '迟到事件' | '真实越界'

/** 告警生命周期状态 */
export type AlarmStatus = '活动中' | '已恢复' | '已确认'

/** 时间轴上的条目种类 */
export type TimelineKind = '采样' | '告警' | '恢复' | '补数区间'

/** 故障回执四类问题的处理结论 */
export type ReceiptIssue = '点不动' | '丢失' | '重复显示' | '对不上'
export type ReceiptVerdict = '已恢复' | '确认丢失并补发' | '按输入身份去重' | '口径对齐' | '待跟进'

/** 监控配置 */
export interface MonitorConfig {
  id: number
  /** 配置编号，界面主标识 */
  code: string
  name: string
  status: '草稿' | '待校验' | '已启用' | '已停用'
  targetType: TargetType
  /** 关联对象编号，如 DATA-0001 / BACK-0001 / SOUR-0001 */
  targetRef: string
  targetName: string
  metric: string
  /** 阈值下界/上界，null 表示该侧不限定 */
  thresholdLower: number | null
  thresholdUpper: number | null
  /** 连续缺测多少次采样即告警 */
  missingLimit: number
  /** 迟到多少分钟以上记为迟到事件 */
  lateLimitMinutes: number
  /** 连续多少次正常采样才允许恢复 */
  recoverLimit: number
  severity: 'P1' | 'P2' | 'P3'
  /** 裁定优先级：数字越小优先级越高，同任务多配置冲突时按此裁决 */
  priority: number
  silenceMinutes: number
  channel: string
  /** 恢复条件的自然语言描述 */
  recoverCondition: string
  enabled: boolean
  updatedAt: string
}

/**
 * 采样点。
 * inputIdentity 是输入身份：同一身份只认定一次，补数重叠区间重复到达的采样靠它去重。
 */
export interface SamplePoint {
  id: number
  configId: number
  /** 输入身份，规则：targetRef|metric|eventTime，重复采样身份相同 */
  inputIdentity: string
  /** 事件发生时间（业务时间，时间轴主轴） */
  eventTime: string
  /** 数据到达时间，晚于预期到达窗口即为迟到 */
  arrivalTime: string
  /** 该采样点预期到达时间，迟到判定基准 */
  expectedArrivalTime: string
  value: number | null
  /** 是否由历史补数产生 */
  fromBackfill: boolean
  /** 所属补数区间编号（如有） */
  backfillRef: string | null
  /** 引擎评估后回填：是否重复样本（同一输入身份的第二次及以后到达） */
  duplicate?: boolean
  /** 引擎评估后回填：是否迟到 */
  late?: boolean
  /** 引擎评估后回填：是否真实越界 */
  breach?: boolean
}

/** 补数区间，画在时间轴上，用来解释重复采样的来源 */
export interface BackfillWindow {
  id: number
  backfillRef: string
  targetRef: string
  startTime: string
  endTime: string
  overlapWith: string | null
  note: string
}

/** 告警事件。一经发出即锁定，迟到数据不能回改、不能撤销。 */
export interface AlarmEvent {
  id: number
  /** 事件编号，恢复后再次异常会拿到新的事件编号 */
  eventCode: string
  configId: number
  configCode: string
  targetRef: string
  metric: string
  kind: AlarmKind
  severity: 'P1' | 'P2' | 'P3'
  status: AlarmStatus
  /** 事件发生时间（业务时间） */
  eventTime: string
  /** 数据到达时间；连续缺测时为触发判定的评估时间 */
  dataArrivalTime: string
  /** 恢复时间，未恢复为 null */
  recoveredAt: string | null
  recoverCondition: string
  /** 触发时的证据描述，例如连续缺测次数、越界实际值 */
  triggerDetail: string
  /** 关联的采样输入身份（缺测告警可能为 null） */
  inputIdentity: string | null
  /** 锁定标记：告警发出后即为 true，任何迟到数据都不可抹去 */
  locked: boolean
  /** 多配置冲突裁定后，非权威配置的告警标记为被覆盖（仍保留记录，仅不作任务级结论） */
  overridden: boolean
  /** 多配置冲突裁定记录 */
  arbitration?: ArbitrationNote
}

/** 同任务多配置阈值冲突时的裁定记录 */
export interface ArbitrationNote {
  /** 获胜配置编号 */
  winnerCode: string
  winnerPriority: number
  /** 参与冲突的配置编号及各自阈值 */
  conflicts: { code: string; priority: number; threshold: string }[]
  rule: string
}

/** 影响证据：监控确认结果落在这里，供同步/补数任务失败续做读取 */
export interface ImpactEvidence {
  id: number
  evidenceCode: string
  alarmEventCode: string
  targetType: TargetType
  targetRef: string
  /** 确认结论 */
  confirmation: string
  confirmer: string
  confirmedAt: string
  /** 失败续做建议：从哪个水位/区间继续 */
  resumeAdvice: string
  /** 影响的采样身份清单，续做时按身份跳过已处理输入 */
  affectedIdentities: string[]
  consumedBy: string[]
}

/** 故障回执：逐项写明四类问题的处理结果 */
export interface FaultReceipt {
  id: number
  receiptCode: string
  targetRef: string
  configCode: string
  issue: ReceiptIssue
  /** 现象描述 */
  symptom: string
  /** 处理结果 */
  verdict: ReceiptVerdict
  handling: string
  handler: string
  handledAt: string
  relatedEventCode: string | null
}

/** 时间轴聚合条目 */
export interface TimelineItem {
  kind: TimelineKind
  time: string
  endTime?: string
  title: string
  detail: string
  tone: 'normal' | 'late' | 'alarm' | 'recover' | 'backfill' | 'duplicate'
  refCode: string
}

/** 引擎评估单个配置的中间/结果状态 */
export interface EvaluationResult {
  configId: number
  alarms: AlarmEvent[]
  timeline: TimelineItem[]
  /** 去重统计 */
  acceptedCount: number
  duplicateCount: number
  lateCount: number
  missingAlarmCount: number
  breachAlarmCount: number
}
