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

import type { Department } from '@/features/departments/types'
import { ROLE } from '@/lib/roles'

import type { QuotaReportRow } from '../../types'
import { buildExportSheets, getExportRequest } from '../report-export'

const t = (key: string, options?: Record<string, unknown>) =>
  options?.id === undefined ? key : key.replace('{{id}}', String(options.id))

function department(id: number, name: string, parentId = 0): Department {
  return {
    id,
    parent_id: parentId,
    name,
    sort: 0,
    remark: '',
    created_at: 0,
    updated_at: 0,
    members: 0,
  }
}

const departments = new Map([
  [1, department(1, 'R&D')],
  [2, department(2, 'Frontend', 1)],
  [3, { ...department(3, 'Sales'), deleted: true }],
  [4, department(4, 'Web', 2)],
])

function row(partial: Partial<QuotaReportRow>): QuotaReportRow {
  return {
    count: 1,
    quota: 0,
    token_used: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    ...partial,
  }
}

const ctx = {
  t,
  role: ROLE.ADMIN,
  departments,
  start: new Date(2024, 0, 1),
  end: new Date(2024, 2, 31, 23, 59, 59),
  tzOffset: 8 * 3600,
  exportedBy: 'admin',
  exportedAt: new Date(2024, 3, 1, 9),
  // A simple converter so the amount column is easy to tell from quota.
  amountOf: (quota: number) => quota * 2,
  amountUnit: 'USD',
}

describe('dashboard export sheets', () => {
  it('starts with a notes sheet that states the range and time zone', () => {
    const [notes] = buildExportSheets({}, ctx)
    expect(notes.rows).toContainEqual([
      'Time range',
      '2024-01-01 00:00:00 ~ 2024-03-31 23:59:59',
    ])
    expect(notes.rows).toContainEqual(['Time zone', 'UTC+08:00'])
  })

  it('lists users with the department levels they used quota in and a total row', () => {
    const sheets = buildExportSheets(
      {
        users: [
          row({
            user_id: 1,
            username: 'alice',
            top_department_id: 1,
            mid_department_id: 2,
            department_id: 4,
            quota: 30,
          }),
          row({
            user_id: 1,
            username: 'alice',
            top_department_id: 3,
            department_id: 3,
            quota: 10,
          }),
          row({ user_id: 2, username: 'bob', quota: 60 }),
        ],
      },
      ctx
    )
    const users = sheets[1]
    expect(users.rows[0].slice(0, 5)).toEqual([
      'Username',
      'Display Name',
      'Level-1 department',
      'Level-2 department',
      'Level-3 department',
    ])
    expect(users.rows.slice(1).map((cells) => cells.slice(0, 5))).toEqual([
      ['bob', '', 'Unassigned', '', ''],
      ['alice', '', 'R&D', 'Frontend', 'Web'],
      ['alice', '', 'Sales (Deleted)', '', ''],
      ['Total', '', '', '', ''],
    ])
    // Quota, amount and share are the last three columns.
    expect(users.rows[0].slice(9)).toEqual([
      'Quota',
      'Amount ({{unit}})',
      'Share (%)',
    ])
    expect(users.rows.at(-1)?.slice(9)).toEqual([100, 200, 100])
    expect(users.rows[1].slice(9)).toEqual([60, 120, 60])
  })

  it('lists monthly spending for every department level with subtotals', () => {
    const jan = new Date(2024, 0, 1).getTime() / 1000
    const feb = new Date(2024, 1, 1).getTime() / 1000
    const sheets = buildExportSheets(
      {
        departmentMonthly: [
          row({
            top_department_id: 1,
            mid_department_id: 2,
            department_id: 4,
            created_at: jan,
            quota: 5,
          }),
          row({
            top_department_id: 1,
            mid_department_id: 2,
            department_id: 4,
            created_at: feb,
            quota: 7,
          }),
          row({
            top_department_id: 1,
            department_id: 1,
            created_at: feb,
            quota: 3,
          }),
        ],
      },
      ctx
    )
    // Amounts are quota * 2 in this fixture.
    expect(sheets[1].rows).toEqual([
      [
        'Level-1 department',
        'Level-2 department',
        'Level-3 department',
        'Level',
        '2024-01',
        '2024-02',
        'Amount ({{unit}})',
      ],
      ['R&D', '', '', 1, 10, 20, 30],
      ['R&D', 'Direct members', '', 2, 0, 6, 6],
      ['R&D', 'Frontend', '', 2, 10, 14, 24],
      ['R&D', 'Frontend', 'Web', 3, 10, 14, 24],
      ['Total', '', '', '', 10, 20, 30],
    ])
  })

  it("lists each user's models under the department they were used in", () => {
    const sheets = buildExportSheets(
      {
        userModels: [
          row({
            user_id: 1,
            username: 'alice',
            top_department_id: 1,
            mid_department_id: 2,
            department_id: 2,
            model_name: 'gpt-a',
            quota: 5,
          }),
          row({ user_id: 2, username: 'bob', model_name: 'gpt-b', quota: 40 }),
          row({
            user_id: 1,
            username: 'alice',
            top_department_id: 1,
            mid_department_id: 2,
            department_id: 2,
            model_name: 'gpt-b',
            quota: 25,
          }),
        ],
      },
      ctx
    )
    expect(
      sheets[1].rows
        .slice(1, 4)
        .map((cells) => [cells[0], cells[3], cells[5], cells[10]])
    ).toEqual([
      ['bob', '', 'gpt-b', 40],
      ['alice', 'Frontend', 'gpt-b', 25],
      ['alice', 'Frontend', 'gpt-a', 5],
    ])
  })

  it('lists department members at every level with direct-member rows', () => {
    const sheets = buildExportSheets(
      {
        departmentMembers: [
          row({
            user_id: 1,
            username: 'alice',
            top_department_id: 1,
            mid_department_id: 2,
            department_id: 4,
            quota: 30,
          }),
          row({
            user_id: 3,
            username: 'carol',
            top_department_id: 1,
            mid_department_id: 2,
            department_id: 2,
            quota: 20,
          }),
          row({
            user_id: 1,
            username: 'alice',
            top_department_id: 1,
            department_id: 1,
            quota: 10,
          }),
          row({ user_id: 2, username: 'bob', quota: 5 }),
        ],
      },
      ctx
    )
    expect(sheets[1].rows.map((cells) => cells.slice(0, 4))).toEqual([
      [
        'Level-1 department',
        'Level-2 department',
        'Level-3 department',
        'Username',
      ],
      ['R&D', 'Direct members', '', 'alice'],
      ['R&D', 'Frontend', 'Direct members', 'carol'],
      ['R&D', 'Frontend', 'Web', 'alice'],
      ['Unassigned', '', '', 'bob'],
      ['Total', '', '', ''],
    ])
  })

  it('only asks for department dimensions in administrator sheets', () => {
    expect(getExportRequest('flow', ROLE.USER).dimensions).toEqual([
      'token_id',
      'use_group',
      'model_name',
    ])
    expect(getExportRequest('models', ROLE.USER).dimensions).toEqual([
      'model_name',
    ])
  })
})
