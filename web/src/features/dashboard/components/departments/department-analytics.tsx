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
import { useCallback, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Combobox } from '@/components/ui/combobox'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useDepartments } from '@/features/departments/hooks/use-departments'
import {
  MAX_DEPARTMENT_DEPTH,
  getDepartmentChain,
  getDepartmentOptions,
} from '@/features/departments/lib/tree'

import { DEFAULT_TIME_GRANULARITY } from '../../constants'
import { buildReportParams, useQuotaReport } from '../../hooks/use-quota-report'
import type { ReportView } from '../../hooks/use-report-view'
import {
  type DepartmentGroup,
  buildDepartmentLevelMatrix,
  buildDepartmentUsage,
} from '../../lib/report'
import type { DashboardFilters, QuotaReportDimension } from '../../types'
import { UsageMatrixTable } from '../report/usage-matrix-table'
import { DepartmentCharts } from './department-charts'
import { DepartmentUsageTable } from './department-usage-table'

interface DepartmentAnalyticsProps {
  filters: DashboardFilters
  view: ReportView
}

const SNAPSHOT_DIMENSIONS: QuotaReportDimension[] = [
  'top_department_id',
  'mid_department_id',
  'department_id',
]

const LEVELS = Array.from({ length: MAX_DEPARTMENT_DEPTH }, (_, i) => i + 1)

/**
 * Department usage for administrators, compared at a chosen level within a
 * chosen department. Usage is grouped by the department a user belonged to
 * when it happened, not by their current department.
 */
export function DepartmentAnalytics(props: DepartmentAnalyticsProps) {
  const { t } = useTranslation()
  const id = useId()
  const { departments, index } = useDepartments({ includeDeleted: true })
  const granularity = props.filters.time_granularity || DEFAULT_TIME_GRANULARITY
  const [scope, setScope] = useState('')
  const [level, setLevel] = useState(1)
  const scopeId = Number(scope) || 0
  // The scope's own level; comparing starts one level below it.
  const scopeDepth = scopeId ? getDepartmentChain(index, scopeId).length : 0
  const levelOptions = LEVELS.filter((item) => item >= Math.max(1, scopeDepth))
  const activeLevel = Math.max(level, Math.max(1, scopeDepth))

  const summaryParams = useMemo(
    () =>
      buildReportParams(props.filters, {
        dimensions: [...SNAPSHOT_DIMENSIONS, 'user_id'],
        departmentId: scopeId,
        isAdmin: true,
      }),
    [props.filters, scopeId]
  )
  const trendParams = useMemo(
    () =>
      buildReportParams(props.filters, {
        dimensions: SNAPSHOT_DIMENSIONS,
        granularity,
        departmentId: scopeId,
        isAdmin: true,
      }),
    [props.filters, granularity, scopeId]
  )
  const monthlyParams = useMemo(
    () =>
      buildReportParams(props.filters, {
        dimensions: SNAPSHOT_DIMENSIONS,
        granularity: 'month',
        departmentId: scopeId,
        isAdmin: true,
      }),
    [props.filters, scopeId]
  )
  const summary = useQuotaReport(summaryParams, true)
  const trend = useQuotaReport(trendParams, true, {
    enabled: props.view === 'chart',
  })
  const monthly = useQuotaReport(monthlyParams, true, {
    enabled: props.view === 'table',
  })

  const tree = useMemo(
    () => buildDepartmentUsage(summary.data ?? []),
    [summary.data]
  )

  const departmentName = useCallback(
    (departmentId: number) => {
      const department = index.get(departmentId)
      if (!department) return `#${departmentId}`
      return department.deleted
        ? `${department.name} ${t('(Deleted)')}`
        : department.name
    },
    [index, t]
  )
  const labelOf = useCallback(
    (departmentId: number) =>
      departmentId === 0 ? t('Unassigned') : departmentName(departmentId),
    [departmentName, t]
  )
  const groupLabel = useCallback(
    (group: DepartmentGroup | undefined) => {
      if (!group || group.departmentId === 0) return t('Unassigned')
      const path = group.path.map(departmentName).join(' / ')
      return group.direct ? `${path} · ${t('Direct members')}` : path
    },
    [departmentName, t]
  )

  const summaryLevel = useMemo(
    () => buildDepartmentLevelMatrix(summary.data ?? [], activeLevel),
    [summary.data, activeLevel]
  )
  const trendLevel = useMemo(
    () => buildDepartmentLevelMatrix(trend.data ?? [], activeLevel),
    [trend.data, activeLevel]
  )
  const monthlyLevel = useMemo(
    () => buildDepartmentLevelMatrix(monthly.data ?? [], activeLevel),
    [monthly.data, activeLevel]
  )

  const scopeOptions = useMemo(
    () => [
      { label: t('All departments'), value: '' },
      ...getDepartmentOptions(departments, t('(Deleted)')).map((option) => ({
        label: option.label,
        value: option.value,
      })),
    ],
    [departments, t]
  )

  const controls = (
    <div className='flex flex-wrap items-end gap-3'>
      <div className='grid gap-1.5'>
        <Label htmlFor={`${id}-scope`} className='text-xs'>
          {t('Department scope')}
        </Label>
        <div className='w-64'>
          <Combobox
            id={`${id}-scope`}
            options={scopeOptions}
            value={scope}
            onValueChange={(value) => {
              const next = value ?? ''
              setScope(next)
              const depth = Number(next)
                ? getDepartmentChain(index, Number(next)).length
                : 0
              // Compare the scope's sub-departments by default.
              setLevel(Math.min(MAX_DEPARTMENT_DEPTH, depth + 1))
            }}
            placeholder={t('All departments')}
            emptyText={t('No departments found')}
            className='h-8 text-sm'
          />
        </div>
      </div>
      <div className='grid gap-1.5'>
        <Label htmlFor={`${id}-level`} className='text-xs'>
          {t('Compare by')}
        </Label>
        <Select
          items={levelOptions.map((item) => ({
            value: String(item),
            label: t('Level-{{level}} departments', { level: item }),
          }))}
          value={String(activeLevel)}
          onValueChange={(value) => value && setLevel(Number(value))}
        >
          <SelectTrigger id={`${id}-level`} className='h-8 w-40 text-sm'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {levelOptions.map((item) => (
                <SelectItem key={item} value={String(item)}>
                  {t('Level-{{level}} departments', { level: item })}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </div>
  )

  if (props.view === 'chart') {
    return (
      <div className='space-y-3'>
        {controls}
        <DepartmentCharts
          items={summaryLevel.matrix.rows.map((row) => ({
            label: groupLabel(summaryLevel.groups.get(row.key)),
            quota: row.total.quota,
          }))}
          points={trendLevel.matrix.rows.flatMap((row) =>
            [...row.cells.entries()].map(([time, usage]) => ({
              time,
              label: groupLabel(trendLevel.groups.get(row.key)),
              quota: usage.quota,
            }))
          )}
          granularity={granularity}
          isLoading={summary.isLoading || trend.isLoading}
        />
      </div>
    )
  }

  return (
    <div className='space-y-4'>
      {controls}
      <DepartmentUsageTable
        departments={tree}
        labelOf={labelOf}
        isLoading={summary.isLoading}
        isError={summary.isError}
        onRetry={() => summary.refetch()}
      />
      {monthlyLevel.matrix.periods.length > 0 && (
        <UsageMatrixTable
          title={t('Monthly department spending')}
          matrix={monthlyLevel.matrix}
          labelOf={(key) => groupLabel(monthlyLevel.groups.get(key))}
        />
      )}
    </div>
  )
}
