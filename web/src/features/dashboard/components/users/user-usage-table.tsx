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
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Combobox } from '@/components/ui/combobox'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { TableCell, TableRow } from '@/components/ui/table'
import { useDepartments } from '@/features/departments/hooks/use-departments'
import {
  formatDepartmentSnapshot,
  getDepartmentChain,
  getDepartmentOptions,
} from '@/features/departments/lib/tree'
import { DEPARTMENT_UNASSIGNED } from '@/features/departments/types'
import { toIntlLocale } from '@/i18n/languages'

import { buildReportParams, useQuotaReport } from '../../hooks/use-quota-report'
import { useUserDirectory } from '../../hooks/use-user-directory'
import {
  groupByUserSnapshot,
  sumUsage,
  userSnapshotKey,
  withZeroUsageUsers,
} from '../../lib/report'
import type { DashboardFilters, QuotaReportRow } from '../../types'
import { ReportTable, type ReportColumn } from '../report/report-table'
import { usageColumns } from '../report/usage-columns'

interface UserUsageTableProps {
  filters: DashboardFilters
}

/**
 * Every user's usage over the range. A user who changed department has a
 * row per department, each with the usage recorded there.
 */
export function UserUsageTable(props: UserUsageTableProps) {
  const { t, i18n } = useTranslation()
  const id = useId()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [departmentFilter, setDepartmentFilter] = useState('')
  const [includeIdle, setIncludeIdle] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const { departments, index } = useDepartments({ includeDeleted: true })
  const departmentId = Number(departmentFilter) || 0

  const params = useMemo(
    () =>
      buildReportParams(props.filters, {
        dimensions: [
          'user_id',
          'department_id',
          'top_department_id',
          'mid_department_id',
        ],
        departmentId,
        isAdmin: true,
      }),
    [props.filters, departmentId]
  )
  const report = useQuotaReport(params, true)
  // Per-model detail for every user, loaded once the first row is expanded.
  const detailParams = useMemo(
    () => ({
      ...params,
      dimensions: [
        'user_id',
        'department_id',
        'top_department_id',
        'mid_department_id',
        'model_name',
      ] as typeof params.dimensions,
    }),
    [params]
  )
  const detail = useQuotaReport(detailParams, true, {
    enabled: expanded.size > 0,
  })
  const detailByUser = useMemo(
    () => groupByUserSnapshot(detail.data ?? []),
    [detail.data]
  )
  // Idle users can only be listed when no department or username narrows
  // the report, since those filters would not apply to them.
  const canIncludeIdle = departmentId === 0 && !props.filters.username
  const directory = useUserDirectory(includeIdle && canIncludeIdle)

  const rows = useMemo(() => {
    const reported = report.data ?? []
    if (!includeIdle || !canIncludeIdle || !directory.data) return reported
    return withZeroUsageUsers(reported, directory.data, (deptId) => {
      const chain = getDepartmentChain(index, deptId)
      return { top: chain[0]?.id ?? deptId, mid: chain[1]?.id ?? 0 }
    })
  }, [report.data, includeIdle, canIncludeIdle, directory.data, index])
  const totals = useMemo(() => sumUsage(rows), [rows])

  const departmentOptions = useMemo(
    () => [
      { label: t('All departments'), value: '' },
      { label: t('Unassigned'), value: String(DEPARTMENT_UNASSIGNED) },
      ...getDepartmentOptions(departments, t('(Deleted)')).map((option) => ({
        label: option.label,
        value: option.value,
      })),
    ],
    [departments, t]
  )

  const columns = useMemo<ReportColumn<QuotaReportRow>[]>(
    () => [
      {
        id: 'user',
        header: t('User'),
        sortValue: (row) => row.username ?? '',
        cell: (row) => {
          const key = userSnapshotKey(row)
          const open = expanded.has(key)
          const Icon = open ? ChevronDown : ChevronRight
          const canExpand = row.count > 0
          return (
            <div className='flex min-w-0 items-start gap-1.5'>
              {canExpand ? (
                <button
                  type='button'
                  aria-expanded={open}
                  aria-label={
                    open
                      ? t('Collapse {{name}}', { name: row.username ?? '' })
                      : t('Expand {{name}}', { name: row.username ?? '' })
                  }
                  className='hover:bg-muted -ms-1 mt-0.5 rounded p-0.5'
                  onClick={() =>
                    setExpanded((current) => {
                      const next = new Set(current)
                      if (next.has(key)) next.delete(key)
                      else next.add(key)
                      return next
                    })
                  }
                >
                  <Icon aria-hidden='true' className='size-4' />
                </button>
              ) : (
                <span className='w-4 shrink-0' aria-hidden='true' />
              )}
              <div className='min-w-0'>
                <p className='truncate font-medium'>
                  {row.username}
                  {row.user_deleted ? ` ${t('(Deleted)')}` : ''}
                </p>
                {row.display_name && row.display_name !== row.username && (
                  <p className='text-muted-foreground truncate text-xs'>
                    {row.display_name}
                  </p>
                )}
              </div>
            </div>
          )
        },
        footer: t('Total'),
      },
      {
        id: 'department',
        header: t('Department'),
        sortValue: (row) =>
          formatDepartmentSnapshot(
            index,
            row.department_id ?? 0,
            row.top_department_id ?? 0,
            '',
            row.mid_department_id ?? 0
          ) ?? '',
        cell: (row) =>
          formatDepartmentSnapshot(
            index,
            row.department_id ?? 0,
            row.top_department_id ?? 0,
            t('(Deleted)'),
            row.mid_department_id ?? 0
          ) ?? <span className='text-muted-foreground'>{t('Unassigned')}</span>,
      },
      ...usageColumns<QuotaReportRow>(t, locale, totals),
    ],
    [t, locale, totals, index, expanded]
  )
  const metricColumns = useMemo(
    () => usageColumns<QuotaReportRow>(t, locale, totals),
    [t, locale, totals]
  )

  const renderExpanded = (row: QuotaReportRow) => {
    const key = userSnapshotKey(row)
    if (!expanded.has(key)) return null
    if (detail.isLoading) {
      return (
        <TableRow>
          <TableCell
            colSpan={columns.length}
            className='text-muted-foreground ps-10 text-sm'
          >
            {t('Loading...')}
          </TableCell>
        </TableRow>
      )
    }
    if (detail.isError) {
      return (
        <TableRow>
          <TableCell
            colSpan={columns.length}
            className='text-destructive ps-10 text-sm'
          >
            {t('Failed to load data')}
          </TableCell>
        </TableRow>
      )
    }
    return (detailByUser.get(key) ?? []).map((item) => (
      <TableRow key={`${key}:${item.model_name}`} className='bg-muted/30'>
        <TableCell>
          <span className='text-muted-foreground ps-6 text-sm'>
            {item.model_name || t('Unknown')}
          </span>
        </TableCell>
        <TableCell />
        {metricColumns.map((column) => (
          <TableCell key={column.id} className='text-end tabular-nums'>
            {column.cell(item)}
          </TableCell>
        ))}
      </TableRow>
    ))
  }

  return (
    <div className='space-y-3'>
      <div className='flex flex-wrap items-center gap-3'>
        <div className='w-56'>
          <Combobox
            options={departmentOptions}
            value={departmentFilter}
            onValueChange={(value) => setDepartmentFilter(value ?? '')}
            aria-label={t('Department')}
            placeholder={t('All departments')}
            emptyText={t('No departments found')}
            className='h-8 text-sm'
          />
        </div>
        <div className='flex items-center gap-2'>
          <Switch
            id={`${id}-idle`}
            checked={includeIdle && canIncludeIdle}
            disabled={!canIncludeIdle}
            onCheckedChange={setIncludeIdle}
          />
          <Label htmlFor={`${id}-idle`} className='text-sm font-normal'>
            {t('Include users without usage')}
          </Label>
        </div>
      </div>
      <ReportTable
        label={t('User Analytics')}
        columns={columns}
        rows={rows}
        getRowKey={userSnapshotKey}
        renderExpanded={renderExpanded}
        defaultSort={{ id: 'quota', desc: true }}
        isLoading={report.isLoading || (includeIdle && directory.isLoading)}
        isError={report.isError || directory.isError}
        onRetry={() => {
          void report.refetch()
          if (directory.isError) void directory.refetch()
        }}
      />
    </div>
  )
}
