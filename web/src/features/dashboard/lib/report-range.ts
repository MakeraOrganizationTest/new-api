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
import dayjs from '@/lib/dayjs'
import type { TimeGranularity } from '@/lib/time'

/**
 * Calendar ranges for reports. Each resolves in the viewer's local time and
 * ends at the end of its last day, or at the next whole hour for ranges that
 * include today, so the current hour's usage is included.
 */
export const REPORT_RANGE_PRESETS = [
  { id: 'today', labelKey: 'Today' },
  { id: 'last7Days', labelKey: 'Last 7 days' },
  { id: 'last30Days', labelKey: 'Last 30 days' },
  { id: 'thisMonth', labelKey: 'Current month' },
  { id: 'lastMonth', labelKey: 'Previous month' },
  { id: 'thisQuarter', labelKey: 'Current quarter' },
  { id: 'lastQuarter', labelKey: 'Previous quarter' },
  { id: 'thisYear', labelKey: 'Current year' },
  { id: 'lastYear', labelKey: 'Previous year' },
] as const

export type ReportRangePresetId = (typeof REPORT_RANGE_PRESETS)[number]['id']

export interface ReportRange {
  start: Date
  end: Date
}

/** Longest range the report API accepts, in days. */
export const REPORT_MAX_RANGE_DAYS = 731
/** Longest range the report API accepts for hourly buckets, in days. */
const REPORT_MAX_HOUR_RANGE_DAYS = 31

function quarterStart(date: dayjs.Dayjs): dayjs.Dayjs {
  return date
    .startOf('month')
    .month(Math.floor(date.month() / 3) * 3)
    .startOf('month')
}

export function resolveReportRangePreset(
  id: ReportRangePresetId,
  now: Date = new Date()
): ReportRange {
  const today = dayjs(now)
  const untilNow = today.add(1, 'hour').startOf('hour').toDate()
  switch (id) {
    case 'today':
      return { start: today.startOf('day').toDate(), end: untilNow }
    case 'last7Days':
      return {
        start: today.subtract(6, 'day').startOf('day').toDate(),
        end: untilNow,
      }
    case 'last30Days':
      return {
        start: today.subtract(29, 'day').startOf('day').toDate(),
        end: untilNow,
      }
    case 'thisMonth':
      return { start: today.startOf('month').toDate(), end: untilNow }
    case 'lastMonth': {
      const lastMonth = today.subtract(1, 'month')
      return {
        start: lastMonth.startOf('month').toDate(),
        end: lastMonth.endOf('month').toDate(),
      }
    }
    case 'thisQuarter':
      return { start: quarterStart(today).toDate(), end: untilNow }
    case 'lastQuarter': {
      const start = quarterStart(today).subtract(3, 'month')
      return {
        start: start.toDate(),
        end: start.add(2, 'month').endOf('month').toDate(),
      }
    }
    case 'thisYear':
      return { start: today.startOf('year').toDate(), end: untilNow }
    case 'lastYear': {
      const lastYear = today.subtract(1, 'year')
      return {
        start: lastYear.startOf('year').toDate(),
        end: lastYear.endOf('year').toDate(),
      }
    }
  }
}

/** The preset whose current range equals range, if any. */
export function detectReportRangePreset(
  range: Partial<ReportRange> | undefined,
  now: Date = new Date()
): ReportRangePresetId | null {
  if (!range?.start || !range.end) return null
  const start = range.start.getTime()
  const end = range.end.getTime()
  for (const preset of REPORT_RANGE_PRESETS) {
    const resolved = resolveReportRangePreset(preset.id, now)
    if (resolved.start.getTime() === start && resolved.end.getTime() === end) {
      return preset.id
    }
  }
  return null
}

function getReportRangeDays(range: ReportRange): number {
  return (range.end.getTime() - range.start.getTime()) / 86_400_000
}

/**
 * Granularities that keep chart buckets distinct for a range. Daily and
 * weekly labels omit the year, so ranges longer than a year use months.
 */
export function getAllowedGranularities(range: ReportRange): TimeGranularity[] {
  const days = getReportRangeDays(range)
  const allowed: TimeGranularity[] = []
  if (days <= REPORT_MAX_HOUR_RANGE_DAYS) allowed.push('hour')
  if (days <= 366) allowed.push('day', 'week')
  allowed.push('month')
  return allowed
}

/** A sensible default granularity for a range. */
export function getDefaultGranularity(range: ReportRange): TimeGranularity {
  const days = getReportRangeDays(range)
  if (days <= 1) return 'hour'
  if (days <= 31) return 'day'
  if (days <= 92) return 'week'
  return 'month'
}

/** Keeps the granularity when the range allows it, otherwise picks one. */
export function fitGranularity(
  range: ReportRange,
  granularity: TimeGranularity | undefined
): TimeGranularity {
  if (granularity && getAllowedGranularities(range).includes(granularity)) {
    return granularity
  }
  return getDefaultGranularity(range)
}

/** Offset of the viewer's time zone east of UTC, in seconds, at a date. */
export function getTimezoneOffsetSeconds(date: Date): number {
  return -date.getTimezoneOffset() * 60
}

/** Validation message key for a range, or null when it is valid. */
export function validateReportRange(
  range: Partial<ReportRange>
): string | null {
  if (!range.start || !range.end) return 'Select a start and end time'
  if (range.end.getTime() < range.start.getTime()) {
    return 'End time must be after start time'
  }
  if (getReportRangeDays(range as ReportRange) > REPORT_MAX_RANGE_DAYS) {
    return 'The time range cannot exceed {{days}} days'
  }
  return null
}
