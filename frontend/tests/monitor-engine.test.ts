/**
 * 引擎判定验证（不依赖测试框架，node --experimental-strip-types 直接运行）。
 * 运行：node --experimental-strip-types frontend/tests/monitor-engine.test.ts
 */
import assert from 'node:assert/strict'

import {
  buildInputIdentity,
  dedupeByIdentity,
  evaluateConfig,
  isBreach,
  isLate,
  resetAlarmSequence,
  Time,
  withBackfillWindows,
} from '../src/views/monitor/domain/engine.ts'
import { SEED_BACKFILL_WINDOWS, SEED_CONFIGS, SEED_SAMPLES } from '../src/views/monitor/domain/seed.ts'
import type { MonitorConfig, SamplePoint } from '../src/views/monitor/domain/types.ts'

const configs: MonitorConfig[] = SEED_CONFIGS
const samples: SamplePoint[] = SEED_SAMPLES.map((item, index) => {
  const config = configs.find((c) => c.id === item.configId)!
  return {
    ...item,
    id: index + 1,
    inputIdentity: buildInputIdentity(config.targetRef, config.metric, item.eventTime),
  }
})

let passed = 0
function test(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

// 1. 输入身份规则
test('输入身份 = targetRef|metric|eventTime', () => {
  assert.equal(
    buildInputIdentity('DATA-0001', '同步延迟分钟', '2026-11-10 05:00'),
    'DATA-0001|同步延迟分钟|2026-11-10 05:00',
  )
})

// 2. 去重：同身份只认定一次
test('补数重叠产生的重复采样按输入身份去重', () => {
  const cfg3 = configs.find((c) => c.id === 3)!
  const result = evaluateConfig(cfg3, samples, configs, { intervalMinutes: 60 })
  assert.equal(result.duplicateCount, 2, 'MONI-0003 应有 2 条重复采样被去重')
  const dupTimeline = result.timeline.filter((t) => t.tone === 'duplicate')
  assert.equal(dupTimeline.length, 2)
  assert.ok(dupTimeline.every((t) => t.title.includes('输入身份去重')))
})

// 3. 全量重算事件编号
resetAlarmSequence()
const ordered = [...configs].sort((a, b) => a.id - b.id)
const results = ordered.map((c) => evaluateConfig(c, samples, configs, { intervalMinutes: 60 }))
const allAlarms = results.flatMap((r) => r.alarms)

test('MONI-0001 时间轴：缺测→迟到不抹告警→越界→恢复→再异常新事件', () => {
  const r1 = results[0]
  const kinds = r1.alarms.map((a) => a.kind)
  assert.deepEqual(kinds, ['连续缺测', '迟到事件', '真实越界', '真实越界', '真实越界'])
  // 缺测告警在 06:00 触发
  const missing = r1.alarms.find((a) => a.kind === '连续缺测')!
  assert.equal(missing.eventTime, '2026-11-10 06:00')
  // 迟到事件在 07:40 到达，但缺测告警仍处于活动中，未被抹去
  assert.equal(missing.status, '已恢复')
  assert.ok(missing.locked)
  // 三次越界必须是三个独立事件编号
  const breaches = r1.alarms.filter((a) => a.kind === '真实越界')
  assert.equal(breaches.length, 3)
  assert.equal(new Set(breaches.map((b) => b.eventCode)).size, 3)
  // 第一次越界在 11:00（连续两次正常）后恢复；12:00 越界是恢复后的新事件
  assert.equal(breaches[0].status, '已恢复')
  assert.equal(breaches[0].recoveredAt, '2026-11-10 11:00')
  assert.equal(breaches[1].eventTime, '2026-11-10 12:00')
  // 13:00 仅 1 次正常，未达 recoverLimit=2，12:00 事件仍活动；14:00 再越界又开新事件
  assert.equal(breaches[1].status, '活动中')
  assert.equal(breaches[1].recoveredAt, null)
  // 14:00 再次越界，新事件保持活动中
  assert.equal(breaches[2].eventTime, '2026-11-10 14:00')
  assert.equal(breaches[2].status, '活动中')
  // 缺测告警在 11:00 同步恢复
  assert.equal(missing.recoveredAt, '2026-11-10 11:00')
})

test('迟到事件不能抹去已发出的告警', () => {
  const r1 = results[0]
  const late = r1.alarms.find((a) => a.kind === '迟到事件')!
  assert.equal(late.eventTime, '2026-11-10 07:00')
  assert.equal(late.dataArrivalTime, '2026-11-10 07:40')
  assert.ok(late.locked)
  // 缺测与迟到并存，不存在迟到后删除/回改缺测事件的情况
  assert.ok(r1.alarms.filter((a) => a.kind === '连续缺测').length === 1)
})

test('冲突阈值按 priority 裁定：MONI-0002 告警标 overridden，MONI-0001 权威', () => {
  const r1 = results[0]
  const r2 = results[1]
  assert.ok(r1.alarms.every((a) => !a.overridden))
  assert.ok(r2.alarms.length > 0)
  assert.ok(r2.alarms.every((a) => a.overridden))
  const note = r2.alarms[0].arbitration!
  assert.equal(note.winnerCode, 'MONI-0001')
  assert.equal(note.winnerPriority, 1)
  assert.ok(note.conflicts.some((c) => c.code === 'MONI-0002'))
  // MONI-0002 阈值 60 不越界，故没有真实越界告警；MONI-0001 同刻有
  assert.equal(r2.alarms.filter((a) => a.kind === '真实越界').length, 0)
  assert.equal(r1.alarms.filter((a) => a.kind === '真实越界').length, 3)
})

test('MONI-0004 真实越界与恢复', () => {
  const r4 = results[3]
  const breach = r4.alarms.find((a) => a.kind === '真实越界')!
  assert.equal(breach.eventTime, '2026-11-12 02:00')
  assert.equal(breach.status, '已恢复')
  assert.equal(breach.recoveredAt, '2026-11-12 04:00')
})

test('所有告警一经发出即锁定', () => {
  assert.ok(allAlarms.every((a) => a.locked))
  assert.ok(allAlarms.every((a) => a.eventCode.startsWith('ALM-')))
})

test('时间轴按时间排序且包含补数区间', () => {
  const r1 = results[0]
  const times = r1.timeline.map((t) => new Time(t.time).getTime())
  assert.deepEqual(times, [...times].sort((a, b) => a - b))
  const merged = withBackfillWindows(r1.timeline, SEED_BACKFILL_WINDOWS, 'DATA-0001')
  assert.ok(merged.some((t) => t.kind === '补数区间'))
  const mergedTimes = merged.map((t) => new Time(t.time).getTime())
  assert.deepEqual(mergedTimes, [...mergedTimes].sort((a, b) => a - b))
})

test('判定原语：迟到与越界', () => {
  const cfg1 = configs[0]
  const lateSample = samples.find((s) => s.eventTime === '2026-11-10 07:00' && s.configId === 1)!
  assert.equal(isLate(lateSample), true)
  assert.equal(isBreach(lateSample, cfg1), false, '迟到样本不走越界口径')
  const breachSample = samples.find((s) => s.eventTime === '2026-11-10 09:00' && s.configId === 1)!
  assert.equal(isLate(breachSample), false)
  assert.equal(isBreach(breachSample, cfg1), true)
})

test('dedupeByIdentity 保留首次到达并标记后续', () => {
  const cfg3Samples = samples.filter((s) => s.configId === 3)
  const deduped = dedupeByIdentity(cfg3Samples)
  const identity = buildInputIdentity('BACK-0001', '补数完成率', '2026-11-11 03:00')
  const matches = deduped.filter((s) => s.inputIdentity === identity)
  assert.equal(matches.length, 2)
  assert.equal(matches[0].duplicate, false)
  assert.equal(matches[1].duplicate, true)
})

console.log(`\n全部 ${passed} 项引擎验证通过`)
