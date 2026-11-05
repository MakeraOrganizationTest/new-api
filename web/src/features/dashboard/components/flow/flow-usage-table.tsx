/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { toIntlLocale } from '@/i18n/languages'
import { ROLE } from '@/lib/roles'

import { buildReportParams, useQuotaReport } from '../../hooks/use-quota-report'
import { sumUsage } from '../../lib/report'
import { getExportRequest } from '../../lib/report-export'
import type {
  DashboardFilters,
  QuotaReportDimension,
  QuotaReportRow,
} from '../../types'
import { ReportTable, type ReportColumn } from '../report/report-table'
import { usageColumns } from '../report/usage-columns'

/** Flow dimensions each role sees, matching the flow chart and export. */
function getFlowDimensions(role: number): QuotaReportDimension[] {
  return getExportRequest('flow', role).dimensions
}

function flowRowKey(row: QuotaReportRow): string {
  return [
    row.user_id,
    row.token_id,
    row.use_group,
    row.model_name,
    row.channel_id,
  ].join('\u001f')
}

function mask(value: string, hidden: boolean): string {
  if (!hidden) return value
  if (value.length <= 2) return '••'
  return `${value.slice(0, 1)}••${value.slice(-1)}`
}

interface FlowUsageTableProps {
  filters: DashboardFilters
  role: number
  /** Hide user, token, group and channel names, like the flow chart toggle. */
  maskSensitive: boolean
}

/** Flow as a table: one row per path from user or token to channel. */
export function FlowUsageTable(props: FlowUsageTableProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const isAdmin = props.role >= ROLE.ADMIN
  const params = useMemo(
    () =>
      buildReportParams(props.filters, {
        dimensions: getFlowDimensions(props.role),
        isAdmin: props.role >= ROLE.ADMIN,
      }),
    [props.filters, props.role]
  )
  const report = useQuotaReport(params, isAdmin)
  const rows = useMemo(() => report.data ?? [], [report.data])
  const totals = useMemo(() => sumUsage(rows), [rows])
  const hidden = props.maskSensitive

  const columns = useMemo<ReportColumn<QuotaReportRow>[]>(() => {
    const dimensions = getFlowDimensions(props.role)
    const result: ReportColumn<QuotaReportRow>[] = []
    if (dimensions.includes('user_id')) {
      result.push({
        id: 'user',
        header: t('User'),
        sortValue: (row) => row.username ?? '',
        cell: (row) => mask(row.username ?? '', hidden),
      })
    }
    if (dimensions.includes('token_id')) {
      result.push({
        id: 'token',
        header: t('Token'),
        sortValue: (row) => row.token_name ?? '',
        cell: (row) => {
          if (!row.token_id) return '—'
          const name =
            row.token_name || t('Deleted ({{id}})', { id: row.token_id })
          return mask(name, hidden)
        },
      })
    }
    result.push(
      {
        id: 'group',
        header: t('Group'),
        sortValue: (row) => row.use_group ?? '',
        cell: (row) => mask(row.use_group ?? '', hidden),
      },
      {
        id: 'model',
        header: t('Model'),
        sortValue: (row) => row.model_name ?? '',
        cell: (row) => row.model_name || t('Unknown'),
      }
    )
    if (dimensions.includes('channel_id')) {
      result.push({
        id: 'channel',
        header: t('Channel'),
        sortValue: (row) => row.channel_name ?? '',
        cell: (row) => {
          if (!row.channel_id) return '—'
          const name = row.channel_name
            ? `#${row.channel_id} ${row.channel_name}`
            : `#${row.channel_id}`
          return mask(name, hidden)
        },
      })
    }
    result[0] = { ...result[0], footer: t('Total') }
    return [...result, ...usageColumns<QuotaReportRow>(t, locale, totals)]
  }, [props.role, t, locale, totals, hidden])

  return (
    <ReportTable
      label={t('Flow')}
      columns={columns}
      rows={rows}
      getRowKey={flowRowKey}
      defaultSort={{ id: 'quota', desc: true }}
      isLoading={report.isLoading}
      isError={report.isError}
      onRetry={() => report.refetch()}
    />
  )
}
