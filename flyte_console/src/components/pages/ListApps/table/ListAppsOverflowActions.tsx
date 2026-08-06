/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { PopoverMenu } from '@/components/Popovers'
import {
  App,
  Status_DeploymentStatus,
} from '@/gen/flyteidl2/app/app_definition_pb'
import { getStatus } from '@/lib/appUtils'
import { useStartApp, useStopApp } from '@/hooks/useApps'
import { useRouter } from 'next/navigation'
import { getLocation } from '@/lib/windowUtils'

export const ListAppsOverflowActions = ({ app }: { app: App }) => {
  const status = getStatus(app.status?.conditions)
  const router = useRouter()
  const isUnspecifiedOrStopped =
    status === Status_DeploymentStatus.UNASSIGNED ||
    status === Status_DeploymentStatus.STOPPED

  const startApp = useStartApp({ app })
  const stopApp = useStopApp({ app })

  const startStop = isUnspecifiedOrStopped
    ? { id: 'start-app', label: '启动应用', onClick: () => startApp.mutate() }
    : { id: 'stop-app', label: '停止应用', onClick: () => stopApp.mutate() }
  const { pathname } = getLocation()
  const route = pathname.replace('/v2', '')
  const appName = app.metadata?.id?.name

  return (
    <div
      onClick={(e) => {
        e.preventDefault()
      }}
    >
      <PopoverMenu
        items={[
          {
            id: 'app-details',
            label: '查看应用详情',
            onClick: () => {
              router.push(`${route}/${appName}`)
            },
          },
          ...(app.spec?.profile?.type?.toUpperCase() === 'VLLM'
            ? [
                {
                  id: 'edit-model-app',
                  label: '编辑',
                  onClick: () => router.push(`${route}/${appName}/edit`),
                },
              ]
            : []),
          {
            id: 'divider-01',
            type: 'divider',
          },
          startStop,
          {
            id: 'divider-02',
            type: 'divider',
          },
          {
            id: 'copy-name',
            label: '复制应用名称',
            onClick: () =>
              navigator.clipboard.writeText(app.metadata?.id?.name || '-'),
          },
          {
            id: 'copy-endpoint',
            label: '复制访问地址',
            onClick: () =>
              navigator.clipboard.writeText(
                app.status?.ingress?.publicUrl || '-',
              ),
          },
        ]}
        variant="overflow"
        overflowProps={{ orientation: 'horizontal' }}
      />
    </div>
  )
}
