<template>
  <div class="modal-mask" @click.self="emit('close')">
    <div class="modal-box">
      <h3 class="modal-title">确认告警 {{ eventCode }} 并写入影响证据</h3>
      <p class="panel-hint">
        确认只追加影响证据，不会改变或撤销已锁定的告警；同步链路 / 补数任务失败续做时可按关联对象读取本证据。
      </p>
      <dl class="kv-list" v-if="alarm">
        <dt>事件类型</dt><dd>{{ alarm.kind }}（{{ alarm.severity }}）</dd>
        <dt>事件发生时间</dt><dd>{{ alarm.eventTime }}</dd>
        <dt>数据到达时间</dt><dd>{{ alarm.dataArrivalTime }}</dd>
        <dt>触发证据</dt><dd>{{ alarm.triggerDetail }}</dd>
        <dt>恢复条件</dt><dd>{{ alarm.recoverCondition }}</dd>
        <dt>输入身份</dt><dd><code style="font-size: 12px">{{ alarm.inputIdentity ?? '缺测类告警，无单一身份' }}</code></dd>
      </dl>
      <div class="form-grid" style="margin-top: 12px">
        <label class="full">确认结论
          <textarea v-model="confirmation" rows="3" placeholder="例如：连续缺测属实，源端网络中断，补到的数据仅作迟到留痕，原告警维持有效" />
        </label>
        <label class="full">失败续做建议
          <textarea v-model="resumeAdvice" rows="2" placeholder="例如：同步链路从水位 2026-11-10 05:00 续做，按输入身份跳过已到达采样" />
        </label>
        <label>确认人
          <input v-model="confirmer" />
        </label>
      </div>
      <p v-if="errorMessage" class="error-text" style="margin-top: 8px">{{ errorMessage }}</p>
      <div class="modal-actions">
        <button class="btn ghost" type="button" @click="emit('close')">取消</button>
        <button class="btn primary" type="button" @click="submit">确认并写入证据</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { monitorStore } from '../domain/store'
import type { AlarmEvent } from '../domain/types'

const props = defineProps<{ eventCode: string }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'done'): void }>()

const alarm = computed<AlarmEvent | undefined>(() =>
  monitorStore.getAllAlarms().find((a) => a.eventCode === props.eventCode),
)
const confirmation = ref('')
const resumeAdvice = ref('')
const confirmer = ref('值班管理员')
const errorMessage = ref('')

function submit() {
  if (!confirmation.value.trim() || !resumeAdvice.value.trim()) {
    errorMessage.value = '确认结论与续做建议为必填项'
    return
  }
  try {
    monitorStore.confirmAlarm({
      eventCode: props.eventCode,
      confirmation: confirmation.value.trim(),
      resumeAdvice: resumeAdvice.value.trim(),
      confirmer: confirmer.value.trim() || '值班管理员',
    })
    emit('done')
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '确认失败'
  }
}
</script>
