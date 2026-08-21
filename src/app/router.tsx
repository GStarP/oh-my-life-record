/**
 * 路由（tanstack-router，code-based）：两页 + 底部 tab（RootLayout）。
 */
import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from '@tanstack/react-router'
import { RootLayout } from './root-layout'

const rootRoute = createRootRoute({ component: RootLayout })

const recordsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/records',
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
})

const typeTemplatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/type-templates',
  component: lazyRouteComponent(
    () => import('./routes/type-templates'),
    'TypeTemplatesPage',
  ),
})

// 默认路径重定向到记录页
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/records' })
  },
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  recordsRoute,
  settingsRoute,
  typeTemplatesRoute,
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
