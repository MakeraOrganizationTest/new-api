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
import { Fragment, type ReactNode, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TableCell, TableRow } from '@/components/ui/table'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import {
  type DepartmentUsageNode,
  type UsageTotals,
  sumUsage,
} from '../../lib/report'
import { ReportTable, type ReportColumn } from '../report/report-table'
import { usageColumns } from '../report/usage-columns'

interface DepartmentUsageTableProps {
  departments: readonly DepartmentUsageNode[]
  labelOf: (departmentId: number) => string
  isLoading: boolean
  isError: boolean
  onRetry: () => void
}

// Indent per tree level, as Tailwind padding classes.
const INDENT = ['ps-0', 'ps-6', 'ps-12', 'ps-18', 'ps-24']

function nodeKey(node: DepartmentUsageNode, parentKey: string): string {
  return `${parentKey}/${node.direct ? 'direct' : node.departmentId}`
}

/**
 * Departments as an expandable tree: each level expands into direct members
 * and sub-departments, and the deepest rows list the members who used quota
 * there.
 */
export function DepartmentUsageTable(props: DepartmentUsageTableProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const totals = useMemo(() => sumUsage(props.departments), [props.departments])
  const metricColumns = useMemo(
    () => usageColumns<UsageTotals>(t, locale, totals),
    [t, locale, totals]
  )

  const toggle = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const expandButton = (key: string, label: string) => {
    const open = expanded.has(key)
    const Icon = open ? ChevronDown : ChevronRight
    return (
      <button
        type='button'
        aria-expanded={open}
        aria-label={
          open
            ? t('Collapse {{name}}', { name: label })
            : t('Expand {{name}}', { name: label })
        }
        className='hover:bg-muted -ms-1 rounded p-0.5'
        onClick={() => toggle(key)}
      >
        <Icon aria-hidden='true' className='size-4' />
      </button>
    )
  }

  const nodeLabel = (node: DepartmentUsageNode) => {
    if (node.departmentId === 0) return t('Unassigned')
    return node.direct ? t('Direct members') : props.labelOf(node.departmentId)
  }

  const metricCells = (usage: UsageTotals) =>
    metricColumns.map((column) => (
      <TableCell key={column.id} className='text-end tabular-nums'>
        {column.cell(usage)}
      </TableCell>
    ))

  const renderMembers = (node: DepartmentUsageNode, key: string) =>
    node.members.map((member) => (
      <TableRow key={`${key}:${member.userId}`}>
        <TableCell>
          <div className={cn('min-w-0', INDENT[node.depth + 1])}>
            <span className='truncate'>
              {member.username}
              {member.userDeleted ? ` ${t('(Deleted)')}` : ''}
            </span>
            {member.displayName && member.displayName !== member.username && (
              <span className='text-muted-foreground ms-2 text-xs'>
                {member.displayName}
              </span>
            )}
          </div>
        </TableCell>
        <TableCell />
        {metricCells(member)}
      </TableRow>
    ))

  // Rows under an expanded node: its members or its child departments.
  const renderChildren = (
    node: DepartmentUsageNode,
    key: string
  ): ReactNode => {
    if (!expanded.has(key)) return null
    if (node.children.length === 0) return renderMembers(node, key)
    return node.children.map((child) => {
      const childKey = nodeKey(child, key)
      const label = nodeLabel(child)
      return (
        <Fragment key={childKey}>
          <TableRow className='bg-muted/30'>
            <TableCell>
              <div
                className={cn('flex items-center gap-1.5', INDENT[child.depth])}
              >
                {expandButton(childKey, label)}
                <span className={cn(child.direct && 'text-muted-foreground')}>
                  {label}
                </span>
              </div>
            </TableCell>
            <TableCell className='text-end tabular-nums'>
              {formatNumber(child.memberCount, locale)}
            </TableCell>
            {metricCells(child)}
          </TableRow>
          {renderChildren(child, childKey)}
        </Fragment>
      )
    })
  }

  const columns = useMemo<ReportColumn<DepartmentUsageNode>[]>(
    () => [
      {
        id: 'department',
        header: t('Department'),
        sortValue: (row) => nodeLabel(row),
        cell: (row) => {
          const label = nodeLabel(row)
          return (
            <div className='flex items-center gap-1.5 font-medium'>
              {expandButton(nodeKey(row, ''), label)}
              {label}
            </div>
          )
        },
        footer: t('Total'),
      },
      {
        id: 'members',
        header: t('Members with usage'),
        numeric: true,
        sortValue: (row) => row.memberCount,
        cell: (row) => formatNumber(row.memberCount, locale),
      },
      ...(metricColumns as ReportColumn<DepartmentUsageNode>[]),
    ],
    // The name cell reads the expanded set through expandButton.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, locale, metricColumns, props.labelOf, expanded]
  )

  return (
    <ReportTable
      label={t('Department Analytics')}
      columns={columns}
      rows={props.departments}
      getRowKey={(row) => String(row.departmentId)}
      defaultSort={{ id: 'quota', desc: true }}
      isLoading={props.isLoading}
      isError={props.isError}
      onRetry={props.onRetry}
      renderExpanded={(row) => renderChildren(row, nodeKey(row, ''))}
    />
  )
}
