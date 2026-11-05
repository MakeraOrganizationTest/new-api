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

import { buildReportParams, useQuotaReport } from '../../hooks/use-quota-report'
import { sumUsage } from '../../lib/report'
import type { DashboardFilters, QuotaReportRow } from '../../types'
import { ReportTable, type ReportColumn } from '../report/report-table'
import { formatUsageAmount, usageColumns } from '../report/usage-columns'

interface ModelUsageTableProps {
  filters: DashboardFilters
  isAdmin: boolean
}

/** Model call analytics as a table: one row per model over the range. */
export function ModelUsageTable(props: ModelUsageTableProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const params = useMemo(
    () =>
      buildReportParams(props.filters, {
        dimensions: ['model_name'],
        isAdmin: props.isAdmin,
      }),
    [props.filters, props.isAdmin]
  )
  const report = useQuotaReport(params, props.isAdmin)
  const rows = useMemo(() => report.data ?? [], [report.data])
  const totals = useMemo(() => sumUsage(rows), [rows])

  const columns = useMemo<ReportColumn<QuotaReportRow>[]>(
    () => [
      {
        id: 'model_name',
        header: t('Model'),
        sortValue: (row) => row.model_name ?? '',
        cell: (row) => (
          <span className='font-medium'>{row.model_name || t('Unknown')}</span>
        ),
        footer: t('Total'),
      },
      ...usageColumns<QuotaReportRow>(t, locale, totals),
      {
        id: 'average_quota',
        header: t('Average amount per request'),
        numeric: true,
        sortValue: (row) => (row.count ? row.quota / row.count : 0),
        cell: (row) => formatUsageAmount(row.count ? row.quota / row.count : 0),
      },
    ],
    [t, locale, totals]
  )

  return (
    <ReportTable
      label={t('Model Call Analytics')}
      columns={columns}
      rows={rows}
      getRowKey={(row) => row.model_name ?? ''}
      defaultSort={{ id: 'quota', desc: true }}
      isLoading={report.isLoading}
      isError={report.isError}
      onRetry={() => report.refetch()}
    />
  )
}
