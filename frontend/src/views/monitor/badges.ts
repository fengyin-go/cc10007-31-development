import type { AlarmKind, AlarmStatus, TargetType } from './domain/types'

export function severityClass(severity: string): string {
  if (severity === 'P1') return 'badge p1'
  if (severity === 'P2') return 'badge p2'
  return 'badge p3'
}

export function alarmStatusClass(status: AlarmStatus): string {
  if (status === '活动中') return 'badge red'
  if (status === '已恢复') return 'badge blue'
  return 'badge green'
}

export function alarmKindClass(kind: AlarmKind): string {
  if (kind === '连续缺测') return 'badge red'
  if (kind === '迟到事件') return 'badge p2'
  return 'badge purple'
}

export function timelineToneClass(tone: string): string {
  return `tl-item tone-${tone}`
}

export const TARGET_LABEL: Record<TargetType, string> = {
  source: '源端连接',
  datasync: '同步链路',
  backfill: '补数任务',
}

export const TARGET_ROUTE: Record<TargetType, string> = {
  source: '/source',
  datasync: '/datasync',
  backfill: '/backfill',
}
