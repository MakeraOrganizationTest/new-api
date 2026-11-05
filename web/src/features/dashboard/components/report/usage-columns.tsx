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
import type { TFunction } from 'i18next'

import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber } from '@/lib/format'

import { type UsageTotals, usageShare } from '../../lib/report'
import type { ReportColumn } from './report-table'

const percentFormatters = new Map<string, Intl.NumberFormat>()

function formatShare(value: number, locale: Intl.LocalesArgument): string {
  const key = String(locale ?? '')
  let formatter = percentFormatters.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: 'percent',
      maximumFractionDigits: 1,
    })
    percentFormatters.set(key, formatter)
  }
  return formatter.format(value)
}

/**
 * A quota amount shown like the wallet balance: converted with the system's
 * quota display settings, without abbreviation so totals stay exact.
 */
export function formatUsageAmount(quota: number): string {
  return formatQuotaWithCurrency(quota, { digitsLarge: 2, digitsSmall: 4 })
}

/**
 * Usage metric columns shared by the report tables. The amount column uses
 * the same display as the wallet balance.
 */
export function usageColumns<T extends UsageTotals>(
  t: TFunction,
  locale: Intl.LocalesArgument,
  totals: UsageTotals
): ReportColumn<T>[] {
  const number = (value: number) => formatNumber(value, locale)
  return [
    {
      id: 'count',
      header: t('Requests'),
      numeric: true,
      sortValue: (row) => row.count,
      cell: (row) => number(row.count),
      footer: number(totals.count),
    },
    {
      id: 'token_used',
      header: t('Tokens'),
      numeric: true,
      sortValue: (row) => row.token_used,
      cell: (row) => number(row.token_used),
      footer: number(totals.token_used),
    },
    {
      id: 'cache_read_tokens',
      header: t('Cache Read'),
      numeric: true,
      sortValue: (row) => row.cache_read_tokens,
      cell: (row) => number(row.cache_read_tokens),
      footer: number(totals.cache_read_tokens),
    },
    {
      id: 'cache_creation_tokens',
      header: t('Cache Write'),
      numeric: true,
      sortValue: (row) => row.cache_creation_tokens,
      cell: (row) => number(row.cache_creation_tokens),
      footer: number(totals.cache_creation_tokens),
    },
    {
      id: 'quota',
      header: t('Amount'),
      numeric: true,
      sortValue: (row) => row.quota,
      cell: (row) => formatUsageAmount(row.quota),
      footer: formatUsageAmount(totals.quota),
    },
    {
      id: 'share',
      header: t('Share'),
      numeric: true,
      sortValue: (row) => row.quota,
      cell: (row) => formatShare(usageShare(row.quota, totals.quota), locale),
      footer: totals.quota > 0 ? formatShare(1, locale) : '',
    },
  ]
}
