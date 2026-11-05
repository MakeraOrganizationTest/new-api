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
import { useCallback, useState } from 'react'

export type ReportView = 'chart' | 'table'

const STORAGE_KEY_PREFIX = 'dashboard_report_view_'

function readView(section: string): ReportView {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_PREFIX + section)
    return saved === 'table' ? 'table' : 'chart'
  } catch {
    return 'chart'
  }
}

/** The chart or table view of a dashboard section, remembered per section. */
export function useReportView(section: string) {
  const [views, setViews] = useState<Record<string, ReportView>>({})
  const view = views[section] ?? readView(section)
  const setView = useCallback(
    (next: ReportView) => {
      setViews((current) => ({ ...current, [section]: next }))
      try {
        localStorage.setItem(STORAGE_KEY_PREFIX + section, next)
      } catch {
        // The choice only lasts for this visit when storage is unavailable.
      }
    },
    [section]
  )
  return [view, setView] as const
}
