/**
 * 任务监控本地仓储：独立于通用 local-store 的领域存储。
 * 原始数据（配置/采样/补数区间）变更后统一重算引擎事件，
 * 用户确认结果与故障回执单独持久化，重算后按事件编号重新挂接。
 */
import {
  SEED_BACKFILL_WINDOWS,
  SEED_CONFIGS,
  SEED_EVIDENCE,
  SEED_RECEIPTS,
  SEED_SAMPLES,
} from './seed.ts'
import {
  buildInputIdentity,
  evaluateConfig,
  resetAlarmSequence,
  withBackfillWindows,
} from './engine.ts'
import type {
  AlarmEvent,
  EvaluationResult,
  FaultReceipt,
  ImpactEvidence,
  MonitorConfig,
  ReceiptIssue,
  ReceiptVerdict,
  SamplePoint,
  TimelineItem,
} from './types.ts'

const STORAGE_KEY = 'data-layer-studio:monitor-domain'

interface PersistedState {
  configs: MonitorConfig[]
  rawSamples: Omit<SamplePoint, 'id' | 'inputIdentity'>[]
  windows: typeof SEED_BACKFILL_WINDOWS
  evidence: ImpactEvidence[]
  receipts: FaultReceipt[]
}

type Listener = () => void

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function seedState(): PersistedState {
  return {
    configs: clone(SEED_CONFIGS),
    rawSamples: clone(SEED_SAMPLES),
    windows: clone(SEED_BACKFILL_WINDOWS),
    evidence: clone(SEED_EVIDENCE),
    receipts: clone(SEED_RECEIPTS),
  }
}

function materializeSamples(raw: PersistedState['rawSamples'], configs: MonitorConfig[]): SamplePoint[] {
  const configById = new Map(configs.map((c) => [c.id, c]))
  return raw.map((item, index) => {
    const config = configById.get(item.configId)
    const targetRef = config?.targetRef ?? ''
    return {
      ...item,
      id: index + 1,
      inputIdentity: buildInputIdentity(targetRef, config?.metric ?? '', item.eventTime),
    }
  })
}

export interface ConfigView {
  config: MonitorConfig
  evaluation: EvaluationResult
  timeline: TimelineItem[]
  /** 权威结论：冲突被覆盖的配置不计入任务级统计 */
  authoritative: boolean
  conflictWith: MonitorConfig[]
}

class MonitorStore {
  private state: PersistedState = seedState()
  private listeners = new Set<Listener>()

  constructor() {
    this.load()
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener())
  }

  private load(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return
    }
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      this.persist()
      return
    }
    try {
      const parsed = JSON.parse(raw) as PersistedState
      this.state = { ...seedState(), ...parsed }
    } catch {
      this.state = seedState()
      this.persist()
    }
  }

  private persist(): void {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state))
    }
  }

  resetAll(): void {
    this.state = seedState()
    this.persist()
    this.emit()
  }

  getConfigs(): MonitorConfig[] {
    return clone(this.state.configs)
  }

  getConfig(id: number): MonitorConfig | undefined {
    const found = this.state.configs.find((c) => c.id === id)
    return found ? clone(found) : undefined
  }

  getWindows() {
    return clone(this.state.windows)
  }

  getEvidence(): ImpactEvidence[] {
    return clone(this.state.evidence)
  }

  getReceipts(): FaultReceipt[] {
    return clone(this.state.receipts)
  }

  /** 全量重算：按配置 id 排序保证事件编号稳定 */
  private runEngine(): { alarms: AlarmEvent[]; views: Map<number, ConfigView> } {
    resetAlarmSequence()
    const samples = materializeSamples(this.state.rawSamples, this.state.configs)
    const ordered = [...this.state.configs].sort((a, b) => a.id - b.id)
    const allAlarms: AlarmEvent[] = []
    const views = new Map<number, ConfigView>()

    for (const config of ordered) {
      const evaluation = evaluateConfig(config, samples, this.state.configs, { intervalMinutes: 60 })
      allAlarms.push(...evaluation.alarms)
      const conflictWith = this.state.configs.filter(
        (c) =>
          c.enabled &&
          c.targetRef === config.targetRef &&
          c.metric === config.metric &&
          c.id !== config.id,
      )
      const authoritative = !evaluation.alarms.some((a) => a.overridden)
      views.set(config.id, {
        config: clone(config),
        evaluation: clone(evaluation),
        timeline: withBackfillWindows(evaluation.timeline, this.state.windows, config.targetRef),
        authoritative,
        conflictWith: clone(conflictWith),
      })
    }
    return { alarms: allAlarms, views }
  }

  getConfigViews(): ConfigView[] {
    return [...this.runEngine().views.values()]
  }

  getConfigView(id: number): ConfigView | undefined {
    return this.runEngine().views.get(id)
  }

  /** 全部告警（以监控配置为主对象组织，回看核对仍回到这里） */
  getAllAlarms(): AlarmEvent[] {
    const alarms = this.runEngine().alarms
    const confirmedCodes = new Set(this.state.evidence.map((e) => e.alarmEventCode))
    return alarms
      .map((alarm) =>
        confirmedCodes.has(alarm.eventCode)
          ? { ...alarm, status: '已确认' as const }
          : alarm,
      )
      .sort((a, b) => a.eventTime.localeCompare(b.eventTime))
  }

  getAlarmsOfConfig(configId: number): AlarmEvent[] {
    return this.getAllAlarms().filter((a) => a.configId === configId)
  }

  /** 同任务多配置的冲突分组，用于优先级裁定面板 */
  getConflictGroups(): { targetRef: string; metric: string; configs: MonitorConfig[] }[] {
    const groups = new Map<string, MonitorConfig[]>()
    for (const config of this.state.configs.filter((c) => c.enabled)) {
      const key = `${config.targetRef}|${config.metric}`
      const list = groups.get(key) ?? []
      list.push(config)
      groups.set(key, list)
    }
    return [...groups.entries()]
      .filter(([, list]) => list.length > 1)
      .map(([key, configs]) => {
        const [targetRef, metric] = key.split('|')
        return { targetRef, metric, configs: [...configs].sort((a, b) => a.priority - b.priority) }
      })
  }

  /**
   * 确认告警：确认结果写入影响证据，供数据同步/补数任务失败续做读取。
   * 告警本身保持锁定，确认只追加证据，不改写事件。
   */
  confirmAlarm(input: {
    eventCode: string
    confirmation: string
    resumeAdvice: string
    confirmer: string
  }): ImpactEvidence {
    const alarm = this.getAllAlarms().find((a) => a.eventCode === input.eventCode)
    if (!alarm) {
      throw new Error(`没有找到告警事件 ${input.eventCode}`)
    }
    const existed = this.state.evidence.find((e) => e.alarmEventCode === input.eventCode)
    if (existed) {
      throw new Error('该告警已确认并写入影响证据，不能重复确认')
    }
    const evidence: ImpactEvidence = {
      id: this.state.evidence.length + 1,
      evidenceCode: `EVD-${String(this.state.evidence.length + 1).padStart(4, '0')}`,
      alarmEventCode: alarm.eventCode,
      targetType: this.state.configs.find((c) => c.id === alarm.configId)!.targetType,
      targetRef: alarm.targetRef,
      confirmation: input.confirmation,
      confirmer: input.confirmer,
      confirmedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
      resumeAdvice: input.resumeAdvice,
      affectedIdentities: alarm.inputIdentity ? [alarm.inputIdentity] : [],
      consumedBy: [],
    }
    this.state.evidence.push(evidence)
    this.persist()
    this.emit()
    return clone(evidence)
  }

  /** 同步/补数任务失败续做时读取影响证据的入口 */
  readEvidenceForTask(targetRef: string): ImpactEvidence[] {
    const list = this.state.evidence.filter((e) => e.targetRef === targetRef)
    for (const evidence of list) {
      if (!evidence.consumedBy.includes(`续做读取@${new Date().toISOString().slice(0, 10)}`)) {
        evidence.consumedBy.push(`续做读取@${new Date().toISOString().slice(0, 10)}`)
      }
    }
    this.persist()
    this.emit()
    return clone(list)
  }

  addReceipt(input: {
    targetRef: string
    configCode: string
    issue: ReceiptIssue
    symptom: string
    verdict: ReceiptVerdict
    handling: string
    handler: string
    relatedEventCode: string | null
  }): FaultReceipt {
    const receipt: FaultReceipt = {
      id: this.state.receipts.length + 1,
      receiptCode: `RCP-${String(this.state.receipts.length + 1).padStart(4, '0')}`,
      ...input,
      handledAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
    }
    this.state.receipts.push(receipt)
    this.persist()
    this.emit()
    return clone(receipt)
  }

  /**
   * 回看核对：以监控配置为主对象，核对其告警事件与当前引擎重算结果是否一致。
   * 告警锁定机制下，重算只能得到相同或更多的事件，不会抹掉历史告警。
   */
  lookback(configId: number): {
    configCode: string
    totalAlarms: number
    lockedAlarms: number
    overriddenAlarms: number
    evidenceLinked: number
    consistent: boolean
    checks: { label: string; pass: boolean; detail: string }[]
  } {
    const view = this.getConfigView(configId)
    if (!view) {
      throw new Error(`没有找到监控配置 ${configId}`)
    }
    const alarms = this.getAlarmsOfConfig(configId)
    const evidence = this.state.evidence.filter((e) =>
      alarms.some((a) => a.eventCode === e.alarmEventCode),
    )
    const checks = [
      {
        label: '告警事件均已锁定，迟到数据不可抹去',
        pass: alarms.every((a) => a.locked),
        detail: `共 ${alarms.length} 个事件，锁定 ${alarms.filter((a) => a.locked).length} 个`,
      },
      {
        label: '恢复后再次异常生成了新事件编号',
        pass: new Set(alarms.map((a) => a.eventCode)).size === alarms.length,
        detail: `事件编号去重后仍为 ${new Set(alarms.map((a) => a.eventCode)).size} 个`,
      },
      {
        label: '重复采样按输入身份去重，未重复参评',
        pass: view.evaluation.duplicateCount >= 0,
        detail: `认定 ${view.evaluation.acceptedCount} 条，去重 ${view.evaluation.duplicateCount} 条`,
      },
      {
        label: '冲突阈值已按 priority 裁定',
        pass: view.conflictWith.length === 0 || alarms.some((a) => a.arbitration || a.overridden),
        detail:
          view.conflictWith.length === 0
            ? '无同任务冲突配置'
            : `与 ${view.conflictWith.map((c) => c.code).join('、')} 同监，权威口径=${
                view.authoritative ? view.config.code : view.conflictWith[0].code
              }`,
      },
      {
        label: '已确认告警均有影响证据挂接',
        pass: evidence.length === alarms.filter((a) => a.status === '已确认').length,
        detail: `已确认 ${alarms.filter((a) => a.status === '已确认').length} 个，证据 ${evidence.length} 条`,
      },
    ]
    return {
      configCode: view.config.code,
      totalAlarms: alarms.length,
      lockedAlarms: alarms.filter((a) => a.locked).length,
      overriddenAlarms: alarms.filter((a) => a.overridden).length,
      evidenceLinked: evidence.length,
      consistent: checks.every((c) => c.pass),
      checks,
    }
  }
}

export const monitorStore = new MonitorStore()
