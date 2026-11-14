<template>
  <section class="panel-card">
    <h3 class="panel-title">影响证据（监控确认结果 → 同步/补数任务失败续做读取）</h3>
    <p class="panel-hint">
      确认监控告警时结论写入此处，包含受影响的输入身份与续做建议；同步链路或补数任务失败续做前按关联对象读取，
      按输入身份跳过已处理输入。
    </p>

    <div v-for="evidence in evidenceList" :key="evidence.evidenceCode" class="evidence-box">
      <div style="display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px">
        <strong>{{ evidence.evidenceCode }} · 挂接告警 {{ evidence.alarmEventCode }}</strong>
        <span class="badge blue">{{ TARGET_LABEL[evidence.targetType] }} {{ evidence.targetRef }}</span>
      </div>
      <dl class="kv-list" style="margin-top: 8px">
        <dt>确认结论</dt><dd>{{ evidence.confirmation }}</dd>
        <dt>确认人 / 时间</dt><dd>{{ evidence.confirmer }} · {{ evidence.confirmedAt }}</dd>
        <dt>续做建议</dt><dd>{{ evidence.resumeAdvice }}</dd>
        <dt>受影响输入身份</dt>
        <dd>
          <code v-for="identity in evidence.affectedIdentities" :key="identity" style="display: block; font-size: 12px">
            {{ identity }}
          </code>
          <span v-if="!evidence.affectedIdentities.length" style="color: var(--muted); font-size: 12px">缺测类告警无单一身份，见确认结论</span>
        </dd>
        <dt>续做读取记录</dt>
        <dd>
          <span v-if="evidence.consumedBy.length" class="badge teal">{{ evidence.consumedBy.join('；') }}</span>
          <span v-else style="color: var(--muted); font-size: 12px">尚未被续做读取</span>
        </dd>
      </dl>
      <div style="margin-top: 8px">
        <button class="btn" type="button" @click="simulateResume(evidence.targetRef)">
          模拟 {{ evidence.targetRef }} 失败续做读取
        </button>
        <RouterLink
          v-if="evidence.targetType === 'datasync'"
          :to="'/datasync'"
          class="link"
          style="margin-left: 10px"
        >前往同步链路</RouterLink>
        <RouterLink
          v-else-if="evidence.targetType === 'backfill'"
          :to="'/backfill'"
          class="link"
          style="margin-left: 10px"
        >前往补数任务</RouterLink>
      </div>
    </div>
    <p v-if="!evidenceList.length" class="empty-state">暂无影响证据，可在告警事件上执行「确认并写证据」</p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { monitorStore } from '../domain/store'
import { useMonitorVersion } from '../domain/use-monitor'
import { TARGET_LABEL } from '../badges'

const version = useMonitorVersion()
const evidenceList = computed(() => {
  void version.value
  return monitorStore.getEvidence()
})

function simulateResume(targetRef: string) {
  monitorStore.readEvidenceForTask(targetRef)
}
</script>
