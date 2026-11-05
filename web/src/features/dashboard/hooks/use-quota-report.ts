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
import { useQuery } from '@tanstack/react-query'

import { requireServerSuccess } from '@/lib/server-error-message'
import { computeTimeRange } from '@/lib/time'

import { getQuotaReport } from '../api'
import { getDefaultDays } from '../lib/filters'
import { getTimezoneOffsetSeconds } from '../lib/report-range'
import type {
  DashboardFilters,
  QuotaReportDimension,
  QuotaReportGranularity,
  QuotaReportParams,
} from '../types'

/** Report parameters for the range and user filter applied to the dashboard. */
export function buildReportParams(
  filters: DashboardFilters,
  options: {
    dimensions: QuotaReportDimension[]
    granularity?: QuotaReportGranularity
    departmentId?: number
    isAdmin: boolean
  }
): QuotaReportParams {
  const range = computeTimeRange(
    getDefaultDays(filters.time_granularity),
    filters.start_timestamp,
    filters.end_timestamp
  )
  return {
    ...range,
    dimensions: options.dimensions,
    granularity: options.granularity ?? 'total',
    tz_offset: getTimezoneOffsetSeconds(new Date(range.start_timestamp * 1000)),
    ...(options.isAdmin && filters.username
      ? { username: filters.username }
      : {}),
    ...(options.isAdmin && options.departmentId
      ? { department_id: options.departmentId }
      : {}),
  }
}

export function useQuotaReport(
  params: QuotaReportParams,
  isAdmin: boolean,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: ['dashboard', 'report', isAdmin, params],
    queryFn: async ({ signal }) =>
      requireServerSuccess(await getQuotaReport(params, isAdmin, signal))
        .data ?? [],
    enabled: options?.enabled ?? true,
    staleTime: 60_000,
  })
}
