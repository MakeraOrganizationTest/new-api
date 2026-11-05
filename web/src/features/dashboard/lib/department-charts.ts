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
import { formatChartTime, type TimeGranularity } from '@/lib/time'

import type { VChartSpec } from '../types'

type ChartDatum = Record<string, unknown>

const DEPARTMENT_COLORS = [
  '#1664FF',
  '#1AC6FF',
  '#FF8A00',
  '#3CC780',
  '#7442D4',
  '#FFC400',
  '#304D77',
  '#B48DEB',
  '#009488',
  '#FF7DDA',
]

export interface DepartmentChartItem {
  label: string
  quota: number
}

export interface DepartmentChartPoint extends DepartmentChartItem {
  /** Bucket start in seconds. */
  time: number
}

/** Spending per department group, in the given order (largest first). */
export function buildDepartmentRankSpec(
  items: readonly DepartmentChartItem[],
  formatValue: (value: number) => string
): VChartSpec {
  const values = items.map((item) => ({
    Department: item.label,
    quota: item.quota,
  }))
  return {
    type: 'bar',
    data: [{ id: 'departmentRank', values }],
    direction: 'horizontal',
    xField: 'quota',
    yField: 'Department',
    seriesField: 'Department',
    axes: [
      { orient: 'left', type: 'band', inverse: true },
      {
        orient: 'bottom',
        type: 'linear',
        label: { formatMethod: (v: unknown) => formatValue(Number(v)) },
      },
    ],
    label: {
      visible: true,
      position: 'outside',
      formatMethod: (_text: unknown, datum?: ChartDatum) =>
        formatValue(Number(datum?.quota ?? 0)),
    },
    tooltip: {
      mark: {
        content: [
          {
            key: (datum?: ChartDatum) => String(datum?.Department ?? ''),
            value: (datum?: ChartDatum) =>
              formatValue(Number(datum?.quota ?? 0)),
          },
        ],
      },
    },
    legends: { visible: false },
    color: DEPARTMENT_COLORS,
    background: 'transparent',
  }
}

/** Spending per department group over time buckets. */
export function buildDepartmentTrendSpec(
  points: readonly DepartmentChartPoint[],
  granularity: TimeGranularity,
  formatValue: (value: number) => string
): VChartSpec {
  const values = [...points]
    .sort((a, b) => a.time - b.time)
    .map((point) => ({
      Time: formatChartTime(point.time, granularity),
      Department: point.label,
      quota: point.quota,
    }))
  return {
    type: 'line',
    data: [{ id: 'departmentTrend', values }],
    xField: 'Time',
    yField: 'quota',
    seriesField: 'Department',
    point: { visible: values.length <= 60 },
    axes: [
      { orient: 'bottom', type: 'band' },
      {
        orient: 'left',
        type: 'linear',
        label: { formatMethod: (v: unknown) => formatValue(Number(v)) },
      },
    ],
    tooltip: {
      dimension: {
        content: [
          {
            key: (datum?: ChartDatum) => String(datum?.Department ?? ''),
            value: (datum?: ChartDatum) =>
              formatValue(Number(datum?.quota ?? 0)),
          },
        ],
      },
    },
    legends: { visible: true, orient: 'bottom' },
    color: DEPARTMENT_COLORS,
    background: 'transparent',
  }
}
