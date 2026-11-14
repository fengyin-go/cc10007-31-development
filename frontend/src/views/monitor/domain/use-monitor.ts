import { onBeforeUnmount, onMounted, ref } from 'vue'

import { monitorStore } from './store.ts'

/** 订阅监控仓储变更：任何确认、回执、重置都会触发刷新 */
export function useMonitorVersion() {
  const version = ref(0)
  onMounted(() => {
    onBeforeUnmount(monitorStore.subscribe(() => (version.value += 1)))
  })
  return version
}
