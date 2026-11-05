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
import { useTranslation } from 'react-i18next'

import { StaticDataTable } from '@/components/data-table'
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatChartTime } from '@/lib/time'

import type { UsageMatrix } from '../../lib/report'
import { formatUsageAmount } from './usage-columns'

interface UsageMatrixTableProps {
  title: string
  matrix: UsageMatrix
  labelOf: (key: string) => string
}

/** Quota per row key and month, with a total column. */
export function UsageMatrixTable(props: UsageMatrixTableProps) {
  const { t } = useTranslation()
  if (props.matrix.rows.length === 0) return null
  return (
    <section aria-label={props.title} className='space-y-2'>
      <h3 className='text-sm font-semibold'>{props.title}</h3>
      <StaticDataTable tableProps={{ 'aria-label': props.title }}>
        <TableHeader>
          <TableRow>
            <TableHead>{t('Department')}</TableHead>
            {props.matrix.periods.map((period) => (
              <TableHead key={period} className='text-end'>
                {formatChartTime(period, 'month')}
              </TableHead>
            ))}
            <TableHead className='text-end'>{t('Total')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.matrix.rows.map((row) => (
            <TableRow key={row.key}>
              <TableCell className='font-medium'>
                {props.labelOf(row.key)}
              </TableCell>
              {props.matrix.periods.map((period) => (
                <TableCell key={period} className='text-end tabular-nums'>
                  {formatUsageAmount(row.cells.get(period)?.quota ?? 0)}
                </TableCell>
              ))}
              <TableCell className='text-end font-medium tabular-nums'>
                {formatUsageAmount(row.total.quota)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </StaticDataTable>
    </section>
  )
}
