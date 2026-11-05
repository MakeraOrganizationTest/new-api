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
import {
  type DepartmentIndex,
  snapshotLevels,
} from '@/features/departments/lib/tree'
import dayjs from '@/lib/dayjs'
import { ROLE } from '@/lib/roles'

import type {
  QuotaReportDimension,
  QuotaReportGranularity,
  QuotaReportRow,
} from '../types'
import {
  buildDepartmentUsage,
  buildUsageMatrix,
  sumUsage,
  type DepartmentUsageNode,
  type UsageTotals,
  usageShare,
  userSnapshotKey,
} from './report'
import type { SheetCell, WorkbookSheet } from './xlsx'

type Translate = (key: string, options?: Record<string, unknown>) => string

export type ExportSheetId =
  | 'models'
  | 'flow'
  | 'users'
  | 'userModels'
  | 'departments'
  | 'departmentMembers'
  | 'departmentMonthly'
  | 'userMonthly'

export const EXPORT_SHEETS: {
  id: ExportSheetId
  labelKey: string
  adminOnly: boolean
}[] = [
  { id: 'models', labelKey: 'Model Call Analytics', adminOnly: false },
  { id: 'flow', labelKey: 'Flow', adminOnly: false },
  { id: 'users', labelKey: 'User Analytics', adminOnly: true },
  { id: 'userModels', labelKey: 'User usage details', adminOnly: true },
  { id: 'departments', labelKey: 'Department Analytics', adminOnly: true },
  {
    id: 'departmentMembers',
    labelKey: 'Department member details',
    adminOnly: true,
  },
  {
    id: 'departmentMonthly',
    labelKey: 'Monthly department spending',
    adminOnly: true,
  },
  { id: 'userMonthly', labelKey: 'Monthly user spending', adminOnly: true },
]

/** The report request behind each sheet. */
export function getExportRequest(
  id: ExportSheetId,
  role: number
): { dimensions: QuotaReportDimension[]; granularity: QuotaReportGranularity } {
  switch (id) {
    case 'models':
      return { dimensions: ['model_name'], granularity: 'total' }
    case 'flow':
      if (role >= ROLE.SUPER_ADMIN) {
        return {
          dimensions: [
            'user_id',
            'token_id',
            'use_group',
            'model_name',
            'channel_id',
          ],
          granularity: 'total',
        }
      }
      if (role >= ROLE.ADMIN) {
        return {
          dimensions: ['user_id', 'use_group', 'model_name', 'channel_id'],
          granularity: 'total',
        }
      }
      return {
        dimensions: ['token_id', 'use_group', 'model_name'],
        granularity: 'total',
      }
    case 'users':
    case 'departments':
    case 'departmentMembers':
      return {
        dimensions: [
          'user_id',
          'department_id',
          'top_department_id',
          'mid_department_id',
        ],
        granularity: 'total',
      }
    case 'userModels':
      return {
        dimensions: [
          'user_id',
          'department_id',
          'top_department_id',
          'mid_department_id',
          'model_name',
        ],
        granularity: 'total',
      }
    case 'departmentMonthly':
      return {
        dimensions: ['top_department_id', 'mid_department_id', 'department_id'],
        granularity: 'month',
      }
    case 'userMonthly':
      return {
        dimensions: [
          'user_id',
          'department_id',
          'top_department_id',
          'mid_department_id',
        ],
        granularity: 'month',
      }
  }
}

export interface ExportContext {
  t: Translate
  role: number
  departments: DepartmentIndex
  start: Date
  end: Date
  /** Offset east of UTC in seconds, shown in the notes. */
  tzOffset: number
  exportedBy: string
  exportedAt: Date
  /** Quota converted like the wallet balance, as a plain number. */
  amountOf: (quota: number) => number
  /** Unit of amountOf, such as USD, CNY or Tokens. */
  amountUnit: string
}

function metricHeaders(ctx: ExportContext): string[] {
  const t = ctx.t
  return [
    t('Requests'),
    t('Tokens'),
    t('Cache Read'),
    t('Cache Write'),
    t('Quota'),
    t('Amount ({{unit}})', { unit: ctx.amountUnit }),
  ]
}

function metricCells(ctx: ExportContext, usage: UsageTotals): number[] {
  return [
    usage.count,
    usage.token_used,
    usage.cache_read_tokens,
    usage.cache_creation_tokens,
    usage.quota,
    ctx.amountOf(usage.quota),
  ]
}

function shareCell(part: number, whole: number): number {
  return Math.round(usageShare(part, whole) * 10000) / 100
}

function departmentName(ctx: ExportContext, id: number): string {
  if (id === 0) return ctx.t('Unassigned')
  const department = ctx.departments.get(id)
  if (!department) return `#${id}`
  return department.deleted
    ? `${department.name} ${ctx.t('(Deleted)')}`
    : department.name
}

/** Level 1, 2 and 3 cells for a usage snapshot; empty below its level. */
function departmentCells(
  ctx: ExportContext,
  row: QuotaReportRow
): [string, string, string] {
  const levels = snapshotLevels(
    row.department_id ?? 0,
    row.top_department_id ?? 0,
    row.mid_department_id ?? 0
  )
  if (levels.length === 0) return [ctx.t('Unassigned'), '', '']
  const names = levels.map((id) => departmentName(ctx, id))
  return [names[0] ?? '', names[1] ?? '', names[2] ?? '']
}

function levelHeaders(t: Translate): string[] {
  return [
    t('Level-1 department'),
    t('Level-2 department'),
    t('Level-3 department'),
  ]
}

/** Every department node with its level cells, parents before children. */
function walkDepartments(
  ctx: ExportContext,
  nodes: readonly DepartmentUsageNode[],
  path: string[],
  visit: (node: DepartmentUsageNode, cells: string[]) => void
): void {
  for (const node of nodes) {
    let name = departmentName(ctx, node.departmentId)
    if (node.direct) name = ctx.t('Direct members')
    const cells = [...path, name]
    visit(node, [...cells, '', '', ''].slice(0, 3))
    walkDepartments(ctx, node.children, cells, visit)
  }
}

function userName(row: QuotaReportRow, t: Translate): string {
  const name = row.username ?? ''
  return row.user_deleted ? `${name} ${t('(Deleted)')}` : name
}

function formatOffset(seconds: number): string {
  const sign = seconds < 0 ? '-' : '+'
  const total = Math.abs(seconds)
  const hours = String(Math.floor(total / 3600)).padStart(2, '0')
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  return `UTC${sign}${hours}:${minutes}`
}

function byQuota(a: QuotaReportRow, b: QuotaReportRow): number {
  return b.quota - a.quota || b.count - a.count
}

function notesSheet(ctx: ExportContext): WorkbookSheet {
  const t = ctx.t
  const format = (date: Date) => dayjs(date).format('YYYY-MM-DD HH:mm:ss')
  return {
    name: t('Notes'),
    columnWidths: [22, 80],
    rows: [
      [t('Dashboard usage report')],
      [t('Time range'), `${format(ctx.start)} ~ ${format(ctx.end)}`],
      [t('Time zone'), formatOffset(ctx.tzOffset)],
      [t('Exported by'), ctx.exportedBy],
      [t('Exported at'), format(ctx.exportedAt)],
      [
        t('Amount unit'),
        t(
          '{{unit}}, converted from quota like the wallet balance; the Quota column keeps the raw value for reconciliation',
          { unit: ctx.amountUnit }
        ),
      ],
      [
        t('Departments'),
        t(
          'Usage is counted under the department a user belonged to when it happened.'
        ),
      ],
      [
        t('Data source'),
        t(
          'Dashboard data is aggregated by hour and saved on an interval, so the latest minutes may be missing.'
        ),
      ],
    ],
  }
}

function modelsSheet(
  ctx: ExportContext,
  rows: QuotaReportRow[]
): WorkbookSheet {
  const t = ctx.t
  const total = sumUsage(rows)
  return {
    name: t('Model Call Analytics'),
    header: true,
    columnWidths: [36, 12, 14, 14, 14, 16, 10],
    rows: [
      [t('Model'), ...metricHeaders(ctx), t('Share (%)')],
      ...[...rows]
        .sort(byQuota)
        .map((row) => [
          row.model_name || t('Unknown'),
          ...metricCells(ctx, row),
          shareCell(row.quota, total.quota),
        ]),
      [t('Total'), ...metricCells(ctx, total), total.quota > 0 ? 100 : 0],
    ],
  }
}

function flowSheet(ctx: ExportContext, rows: QuotaReportRow[]): WorkbookSheet {
  const t = ctx.t
  const dimensions = getExportRequest('flow', ctx.role).dimensions
  const headers: string[] = []
  if (dimensions.includes('user_id')) headers.push(t('User'))
  if (dimensions.includes('token_id')) headers.push(t('Token'))
  headers.push(t('Group'), t('Model'))
  if (dimensions.includes('channel_id')) headers.push(t('Channel'))
  const total = sumUsage(rows)
  const body = [...rows].sort(byQuota).map((row) => {
    const cells: SheetCell[] = []
    if (dimensions.includes('user_id')) cells.push(userName(row, t))
    if (dimensions.includes('token_id')) {
      cells.push(
        row.token_id
          ? row.token_name || t('Deleted ({{id}})', { id: row.token_id })
          : ''
      )
    }
    cells.push(row.use_group ?? '', row.model_name || t('Unknown'))
    if (dimensions.includes('channel_id')) {
      cells.push(
        row.channel_id
          ? `#${row.channel_id}${row.channel_name ? ` ${row.channel_name}` : ''}`
          : ''
      )
    }
    return [...cells, ...metricCells(ctx, row)]
  })
  const totalRow: SheetCell[] = [t('Total'), ...headers.slice(1).map(() => '')]
  return {
    name: t('Flow'),
    header: true,
    rows: [
      [...headers, ...metricHeaders(ctx)],
      ...body,
      [...totalRow, ...metricCells(ctx, total)],
    ],
  }
}

function usersSheet(ctx: ExportContext, rows: QuotaReportRow[]): WorkbookSheet {
  const t = ctx.t
  const total = sumUsage(rows)
  return {
    name: t('User Analytics'),
    header: true,
    columnWidths: [20, 20, 20, 20, 20, 12, 14, 14, 14, 16, 10],
    rows: [
      [
        t('Username'),
        t('Display Name'),
        ...levelHeaders(t),
        ...metricHeaders(ctx),
        t('Share (%)'),
      ],
      ...[...rows]
        .sort(byQuota)
        .map((row) => [
          userName(row, t),
          row.display_name ?? '',
          ...departmentCells(ctx, row),
          ...metricCells(ctx, row),
          shareCell(row.quota, total.quota),
        ]),
      [
        t('Total'),
        '',
        '',
        '',
        '',
        ...metricCells(ctx, total),
        total.quota > 0 ? 100 : 0,
      ],
    ],
  }
}

function departmentsSheet(
  ctx: ExportContext,
  rows: QuotaReportRow[]
): WorkbookSheet {
  const t = ctx.t
  const departments = buildDepartmentUsage(rows)
  const total = sumUsage(departments)
  const body: SheetCell[][] = []
  walkDepartments(ctx, departments, [], (node, cells) => {
    body.push([
      ...cells,
      node.depth + 1,
      node.memberCount,
      ...metricCells(ctx, node),
      shareCell(node.quota, total.quota),
    ])
  })
  return {
    name: t('Department Analytics'),
    header: true,
    columnWidths: [22, 22, 22, 8, 16, 12, 14, 14, 14, 16, 16, 10],
    rows: [
      [
        ...levelHeaders(t),
        t('Level'),
        t('Members with usage'),
        ...metricHeaders(ctx),
        t('Share (%)'),
      ],
      ...body,
      [
        t('Total'),
        '',
        '',
        '',
        '',
        ...metricCells(ctx, total),
        total.quota > 0 ? 100 : 0,
      ],
    ],
  }
}

/**
 * Monthly spending per department at every level: each level-1 department,
 * then its level-2 subtotals and level-3 rows, with direct-member rows where
 * a department has both members and sub-departments.
 */
function departmentMonthlySheet(
  ctx: ExportContext,
  rows: QuotaReportRow[]
): WorkbookSheet {
  const t = ctx.t
  const departments = buildDepartmentUsage(rows)
  const periods = [...new Set(rows.map((row) => row.created_at ?? 0))].sort(
    (a, b) => a - b
  )
  const months = periods.map((period) => dayjs(period * 1000).format('YYYY-MM'))
  const body: SheetCell[][] = []
  walkDepartments(ctx, departments, [], (node, cells) => {
    body.push([
      ...cells,
      node.depth + 1,
      ...periods.map((period) =>
        ctx.amountOf(node.periods.get(period)?.quota ?? 0)
      ),
      ctx.amountOf(node.quota),
    ])
  })
  // Column totals add up level-1 rows only, so subtotals are not counted twice.
  const columnQuota = periods.map((period) =>
    departments.reduce(
      (sum, node) => sum + (node.periods.get(period)?.quota ?? 0),
      0
    )
  )
  return {
    name: t('Monthly department spending'),
    header: true,
    rows: [
      [
        ...levelHeaders(t),
        t('Level'),
        ...months,
        t('Amount ({{unit}})', { unit: ctx.amountUnit }),
      ],
      ...body,
      [
        t('Total'),
        '',
        '',
        '',
        ...columnQuota.map(ctx.amountOf),
        ctx.amountOf(columnQuota.reduce((sum, value) => sum + value, 0)),
      ],
    ],
  }
}

/** Every user's usage per model, under the department it was recorded in. */
function userModelsSheet(
  ctx: ExportContext,
  rows: QuotaReportRow[]
): WorkbookSheet {
  const t = ctx.t
  const total = sumUsage(rows)
  const userTotals = new Map<string, number>()
  for (const row of rows) {
    const key = userSnapshotKey(row)
    userTotals.set(key, (userTotals.get(key) ?? 0) + row.quota)
  }
  const keyOf = userSnapshotKey
  // Users by total quota, then each user's models by quota.
  const sorted = [...rows].sort(
    (a, b) =>
      (userTotals.get(keyOf(b)) ?? 0) - (userTotals.get(keyOf(a)) ?? 0) ||
      keyOf(a).localeCompare(keyOf(b)) ||
      byQuota(a, b)
  )
  return {
    name: t('User usage details'),
    header: true,
    columnWidths: [20, 20, 20, 20, 20, 32, 12, 14, 14, 14, 16, 10],
    rows: [
      [
        t('Username'),
        t('Display Name'),
        ...levelHeaders(t),
        t('Model'),
        ...metricHeaders(ctx),
        t('Share (%)'),
      ],
      ...sorted.map((row) => [
        userName(row, t),
        row.display_name ?? '',
        ...departmentCells(ctx, row),
        row.model_name || t('Unknown'),
        ...metricCells(ctx, row),
        shareCell(row.quota, total.quota),
      ]),
      [
        t('Total'),
        '',
        '',
        '',
        '',
        '',
        ...metricCells(ctx, total),
        total.quota > 0 ? 100 : 0,
      ],
    ],
  }
}

/** Each department's members with the usage recorded in that department. */
function departmentMembersSheet(
  ctx: ExportContext,
  rows: QuotaReportRow[]
): WorkbookSheet {
  const t = ctx.t
  const departments = buildDepartmentUsage(rows)
  const total = sumUsage(departments)
  const body: SheetCell[][] = []
  walkDepartments(ctx, departments, [], (node, cells) => {
    for (const member of node.members) {
      body.push([
        ...cells,
        member.userDeleted
          ? `${member.username} ${t('(Deleted)')}`
          : member.username,
        member.displayName,
        ...metricCells(ctx, member),
        shareCell(member.quota, total.quota),
      ])
    }
  })
  return {
    name: t('Department member details'),
    header: true,
    columnWidths: [22, 22, 22, 20, 20, 12, 14, 14, 14, 16, 10],
    rows: [
      [
        ...levelHeaders(t),
        t('Username'),
        t('Display Name'),
        ...metricHeaders(ctx),
        t('Share (%)'),
      ],
      ...body,
      [
        t('Total'),
        '',
        '',
        '',
        '',
        ...metricCells(ctx, total),
        total.quota > 0 ? 100 : 0,
      ],
    ],
  }
}

function monthlySheet(
  name: string,
  leadHeaders: string[],
  rows: QuotaReportRow[],
  keyOf: (row: QuotaReportRow) => string,
  leadCells: (key: string, sample: QuotaReportRow) => SheetCell[],
  ctx: ExportContext
): WorkbookSheet {
  const t = ctx.t
  const amountOf = ctx.amountOf
  const matrix = buildUsageMatrix(rows, keyOf)
  const samples = new Map<string, QuotaReportRow>()
  for (const row of rows) {
    const key = keyOf(row)
    if (!samples.has(key)) samples.set(key, row)
  }
  const months = matrix.periods.map((period) =>
    dayjs(period * 1000).format('YYYY-MM')
  )
  const columnQuota = matrix.periods.map((period) =>
    matrix.rows.reduce(
      (sum, row) => sum + (row.cells.get(period)?.quota ?? 0),
      0
    )
  )
  // Totals convert the summed quota, so rounding never drifts.
  const columnTotals = columnQuota.map(amountOf)
  const grandTotal = amountOf(
    columnQuota.reduce((sum, value) => sum + value, 0)
  )
  return {
    name,
    header: true,
    rows: [
      [
        ...leadHeaders,
        ...months,
        t('Amount ({{unit}})', { unit: ctx.amountUnit }),
      ],
      ...matrix.rows.map((row) => [
        ...leadCells(row.key, samples.get(row.key) as QuotaReportRow),
        ...matrix.periods.map((period) =>
          amountOf(row.cells.get(period)?.quota ?? 0)
        ),
        amountOf(row.total.quota),
      ]),
      [
        t('Total'),
        ...leadHeaders.slice(1).map(() => ''),
        ...columnTotals,
        grandTotal,
      ],
    ],
  }
}

/** Workbook sheets in the dashboard's tab order, after the notes sheet. */
export function buildExportSheets(
  data: Partial<Record<ExportSheetId, QuotaReportRow[]>>,
  ctx: ExportContext
): WorkbookSheet[] {
  const t = ctx.t
  const sheets: WorkbookSheet[] = [notesSheet(ctx)]
  if (data.models) sheets.push(modelsSheet(ctx, data.models))
  if (data.flow) sheets.push(flowSheet(ctx, data.flow))
  if (data.users) sheets.push(usersSheet(ctx, data.users))
  if (data.userModels) sheets.push(userModelsSheet(ctx, data.userModels))
  if (data.departments) sheets.push(departmentsSheet(ctx, data.departments))
  if (data.departmentMembers) {
    sheets.push(departmentMembersSheet(ctx, data.departmentMembers))
  }
  if (data.departmentMonthly) {
    sheets.push(departmentMonthlySheet(ctx, data.departmentMonthly))
  }
  if (data.userMonthly) {
    sheets.push(
      monthlySheet(
        t('Monthly user spending'),
        [t('Username'), ...levelHeaders(t)],
        data.userMonthly,
        userSnapshotKey,
        (_key, row) => [userName(row, t), ...departmentCells(ctx, row)],
        ctx
      )
    )
  }
  return sheets
}
