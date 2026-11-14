<template>
  <div v-if="view" class="panel-card">
    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px">
      <h3 class="panel-title" style="margin: 0">
        统一时间轴 · {{ view.config.code }}（{{ view.config.name }}）
      </h3>
      <div>
        <label style="font-size: 12px; color: var(--muted); margin-right: 6px">切换配置</label>
        <select class="inline-select" :value="view.config.id" @change="onSwitch(($event.target as HTMLSelectElement).value)">
          <option v-for="item in views" :key="item.config.id" :value="item.config.id">
            {{ item.config.code }} · {{ item.config.targetRef }}
          </option>
        </select>
      </div>
    </div>

    <dl class="kv-list" style="margin: 10px 0">
      <dt>关联对象</dt>
      <dd>
        <span class="relation-tag">{{ TARGET_LABEL[view.config.targetType] }}</span>
        {{ view.config.targetRef }} · {{ view.config.targetName }}
      </dd>
      <dt>监控指标</dt>
      <dd>{{ view.config.metric }}，阈值 [{{ view.config.thresholdLower ?? '∞小' }}, {{ view.config.thresholdUpper ?? '∞大' }}]</dd>
      <dt>恢复条件</dt>
      <dd>{{ view.config.recoverCondition }}（连续 {{ view.config.recoverLimit }} 次正常采样）</dd>
      <dt>采样口径</dt>
      <dd>
        认定 {{ view.evaluation.acceptedCount }} 条 ·
        重复去重 {{ view.evaluation.duplicateCount }} 条 ·
        迟到 {{ view.evaluation.lateCount }} 条 ·
        缺测告警 {{ view.evaluation.missingAlarmCount }} 次 ·
        越界告警 {{ view.evaluation.breachAlarmCount }} 次
      </dd>
    </dl>

    <div class="legend-row">
      <span><i class="legend-dot" style="background: #12b76a"></i>正常采样</span>
      <span><i class="legend-dot" style="background: #f04438"></i>告警/连续缺测</span>
      <span><i class="legend-dot" style="background: #f79009"></i>迟到事件</span>
      <span><i class="legend-dot" style="background: #2e90fa"></i>恢复</span>
      <span><i class="legend-dot" style="background: #7a5af8; border-radius: 2px"></i>补数区间</span>
      <span><i class="legend-dot" style="background: #98a2b3; border-radius: 2px"></i>重复采样（身份去重）</span>
    </div>

    <div class="timeline">
      <div v-for="(item, idx) in view.timeline" :key="idx" :class="timelineToneClass(item.tone)">
        <div class="tl-time">
          {{ item.time }}<template v-if="item.endTime"> ~ {{ item.endTime }}</template>
          <span v-if="item.kind === '补数区间'" class="tl-range">区间</span>
        </div>
        <div class="tl-title">{{ item.title }}</div>
        <p class="tl-detail">{{ item.detail }}</p>
      </div>
    </div>

    <h4 style="font-size: 13px; margin: 16px 0 8px">告警事件清单（事件发生时间 / 数据到达时间 / 恢复条件）</h4>
    <table class="data-table">
      <thead>
        <tr>
          <th>事件编号</th><th>类型</th><th>级别</th><th>事件发生时间</th><th>数据到达时间</th>
          <th>状态 / 恢复时间</th><th>锁定</th><th>裁定</th><th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="alarm in alarms" :key="alarm.eventCode">
          <td>{{ alarm.eventCode }}</td>
          <td><span :class="alarmKindClass(alarm.kind)">{{ alarm.kind }}</span></td>
          <td><span :class="severityClass(alarm.severity)">{{ alarm.severity }}</span></td>
          <td>{{ alarm.eventTime }}</td>
          <td>{{ alarm.dataArrivalTime }}</td>
          <td>
            <span :class="alarmStatusClass(alarm.status)">{{ alarm.status }}</span>
            <div style="font-size: 12px; color: var(--muted); margin-top: 2px">
              {{ alarm.recoveredAt ? `恢复于 ${alarm.recoveredAt}` : `恢复条件：${alarm.recoverCondition}` }}
            </div>
          </td>
          <td>
            <span :class="alarm.locked ? 'badge gray' : ''">{{ alarm.locked ? '已锁定' : '未锁定' }}</span>
          </td>
          <td>
            <span v-if="alarm.overridden" class="badge p2">已覆盖→{{ alarm.arbitration?.winnerCode }}</span>
            <span v-else-if="alarm.arbitration" class="badge green">权威口径</span>
            <span v-else class="badge gray">无冲突</span>
          </td>
          <td>
            <button v-if="alarm.status === '活动中'" class="link" type="button" @click="emit('confirm', alarm.eventCode)">
              确认并写证据
            </button>
            <span v-else class="badge green">已确认/已恢复</span>
          </td>
        </tr>
        <tr v-if="!alarms.length">
          <td colspan="9" class="empty-state">该配置暂无告警事件</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { monitorStore } from '../domain/store'
import type { ConfigView } from '../domain/store'
import { useMonitorVersion } from '../domain/use-monitor'
import { TARGET_LABEL, alarmKindClass, alarmStatusClass, severityClass, timelineToneClass } from '../badges'

const props = defineProps<{ views: ConfigView[]; selectedId: number }>()
const emit = defineEmits<{
  (e: 'confirm', eventCode: string): void
  (e: 'select', configId: number): void
}>()

const version = useMonitorVersion()
const view = computed(() => props.views.find((v) => v.config.id === props.selectedId))
const alarms = computed(() => {
  void version.value
  return view.value ? monitorStore.getAlarmsOfConfig(view.value.config.id) : []
})

function onSwitch(value: string) {
  emit('select', Number(value))
}
</script>
