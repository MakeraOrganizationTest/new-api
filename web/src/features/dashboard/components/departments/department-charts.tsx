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
import { VChart } from '@visactor/react-vchart'
import { Building2 } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { IconBadge } from '@/components/ui/icon-badge'
import { Skeleton } from '@/components/ui/skeleton'
import type { TimeGranularity } from '@/lib/time'
import { useChartTheme } from '@/lib/use-chart-theme'
import { VCHART_OPTION } from '@/lib/vchart'

import {
  type DepartmentChartItem,
  type DepartmentChartPoint,
  buildDepartmentRankSpec,
  buildDepartmentTrendSpec,
} from '../../lib/department-charts'
import { formatUsageAmount } from '../report/usage-columns'

interface DepartmentChartsProps {
  /** Groups being compared, largest first. */
  items: readonly DepartmentChartItem[]
  points: readonly DepartmentChartPoint[]
  granularity: TimeGranularity
  isLoading: boolean
}

export function DepartmentCharts(props: DepartmentChartsProps) {
  const { t } = useTranslation()
  const { resolvedTheme, themeReady } = useChartTheme()
  const charts = useMemo(
    () => [
      {
        id: 'rank',
        title: t('Department spending ranking'),
        spec: buildDepartmentRankSpec(props.items, formatUsageAmount),
        empty: props.items.length === 0,
      },
      {
        id: 'trend',
        title: t('Department spending trend'),
        spec: buildDepartmentTrendSpec(
          props.points,
          props.granularity,
          formatUsageAmount
        ),
        empty: props.points.length === 0,
      },
    ],
    [props.items, props.points, props.granularity, t]
  )

  return (
    <div className='grid gap-3'>
      {charts.map((chart) => (
        <section
          key={chart.id}
          aria-label={chart.title}
          className='overflow-hidden rounded-lg border'
        >
          <div className='flex items-center gap-2 border-b px-3 py-2 sm:px-5 sm:py-3'>
            <IconBadge tone='info' size='sm'>
              <Building2 />
            </IconBadge>
            <h3 className='text-sm font-semibold'>{chart.title}</h3>
          </div>
          <div className='h-[300px] p-1.5 sm:h-96 sm:p-2'>
            {props.isLoading && <Skeleton className='h-full w-full' />}
            {!props.isLoading && chart.empty && (
              <div className='text-muted-foreground flex h-full items-center justify-center text-sm'>
                {t('No data available')}
              </div>
            )}
            {!props.isLoading && !chart.empty && themeReady && (
              <VChart
                key={`department-${chart.id}-${resolvedTheme}`}
                spec={{
                  ...chart.spec,
                  theme: resolvedTheme === 'dark' ? 'dark' : 'light',
                }}
                option={VCHART_OPTION}
              />
            )}
          </div>
        </section>
      ))}
    </div>
  )
}
