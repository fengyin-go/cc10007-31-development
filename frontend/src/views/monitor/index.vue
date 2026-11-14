<template>
  <section class="page" data-module="monitor">
    <header class="page-head">
      <div>
        <h2>任务监控管理</h2>
        <p class="page-desc">
          告警事件、采样时间与历史补数区间共用同一时间轴，区分连续缺测、迟到事件与真实越界；
          迟到不抹告警、恢复后再异常开新事件、重复采样按输入身份去重、冲突阈值按 priority 裁定。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="resetDemo">重置演示数据</button>
      </div>
    </header>

    <nav class="monitor-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        class="monitor-tab"
        :class="{ active: activeTab === tab.key }"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </nav>

    <ConfigPanel
      v-if="activeTab === 'config'"
      :views="views"
      @select="openTimeline"
      @lookback="openLookback"
    />

    <TimelinePanel
      v-if="activeTab === 'timeline'"
      :views="views"
      :selected-id="selectedId"
      @select="selectedId = $event"
      @confirm="openConfirm"
    />

    <AlarmPanel v-if="activeTab === 'alarm'" @confirm="openConfirm" />

    <EvidencePanel v-if="activeTab === 'evidence'" />

    <ReceiptPanel v-if="activeTab === 'receipt'" />

    <LookbackPanel v-if="activeTab === 'lookback'" :views="views" :initial-id="selectedId" />

    <ConfirmModal
      v-if="confirmingCode"
      :event-code="confirmingCode"
      @close="confirmingCode = ''"
      @done="onConfirmed"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { monitorStore } from './domain/store'
import type { ConfigView } from './domain/store'
import { useMonitorVersion } from './domain/use-monitor'
import ConfigPanel from './components/ConfigPanel.vue'
import TimelinePanel from './components/TimelinePanel.vue'
import AlarmPanel from './components/AlarmPanel.vue'
import EvidencePanel from './components/EvidencePanel.vue'
import ReceiptPanel from './components/ReceiptPanel.vue'
import LookbackPanel from './components/LookbackPanel.vue'
import ConfirmModal from './components/ConfirmModal.vue'
import './monitor.css'

const version = useMonitorVersion()

const tabs = [
  { key: 'config', label: '监控配置与裁定' },
  { key: 'timeline', label: '统一时间轴' },
  { key: 'alarm', label: '告警事件' },
  { key: 'evidence', label: '影响证据' },
  { key: 'receipt', label: '故障回执' },
  { key: 'lookback', label: '回看核对' },
] as const

type TabKey = (typeof tabs)[number]['key']
const activeTab = ref<TabKey>('config')
const selectedId = ref(1)
const confirmingCode = ref('')

const views = computed<ConfigView[]>(() => {
  void version.value
  return monitorStore.getConfigViews()
})

function openTimeline(configId: number) {
  selectedId.value = configId
  activeTab.value = 'timeline'
}

function openLookback(configId: number) {
  selectedId.value = configId
  activeTab.value = 'lookback'
}

function openConfirm(eventCode: string) {
  if (eventCode) {
    confirmingCode.value = eventCode
  }
}

function onConfirmed() {
  confirmingCode.value = ''
}

function resetDemo() {
  monitorStore.resetAll()
  selectedId.value = 1
  activeTab.value = 'config'
}
</script>
