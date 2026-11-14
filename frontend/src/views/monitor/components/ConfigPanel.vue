<template>
  <div>
    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <section class="panel-card">
      <h3 class="panel-title">监控配置（可关联源端连接 / 同步链路 / 补数任务）</h3>
      <p class="panel-hint">
        选中配置后可在「统一时间轴」查看其告警事件、采样时间与补数区间；冲突阈值按 priority
        数字小者优先裁定。
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th>配置编号</th>
            <th>配置名称</th>
            <th>关联对象</th>
            <th>监控指标 / 阈值</th>
            <th>级别</th>
            <th>优先级</th>
            <th>恢复条件</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="view in views"
            :key="view.config.id"
            :class="{ 'winner-row': view.authoritative && view.conflictWith.length > 0 }"
          >
            <td>
              <a class="link" @click="emit('select', view.config.id)">{{ view.config.code }}</a>
              <span v-if="view.conflictWith.length" class="badge gray" style="margin-left: 6px">同监×{{ view.conflictWith.length + 1 }}</span>
              <span v-if="!view.authoritative" class="badge p2" style="margin-left: 6px">口径被覆盖</span>
            </td>
            <td>{{ view.config.name }}</td>
            <td>
              <span class="relation-tag">{{ TARGET_LABEL[view.config.targetType] }}</span>
              <RouterLink :to="TARGET_ROUTE[view.config.targetType]" class="link" style="margin-left: 6px">
                {{ view.config.targetRef }}
              </RouterLink>
              <div style="color: var(--muted); font-size: 12px; margin-top: 2px">{{ view.config.targetName }}</div>
            </td>
            <td>
              {{ view.config.metric }}
              <div style="font-size: 12px; color: var(--muted)">
                [{{ view.config.thresholdLower ?? '∞小' }}, {{ view.config.thresholdUpper ?? '∞大' }}]
                · 连缺{{ view.config.missingLimit }}次 · 迟到{{ view.config.lateLimitMinutes }}分钟
              </div>
            </td>
            <td><span :class="severityClass(view.config.severity)">{{ view.config.severity }}</span></td>
            <td>
              <strong>{{ view.config.priority }}</strong>
              <span style="color: var(--muted); font-size: 12px">（小者优先）</span>
            </td>
            <td style="max-width: 220px">{{ view.config.recoverCondition }}</td>
            <td><span class="badge green">{{ view.config.status }}</span></td>
            <td class="row-actions">
              <button class="link" type="button" @click="emit('select', view.config.id)">时间轴</button>
              <button class="link" type="button" @click="emit('lookback', view.config.id)">回看核对</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="conflictGroups.length" class="panel-card">
      <h3 class="panel-title">同任务多配置的阈值冲突裁定</h3>
      <p class="panel-hint">裁定规则：同一被监视对象 + 同一指标存在冲突阈值时，priority 数字最小者为权威口径；非权威配置的告警仍锁定留痕，但标注「已覆盖」，不作任务级结论。</p>
      <div v-for="group in conflictGroups" :key="group.targetRef + group.metric" class="evidence-box">
        <strong>{{ group.targetRef }} · {{ group.metric }}</strong>
        <table class="data-table" style="margin-top: 8px">
          <thead>
            <tr>
              <th>裁定次序</th><th>配置编号</th><th>阈值口径</th><th>缺测/迟到阈值</th><th>priority</th><th>裁定结果</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(cfg, idx) in group.configs" :key="cfg.id" :class="idx === 0 ? 'winner-row' : 'loser-row'">
              <td>第 {{ idx + 1 }} 位</td>
              <td>{{ cfg.code }}</td>
              <td>[{{ cfg.thresholdLower ?? '∞小' }}, {{ cfg.thresholdUpper ?? '∞大' }}]</td>
              <td>连缺{{ cfg.missingLimit }}次 / 迟到{{ cfg.lateLimitMinutes }}分钟</td>
              <td>{{ cfg.priority }}</td>
              <td>
                <span v-if="idx === 0" class="badge green">权威口径生效</span>
                <span v-else class="badge p2">冲突告警标注已覆盖</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { monitorStore } from '../domain/store'
import type { ConfigView } from '../domain/store'
import { useMonitorVersion } from '../domain/use-monitor'
import { TARGET_LABEL, TARGET_ROUTE, severityClass } from '../badges'

const props = defineProps<{ views: ConfigView[] }>()
const emit = defineEmits<{
  (e: 'select', configId: number): void
  (e: 'lookback', configId: number): void
}>()

const version = useMonitorVersion()

const stats = computed(() => {
  void version.value
  return [
    { label: '监控配置总数', value: props.views.length },
    { label: '已启用配置', value: props.views.filter((v) => v.config.enabled).length },
    {
      label: '活动中告警（权威口径）',
      value: props.views
        .filter((v) => v.authoritative)
        .reduce((sum, v) => sum + v.evaluation.alarms.filter((a) => a.status === '活动中').length, 0),
    },
    {
      label: '被覆盖告警',
      value: props.views.reduce((sum, v) => sum + v.evaluation.alarms.filter((a) => a.overridden).length, 0),
    },
  ]
})

const conflictGroups = computed(() => {
  void version.value
  return monitorStore.getConflictGroups()
})
</script>
