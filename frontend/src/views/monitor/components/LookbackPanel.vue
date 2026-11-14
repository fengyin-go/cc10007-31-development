<template>
  <section class="panel-card">
    <h3 class="panel-title">回看核对（仍以任务监控为主对象）</h3>
    <p class="panel-hint">
      选择监控配置，核对其告警事件与引擎按当前数据重算的结果：告警锁定、事件编号唯一性、
      输入身份去重、阈值裁定与影响证据挂接逐项给结论。
    </p>
    <div class="filter-bar">
      <label class="filter-item">
        <span>监控配置</span>
        <select v-model.number="selectedId" class="inline-select">
          <option v-for="view in views" :key="view.config.id" :value="view.config.id">
            {{ view.config.code }} · {{ view.config.targetRef }}
          </option>
        </select>
      </label>
    </div>

    <div v-if="report" class="evidence-box">
      <div style="display: flex; justify-content: space-between; align-items: center">
        <strong>{{ report.configCode }} 核对结论</strong>
        <span :class="report.consistent ? 'badge green' : 'badge red'">
          {{ report.consistent ? '全部核对通过' : '存在不一致项' }}
        </span>
      </div>
      <dl class="kv-list" style="margin: 10px 0">
        <dt>告警事件总数</dt><dd>{{ report.totalAlarms }}</dd>
        <dt>已锁定事件</dt><dd>{{ report.lockedAlarms }}（迟到数据不可抹去）</dd>
        <dt>被覆盖事件</dt><dd>{{ report.overriddenAlarms }}（冲突阈值裁定留痕）</dd>
        <dt>挂接影响证据</dt><dd>{{ report.evidenceLinked }} 条</dd>
      </dl>
      <div v-for="check in report.checks" :key="check.label" class="check-row">
        <span :class="check.pass ? 'check-mark pass' : 'check-mark fail'">{{ check.pass ? '✓' : '✗' }}</span>
        <div>
          <div>{{ check.label }}</div>
          <div style="color: var(--muted); font-size: 12px">{{ check.detail }}</div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { monitorStore } from '../domain/store'
import type { ConfigView } from '../domain/store'
import { useMonitorVersion } from '../domain/use-monitor'

const props = defineProps<{ views: ConfigView[]; initialId?: number }>()
const version = useMonitorVersion()

const selectedId = ref(props.initialId ?? props.views[0]?.config.id ?? 0)
const report = computed(() => {
  void version.value
  return selectedId.value ? monitorStore.lookback(selectedId.value) : null
})
</script>
