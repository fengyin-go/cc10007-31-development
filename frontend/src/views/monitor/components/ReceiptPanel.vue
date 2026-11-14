<template>
  <section class="panel-card">
    <div style="display: flex; justify-content: space-between; align-items: center">
      <h3 class="panel-title" style="margin: 0">故障回执（点不动 / 丢失 / 重复显示 / 对不上）</h3>
      <button class="btn primary" type="button" @click="showForm = !showForm">
        {{ showForm ? '收起登记表' : '登记回执' }}
      </button>
    </div>

    <div v-if="showForm" class="evidence-box" style="border-left-color: #7a5af8; margin-top: 12px">
      <div class="form-grid">
        <label>关联对象编号
          <input v-model="form.targetRef" placeholder="如 DATA-0001 / BACK-0001" />
        </label>
        <label>监控配置编号
          <input v-model="form.configCode" placeholder="如 MONI-0001" />
        </label>
        <label>问题类型
          <select v-model="form.issue">
            <option v-for="issue in issues" :key="issue" :value="issue">{{ issue }}</option>
          </select>
        </label>
        <label>处理结论
          <select v-model="form.verdict">
            <option v-for="verdict in verdicts" :key="verdict" :value="verdict">{{ verdict }}</option>
          </select>
        </label>
        <label class="full">现象描述
          <textarea v-model="form.symptom" rows="2" placeholder="现场观察到的点不动/丢失/重复显示/对不上现象" />
        </label>
        <label class="full">处理结果
          <textarea v-model="form.handling" rows="2" placeholder="写明定位过程与最终处理动作" />
        </label>
        <label>处理人
          <input v-model="form.handler" placeholder="值班人员" />
        </label>
        <label>关联事件编号（可空）
          <input v-model="form.relatedEventCode" placeholder="如 ALM-0001" />
        </label>
      </div>
      <div class="modal-actions">
        <button class="btn ghost" type="button" @click="resetForm">清空</button>
        <button class="btn primary" type="button" @click="submit">提交回执</button>
      </div>
      <p v-if="errorMessage" class="error-text" style="margin-top: 8px">{{ errorMessage }}</p>
    </div>

    <table class="data-table" style="margin-top: 12px">
      <thead>
        <tr>
          <th>回执编号</th><th>关联对象/配置</th><th>问题类型</th><th>现象</th><th>处理结论</th>
          <th>处理结果</th><th>处理人 / 时间</th><th>关联事件</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="receipt in receipts" :key="receipt.receiptCode">
          <td>{{ receipt.receiptCode }}</td>
          <td>{{ receipt.targetRef }}<div style="font-size: 12px; color: var(--muted)">{{ receipt.configCode }}</div></td>
          <td><span class="badge purple">{{ receipt.issue }}</span></td>
          <td style="max-width: 220px; font-size: 12px">{{ receipt.symptom }}</td>
          <td><span :class="verdictClass(receipt.verdict)">{{ receipt.verdict }}</span></td>
          <td style="max-width: 260px; font-size: 12px">{{ receipt.handling }}</td>
          <td style="font-size: 12px">{{ receipt.handler }}<div style="color: var(--muted)">{{ receipt.handledAt }}</div></td>
          <td>{{ receipt.relatedEventCode ?? '—' }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'

import { monitorStore } from '../domain/store'
import { useMonitorVersion } from '../domain/use-monitor'
import type { ReceiptIssue, ReceiptVerdict } from '../domain/types'

const version = useMonitorVersion()
const issues: ReceiptIssue[] = ['点不动', '丢失', '重复显示', '对不上']
const verdicts: ReceiptVerdict[] = ['已恢复', '确认丢失并补发', '按输入身份去重', '口径对齐', '待跟进']

const receipts = computed(() => {
  void version.value
  return monitorStore.getReceipts()
})

const showForm = ref(false)
const errorMessage = ref('')
const form = reactive({
  targetRef: '',
  configCode: '',
  issue: '点不动' as ReceiptIssue,
  symptom: '',
  verdict: '已恢复' as ReceiptVerdict,
  handling: '',
  handler: '值班管理员',
  relatedEventCode: '',
})

function resetForm() {
  form.targetRef = ''
  form.configCode = ''
  form.issue = '点不动'
  form.symptom = ''
  form.verdict = '已恢复'
  form.handling = ''
  form.handler = '值班管理员'
  form.relatedEventCode = ''
  errorMessage.value = ''
}

function submit() {
  if (!form.targetRef.trim() || !form.configCode.trim() || !form.symptom.trim() || !form.handling.trim()) {
    errorMessage.value = '关联对象、配置编号、现象与处理结果为必填项'
    return
  }
  monitorStore.addReceipt({
    targetRef: form.targetRef.trim(),
    configCode: form.configCode.trim(),
    issue: form.issue,
    symptom: form.symptom.trim(),
    verdict: form.verdict,
    handling: form.handling.trim(),
    handler: form.handler.trim() || '值班管理员',
    relatedEventCode: form.relatedEventCode.trim() || null,
  })
  resetForm()
  showForm.value = false
}

function verdictClass(verdict: ReceiptVerdict): string {
  if (verdict === '已恢复') return 'badge green'
  if (verdict === '待跟进') return 'badge red'
  return 'badge blue'
}
</script>
