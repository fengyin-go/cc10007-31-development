<template>
  <section class="panel-card">
    <h3 class="panel-title">告警事件总览（以任务监控为主对象）</h3>
    <p class="panel-hint">
      所有告警一经发出即锁定：迟到数据只能补充「迟到事件」，不能抹去、回改已发出的告警；
      恢复后再次异常会生成新的事件编号，不复用旧事件。
    </p>
    <div class="filter-bar" style="margin-bottom: 10px">
      <label class="filter-item">
        <span>事件类型</span>
        <select v-model="kindFilter" class="inline-select">
          <option value="">全部</option>
          <option v-for="kind in kinds" :key="kind" :value="kind">{{ kind }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>事件状态</span>
        <select v-model="statusFilter" class="inline-select">
          <option value="">全部</option>
          <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>关联对象</span>
        <input v-model="targetFilter" placeholder="按对象编号检索，如 DATA-0001" />
      </label>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>事件编号</th><th>监控配置</th><th>关联对象</th><th>类型</th><th>级别</th>
          <th>事件发生时间</th><th>数据到达时间</th><th>状态 / 恢复</th><th>锁定</th><th>裁定</th><th>触发证据</th><th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="alarm in filtered" :key="alarm.eventCode">
          <td>{{ alarm.eventCode }}</td>
          <td>{{ alarm.configCode }}</td>
          <td>{{ alarm.targetRef }}<div style="font-size: 12px; color: var(--muted)">{{ alarm.metric }}</div></td>
          <td><span :class="alarmKindClass(alarm.kind)">{{ alarm.kind }}</span></td>
          <td><span :class="severityClass(alarm.severity)">{{ alarm.severity }}</span></td>
          <td>{{ alarm.eventTime }}</td>
          <td>{{ alarm.dataArrivalTime }}</td>
          <td>
            <span :class="alarmStatusClass(alarm.status)">{{ alarm.status }}</span>
            <div style="font-size: 12px; color: var(--muted)">{{ alarm.recoveredAt ?? '未恢复' }}</div>
          </td>
          <td><span class="badge gray">{{ alarm.locked ? '已锁定' : '未锁定' }}</span></td>
          <td>
            <span v-if="alarm.overridden" class="badge p2">被覆盖→{{ alarm.arbitration?.winnerCode }}</span>
            <span v-else-if="alarm.arbitration" class="badge green">权威</span>
            <span v-else class="badge gray">—</span>
          </td>
          <td style="max-width: 240px; font-size: 12px">{{ alarm.triggerDetail }}</td>
          <td>
            <button v-if="alarm.status === '活动中'" class="link" type="button" @click="emit('confirm', alarm.eventCode)">
              确认写证据
            </button>
            <span v-else class="badge green">{{ alarm.status }}</span>
          </td>
        </tr>
        <tr v-if="!filtered.length">
          <td colspan="12" class="empty-state">没有符合条件的告警事件</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { monitorStore } from '../domain/store'
import { useMonitorVersion } from '../domain/use-monitor'
import { alarmKindClass, alarmStatusClass, severityClass } from '../badges'

const emit = defineEmits<{ (e: 'confirm', eventCode: string): void }>()

const version = useMonitorVersion()

const kindFilter = ref('')
const statusFilter = ref('')
const targetFilter = ref('')
const kinds = ['连续缺测', '迟到事件', '真实越界']
const statuses = ['活动中', '已恢复', '已确认']

const filtered = computed(() => {
  void version.value
  return monitorStore
    .getAllAlarms()
    .filter((a) => !kindFilter.value || a.kind === kindFilter.value)
    .filter((a) => !statusFilter.value || a.status === statusFilter.value)
    .filter((a) => !targetFilter.value || a.targetRef.includes(targetFilter.value.trim()))
})
</script>
