import { initializeRuntime } from './app/runtime'
void initializeRuntime().then(() => import('./app/render')).catch((error: unknown) => {
  const root = document.getElementById('root')!
  root.textContent = '启动失败：' + (error instanceof Error ? error.message : String(error))
})
