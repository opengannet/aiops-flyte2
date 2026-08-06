/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { createColumnHelper } from '@tanstack/react-table'
import { AppStatusBadge } from '../components/AppStatusBadge'
import { ListAppsOverflowActions } from './ListAppsOverflowActions'
import { AppTableItem } from './types'

const helper = createColumnHelper<AppTableItem>()

export const baseColumns = [
  helper.accessor('status', {
    cell: (info) => <AppStatusBadge status={info.getValue()} />,
    header: '状态',
    minSize: 140,
    size: 140,
  }),

  helper.accessor('replicas', {
    cell: (info) => (
      <span className="truncate overflow-hidden text-sm whitespace-nowrap dark:text-(--system-gray-7)">
        {info.getValue().min} / {info.getValue().max}
      </span>
    ),
    header: '副本数',
    minSize: 85,
    size: 85,
  }),

  helper.accessor('name', {
    cell: (info) => (
      <span className="truncate overflow-hidden text-sm leading-[16px] font-normal whitespace-nowrap">
        {info.getValue().displayText}
      </span>
    ),
    header: '名称',
    minSize: 205,
  }),
  helper.accessor('type', {
    cell: (info) => (
      <span className="truncate text-sm dark:text-(--system-gray-7)">
        {info.getValue() || '-'}
      </span>
    ),
    minSize: 150,
    size: 150,
    header: '类型',
  }),
  helper.accessor('lastDeployed', {
    cell: (info) => (
      <div className="truncate text-sm text-(--system-gray-7)">
        {info.getValue().relativeTime}
      </div>
    ),
    header: () => <span className="text-nowrap">最近部署</span>,
    minSize: 130,
    size: 130,
  }),

  helper.accessor('actions', {
    cell: (info) => <ListAppsOverflowActions app={info.getValue()} />,
    header: '',
    minSize: 50,
    size: 50,
  }),
]
