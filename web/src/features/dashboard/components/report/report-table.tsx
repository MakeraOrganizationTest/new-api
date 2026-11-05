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
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { StaticDataTable } from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import {
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

export interface ReportColumn<T> {
  id: string
  header: string
  /** Value used for sorting; numbers sort numerically. */
  sortValue?: (row: T) => number | string
  cell: (row: T) => ReactNode
  /** Footer cell for the totals row. */
  footer?: ReactNode
  numeric?: boolean
  className?: string
}

interface ReportTableProps<T> {
  columns: ReportColumn<T>[]
  rows: readonly T[]
  getRowKey: (row: T) => string
  defaultSort?: { id: string; desc: boolean }
  isLoading?: boolean
  isError?: boolean
  onRetry?: () => void
  /** Accessible name of the table. */
  label: string
  /** Rows rendered under a row, such as expanded details. */
  renderExpanded?: (row: T) => ReactNode
}

const SKELETON_ROWS = ['a', 'b', 'c', 'd', 'e']

export function ReportTable<T>(props: ReportTableProps<T>) {
  const { t } = useTranslation()
  const [sort, setSort] = useState(props.defaultSort)

  const sortedRows = useMemo(() => {
    const column = props.columns.find((item) => item.id === sort?.id)
    if (!sort || !column?.sortValue) return props.rows
    const valueOf = column.sortValue
    return [...props.rows].sort((a, b) => {
      const left = valueOf(a)
      const right = valueOf(b)
      const order =
        typeof left === 'number' && typeof right === 'number'
          ? left - right
          : String(left).localeCompare(String(right))
      return sort.desc ? -order : order
    })
  }, [props.rows, props.columns, sort])

  const toggleSort = (id: string) => {
    setSort((current) =>
      current?.id === id ? { id, desc: !current.desc } : { id, desc: true }
    )
  }

  const hasFooter = props.columns.some((column) => column.footer !== undefined)

  let body: ReactNode
  if (props.isLoading) {
    body = SKELETON_ROWS.map((key) => (
      <TableRow key={key}>
        {props.columns.map((column) => (
          <TableCell key={column.id}>
            <Skeleton className='h-4 w-full max-w-24' />
          </TableCell>
        ))}
      </TableRow>
    ))
  } else if (props.isError) {
    body = (
      <TableRow>
        <TableCell colSpan={props.columns.length}>
          <ErrorState
            title={t('Failed to load data')}
            onRetry={props.onRetry}
          />
        </TableCell>
      </TableRow>
    )
  } else if (sortedRows.length === 0) {
    body = (
      <TableRow>
        <TableCell colSpan={props.columns.length}>
          <EmptyState title={t('No data available')} />
        </TableCell>
      </TableRow>
    )
  } else {
    body = sortedRows.map((row) => (
      <ReportTableRow
        key={props.getRowKey(row)}
        row={row}
        columns={props.columns}
        expanded={props.renderExpanded?.(row)}
      />
    ))
  }

  return (
    <StaticDataTable tableProps={{ 'aria-label': props.label }}>
      <TableHeader>
        <TableRow>
          {props.columns.map((column) => {
            const active = sort?.id === column.id
            let ariaSort: 'ascending' | 'descending' | 'none' = 'none'
            if (active) ariaSort = sort?.desc ? 'descending' : 'ascending'
            let SortIcon = ArrowUpDown
            if (active) SortIcon = sort?.desc ? ArrowDown : ArrowUp
            return (
              <TableHead
                key={column.id}
                aria-sort={column.sortValue ? ariaSort : undefined}
                className={cn(column.numeric && 'text-end', column.className)}
              >
                {column.sortValue ? (
                  <button
                    type='button'
                    className={cn(
                      'hover:text-foreground inline-flex items-center gap-1',
                      column.numeric && 'flex-row-reverse'
                    )}
                    onClick={() => toggleSort(column.id)}
                  >
                    {column.header}
                    <SortIcon
                      aria-hidden='true'
                      className={cn('size-3.5', !active && 'opacity-40')}
                    />
                  </button>
                ) : (
                  column.header
                )}
              </TableHead>
            )
          })}
        </TableRow>
      </TableHeader>
      <TableBody>{body}</TableBody>
      {hasFooter && !props.isLoading && sortedRows.length > 0 && (
        <TableFooter>
          <TableRow>
            {props.columns.map((column) => (
              <TableCell
                key={column.id}
                className={cn(
                  'font-medium',
                  column.numeric && 'text-end tabular-nums'
                )}
              >
                {column.footer}
              </TableCell>
            ))}
          </TableRow>
        </TableFooter>
      )}
    </StaticDataTable>
  )
}

function ReportTableRow<T>(props: {
  row: T
  columns: ReportColumn<T>[]
  expanded?: ReactNode
}) {
  return (
    <>
      <TableRow>
        {props.columns.map((column) => (
          <TableCell
            key={column.id}
            className={cn(
              column.numeric && 'text-end tabular-nums',
              column.className
            )}
          >
            {column.cell(props.row)}
          </TableCell>
        ))}
      </TableRow>
      {props.expanded}
    </>
  )
}
