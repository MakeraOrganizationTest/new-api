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
import { Users, Loader2 } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { IconBadge } from '@/components/ui/icon-badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DEFAULT_TIME_GRANULARITY } from '@/features/dashboard/constants'
import { processUserChartData } from '@/features/dashboard/lib'
import type {
  DashboardFilters,
  ProcessedUserChartData,
  QuotaDataItem,
} from '@/features/dashboard/types'
import { useChartTheme } from '@/lib/use-chart-theme'
import { VCHART_OPTION } from '@/lib/vchart'

import { buildReportParams, useQuotaReport } from '../../hooks/use-quota-report'

const USER_CHARTS: {
  value: string
  labelKey: string
  specKey: keyof ProcessedUserChartData
}[] = [
  {
    value: 'rank',
    labelKey: 'User Consumption Ranking',
    specKey: 'spec_user_rank',
  },
  {
    value: 'trend',
    labelKey: 'User Consumption Trend',
    specKey: 'spec_user_trend',
  },
]

/** 0 lists every user. */
const TOP_USER_LIMIT_OPTIONS = [5, 10, 20, 50, 0]

interface UserChartsProps {
  /** The range and granularity shared by the dashboard sections. */
  filters: DashboardFilters
  topUserLimit: number
  onTopUserLimitChange: (limit: number) => void
}

export function UserCharts(props: UserChartsProps) {
  const { t } = useTranslation()
  const { resolvedTheme, themeReady } = useChartTheme()
  const timeGranularity =
    props.filters.time_granularity || DEFAULT_TIME_GRANULARITY

  const params = useMemo(
    () =>
      buildReportParams(props.filters, {
        dimensions: ['user_id'],
        granularity: timeGranularity,
        isAdmin: true,
      }),
    [props.filters, timeGranularity]
  )
  const report = useQuotaReport(params, true)
  const isLoading = report.isLoading
  const topUserLimit = props.topUserLimit

  const chartData = useMemo(() => {
    const data: QuotaDataItem[] = (report.data ?? []).map((row) => ({
      ...row,
      created_at: row.created_at ?? 0,
    }))
    return processUserChartData(
      isLoading ? [] : data,
      timeGranularity,
      t,
      topUserLimit === 0 ? Number.MAX_SAFE_INTEGER : topUserLimit
    )
  }, [report.data, isLoading, timeGranularity, t, topUserLimit])

  return (
    <div className='space-y-3'>
      <div className='flex items-center gap-1.5 overflow-x-auto pb-1 sm:gap-2'>
        <Tabs
          value={String(topUserLimit)}
          onValueChange={(value) => props.onTopUserLimitChange(Number(value))}
          className='shrink-0'
        >
          <TabsList>
            <span className='text-muted-foreground px-2 text-xs font-medium whitespace-nowrap'>
              {t('Top Users')}
            </span>
            {TOP_USER_LIMIT_OPTIONS.map((limit) => (
              <TabsTrigger
                key={limit}
                value={String(limit)}
                className='px-2.5 text-xs'
              >
                {limit === 0 ? t('All') : t('Top {{count}}', { count: limit })}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {isLoading && (
          <Loader2 className='text-muted-foreground size-4 animate-spin' />
        )}
      </div>

      <div className='grid gap-3'>
        {USER_CHARTS.map((chart) => {
          const spec = chartData[chart.specKey]

          return (
            <div
              key={chart.value}
              className='overflow-hidden rounded-lg border'
            >
              <div className='flex w-full items-center gap-2 border-b px-3 py-2 sm:px-5 sm:py-3'>
                <IconBadge tone='info' size='sm'>
                  <Users />
                </IconBadge>
                <div className='text-sm font-semibold'>{t(chart.labelKey)}</div>
              </div>

              <div className='h-[300px] p-1.5 sm:h-96 sm:p-2'>
                {isLoading ? (
                  <Skeleton className='h-full w-full' />
                ) : (
                  themeReady &&
                  spec && (
                    <VChart
                      key={`user-${chart.value}-${topUserLimit}-${resolvedTheme}`}
                      spec={{
                        ...spec,
                        theme: resolvedTheme === 'dark' ? 'dark' : 'light',
                        background: 'transparent',
                      }}
                      option={VCHART_OPTION}
                    />
                  )
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
