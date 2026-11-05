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
import { describe, expect, it } from 'vitest'

import {
  detectReportRangePreset,
  fitGranularity,
  getAllowedGranularities,
  resolveReportRangePreset,
  validateReportRange,
} from '../report-range'

// 2024-05-15 10:20 local time; 2024 is a leap year.
const now = new Date(2024, 4, 15, 10, 20)

describe('report range presets', () => {
  it('resolves last month to its first and last day', () => {
    const range = resolveReportRangePreset('lastMonth', now)
    expect(range.start).toEqual(new Date(2024, 3, 1))
    expect(range.end).toEqual(new Date(2024, 3, 30, 23, 59, 59, 999))
  })

  it('resolves quarters on calendar boundaries', () => {
    expect(resolveReportRangePreset('thisQuarter', now).start).toEqual(
      new Date(2024, 3, 1)
    )
    const lastQuarter = resolveReportRangePreset('lastQuarter', now)
    expect(lastQuarter.start).toEqual(new Date(2024, 0, 1))
    expect(lastQuarter.end).toEqual(new Date(2024, 2, 31, 23, 59, 59, 999))
  })

  it('resolves last quarter across a year boundary', () => {
    const range = resolveReportRangePreset('lastQuarter', new Date(2025, 1, 3))
    expect(range.start).toEqual(new Date(2024, 9, 1))
    expect(range.end).toEqual(new Date(2024, 11, 31, 23, 59, 59, 999))
  })

  it('ends ranges that include today at the next whole hour', () => {
    expect(resolveReportRangePreset('thisMonth', now)).toEqual({
      start: new Date(2024, 4, 1),
      end: new Date(2024, 4, 15, 11),
    })
  })

  it('detects the preset of a range and ignores custom ranges', () => {
    expect(
      detectReportRangePreset(resolveReportRangePreset('lastYear', now), now)
    ).toBe('lastYear')
    expect(
      detectReportRangePreset(
        { start: new Date(2024, 0, 2), end: new Date(2024, 0, 9) },
        now
      )
    ).toBeNull()
  })
})

describe('report granularity', () => {
  it('allows hourly buckets only for ranges up to 31 days', () => {
    const lastMonth = resolveReportRangePreset('lastMonth', now)
    expect(getAllowedGranularities(lastMonth)).toContain('hour')
    const lastYear = resolveReportRangePreset('lastYear', now)
    expect(getAllowedGranularities(lastYear)).toEqual(['day', 'week', 'month'])
  })

  it('uses months only for ranges longer than a year', () => {
    const range = { start: new Date(2023, 0, 1), end: new Date(2024, 4, 1) }
    expect(getAllowedGranularities(range)).toEqual(['month'])
    expect(fitGranularity(range, 'day')).toBe('month')
  })

  it('keeps an allowed granularity', () => {
    const range = resolveReportRangePreset('thisQuarter', now)
    expect(fitGranularity(range, 'day')).toBe('day')
  })
})

describe('validateReportRange', () => {
  it('rejects missing, reversed, and too long ranges', () => {
    expect(validateReportRange({})).toBe('Select a start and end time')
    expect(
      validateReportRange({
        start: new Date(2024, 1, 2),
        end: new Date(2024, 1, 1),
      })
    ).toBe('End time must be after start time')
    expect(
      validateReportRange({
        start: new Date(2020, 0, 1),
        end: new Date(2024, 0, 1),
      })
    ).toBe('The time range cannot exceed {{days}} days')
    expect(
      validateReportRange(resolveReportRangePreset('lastYear', now))
    ).toBeNull()
  })
})
