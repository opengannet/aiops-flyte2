/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { Table } from '@/components/Tables'
import { baseColumns } from './listAppsColumns'
import { formatAppForTable } from './util'
import { AppTableItem } from './types'
import { App } from '@/gen/flyteidl2/app/app_definition_pb'

export const ListAppsTable = ({ data }: { data: App[] }) => {
  const formattedApps = data.map(formatAppForTable) || []
  return (
    <Table<AppTableItem>
      columns={baseColumns}
      data={formattedApps}
      getRowHref={(appRow) => {
        const appPath = `/domain/${appRow.id?.domain}/project/${appRow.id?.project}/apps/${appRow.id?.name}`
        return appRow.type.toUpperCase() === 'VLLM' ? `${appPath}/edit` : appPath
      }}
    />
  )
}
