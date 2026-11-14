/**
 * 监控仓储集成验证：确认 → 影响证据 → 失败续做读取 → 回看核对的完整闭环。
 * 运行：node --experimental-strip-types frontend/tests/monitor-store.test.ts
 */
import assert from 'node:assert/strict'

import { monitorStore } from '../src/views/monitor/domain/store.ts'
import type { FaultReceipt, ImpactEvidence } from '../src/views/monitor/domain/types.ts'

let passed = 0
function test(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

monitorStore.resetAll()

test('全量重算的首个事件编号为 ALM-0001，与种子证据 EVD-0001 挂接对齐', () => {
  const alarms = monitorStore.getAllAlarms()
  const first = alarms.find((a) => a.eventCode === 'ALM-0001')!
  assert.equal(first.kind, '连续缺测')
  assert.equal(first.targetRef, 'DATA-0001')
  // 种子证据挂接 ALM-0001，状态应呈现为已确认
  assert.equal(first.status, '已确认')
})

test('每个配置的时间轴都包含采样/告警且按时间排列', () => {
  for (const view of monitorStore.getConfigViews()) {
    assert.ok(view.timeline.length > 0, `${view.config.code} 时间轴不应为空`)
    const times = view.timeline.map((t) => new Date(t.time.replace(' ', 'T')).getTime())
    assert.deepEqual(times, [...times].sort((a, b) => a - b))
  }
})

test('MONI-0003 的补数重叠重复采样被按输入身份去重 2 条', () => {
  const view = monitorStore.getConfigView(3)!
  assert.equal(view.evaluation.duplicateCount, 2)
  const dup = view.timeline.filter((t) => t.tone === 'duplicate')
  assert.equal(dup.length, 2)
  assert.ok(dup.every((t) => t.detail.includes('输入身份')))
})

test('确认活动告警会写入影响证据，且不能重复确认', () => {
  const target = monitorStore
    .getAllAlarms()
    .find((a) => a.status === '活动中' && !a.overridden)!
  assert.ok(target, '应至少存在一个活动中的权威告警')
  const evidence: ImpactEvidence = monitorStore.confirmAlarm({
    eventCode: target.eventCode,
    confirmation: '集成验证确认结论',
    resumeAdvice: '从失败水位续做并跳过已认定身份',
    confirmer: '集成测试',
  })
  assert.equal(evidence.alarmEventCode, target.eventCode)
  assert.ok(evidence.evidenceCode.startsWith('EVD-'))
  // 再次确认同事件必须报错
  assert.throws(
    () =>
      monitorStore.confirmAlarm({
        eventCode: target.eventCode,
        confirmation: '重复',
        resumeAdvice: '重复',
        confirmer: '集成测试',
      }),
    /不能重复确认/,
  )
  // 告警状态变为已确认，但告警记录本身仍锁定
  const refreshed = monitorStore.getAllAlarms().find((a) => a.eventCode === target.eventCode)!
  assert.equal(refreshed.status, '已确认')
  assert.equal(refreshed.locked, true)
})

test('同步任务失败续做可按关联对象读取证据并留下读取记录', () => {
  const before = monitorStore.getEvidence().filter((e) => e.targetRef === 'DATA-0001')
  assert.ok(before.length >= 1)
  const read = monitorStore.readEvidenceForTask('DATA-0001')
  assert.ok(read.every((e) => e.consumedBy.length >= 1))
  // 再读一次不会重复追加同日期记录
  const readAgain = monitorStore.readEvidenceForTask('DATA-0001')
  const same = readAgain.find((e) => e.evidenceCode === read[0].evidenceCode)!
  const todayCount = same.consumedBy.filter((c) => c.startsWith('续做读取@')).length
  assert.equal(todayCount, 1)
})

test('登记故障回执覆盖四类问题且编号自增', () => {
  const issues = ['点不动', '丢失', '重复显示', '对不上'] as const
  const beforeCount = monitorStore.getReceipts().length
  for (const issue of issues) {
    const receipt: FaultReceipt = monitorStore.addReceipt({
      targetRef: 'DATA-0001',
      configCode: 'MONI-0001',
      issue,
      symptom: `${issue}现象`,
      verdict: '待跟进',
      handling: `${issue}处理结果`,
      handler: '集成测试',
      relatedEventCode: null,
    })
    assert.ok(receipt.receiptCode.startsWith('RCP-'))
  }
  const after = monitorStore.getReceipts()
  assert.equal(after.length, beforeCount + 4)
  const registered = after.slice(-4).map((r) => r.issue)
  assert.deepEqual(registered, [...issues])
})

test('回看核对以监控配置为主对象且全部检查通过', () => {
  for (const view of monitorStore.getConfigViews()) {
    const report = monitorStore.lookback(view.config.id)
    assert.equal(report.configCode, view.config.code)
    assert.ok(report.checks.length === 5)
    assert.equal(report.consistent, true, `${view.config.code} 回看核对应全部通过：${JSON.stringify(report.checks.filter(c => !c.pass))}`)
    assert.equal(report.lockedAlarms, report.totalAlarms)
  }
})

test('冲突分组只包含同对象同指标的多配置，权威方 priority 最小', () => {
  const groups = monitorStore.getConflictGroups()
  const hit = groups.find((g) => g.targetRef === 'DATA-0001' && g.metric === '同步延迟分钟')!
  assert.ok(hit)
  assert.equal(hit.configs[0].code, 'MONI-0001')
  assert.equal(hit.configs[0].priority, 1)
  assert.equal(hit.configs[1].code, 'MONI-0002')
})

test('重置后回到种子状态：新增证据与回执被清除', () => {
  monitorStore.resetAll()
  assert.equal(monitorStore.getEvidence().length, 1)
  assert.equal(monitorStore.getReceipts().length, 4)
  const first = monitorStore.getAllAlarms().find((a) => a.eventCode === 'ALM-0001')!
  assert.equal(first.status, '已确认')
})

console.log(`\n全部 ${passed} 项仓储集成验证通过`)
