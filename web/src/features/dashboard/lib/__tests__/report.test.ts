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

import type { QuotaReportRow } from '../../types'
import {
  buildDepartmentLevelMatrix,
  buildDepartmentUsage,
  departmentGroupOf,
  buildUsageMatrix,
  groupByUserSnapshot,
  sumUsage,
  withZeroUsageUsers,
} from '../report'

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

describe('buildDepartmentUsage', () => {
  it('keeps the usage of a user who moved under each department', () => {
    // alice used 30 in R&D (1) / Frontend (3), then 20 directly in Sales (2).
    const report = buildDepartmentUsage([
      row({
        top_department_id: 1,
        department_id: 3,
        user_id: 7,
        username: 'alice',
        quota: 30,
      }),
      row({
        top_department_id: 2,
        department_id: 2,
        user_id: 7,
        username: 'alice',
        quota: 20,
      }),
      row({
        top_department_id: 1,
        department_id: 1,
        user_id: 8,
        username: 'bob',
        quota: 5,
      }),
    ])

    expect(report.map((top) => [top.departmentId, top.quota])).toEqual([
      [1, 35],
      [2, 20],
    ])
    const rd = report[0]
    expect(rd.memberCount).toBe(2)
    // Direct members come first even when a sub-department used more.
    expect(rd.children.map((node) => [node.departmentId, node.direct])).toEqual(
      [
        [1, true],
        [3, false],
      ]
    )
    expect(rd.children[1].members.map((member) => member.username)).toEqual([
      'alice',
    ])
  })

  it('puts usage without a department last', () => {
    const report = buildDepartmentUsage([
      row({ top_department_id: 0, department_id: 0, user_id: 9, quota: 100 }),
      row({ top_department_id: 1, department_id: 1, user_id: 8, quota: 1 }),
    ])
    expect(report.map((top) => top.departmentId)).toEqual([1, 0])
  })

  it('returns no departments for no rows', () => {
    expect(buildDepartmentUsage([])).toEqual([])
  })
})

describe('buildDepartmentUsage with three levels', () => {
  it('nests level 3 under level 2 and adds direct-member rows', () => {
    // R&D (1) / Frontend (3) / Web (5); carol sits directly in Frontend.
    const [rd] = buildDepartmentUsage([
      row({
        top_department_id: 1,
        mid_department_id: 3,
        department_id: 5,
        user_id: 7,
        username: 'alice',
        quota: 10,
      }),
      row({
        top_department_id: 1,
        mid_department_id: 3,
        department_id: 3,
        user_id: 8,
        username: 'carol',
        quota: 4,
      }),
    ])
    expect(rd.quota).toBe(14)
    const frontend = rd.children[0]
    expect([
      frontend.departmentId,
      frontend.depth,
      frontend.memberCount,
    ]).toEqual([3, 1, 2])
    expect(
      frontend.children.map((node) => [node.departmentId, node.direct])
    ).toEqual([
      [3, true],
      [5, false],
    ])
    expect(
      frontend.children[1].members.map((member) => member.username)
    ).toEqual(['alice'])
  })
})

describe('buildUsageMatrix', () => {
  it('pivots rows by key and period and totals each key', () => {
    const matrix = buildUsageMatrix(
      [
        row({ top_department_id: 1, created_at: 200, quota: 5 }),
        row({ top_department_id: 1, created_at: 100, quota: 3 }),
        row({ top_department_id: 2, created_at: 100, quota: 10 }),
        row({ top_department_id: 1, created_at: 100, quota: 2 }),
      ],
      (item) => String(item.top_department_id)
    )
    expect(matrix.periods).toEqual([100, 200])
    expect(matrix.rows.map((entry) => [entry.key, entry.total.quota])).toEqual([
      ['1', 10],
      ['2', 10],
    ])
    expect(matrix.rows[0].cells.get(100)?.quota).toBe(5)
    expect(matrix.rows[1].cells.get(200)).toBeUndefined()
  })
})

describe('sumUsage', () => {
  it('adds every metric', () => {
    expect(
      sumUsage([
        row({ quota: 2, token_used: 3, cache_read_tokens: 1 }),
        row({ quota: 5, cache_creation_tokens: 4 }),
      ])
    ).toEqual({
      count: 2,
      quota: 7,
      token_used: 3,
      cache_read_tokens: 1,
      cache_creation_tokens: 4,
    })
  })
})

describe('withZeroUsageUsers', () => {
  it('adds active users without usage under their current department', () => {
    const rows = withZeroUsageUsers(
      [row({ user_id: 1, username: 'alice', quota: 3 })],
      [
        { id: 1, username: 'alice', display_name: 'Alice', department_id: 5 },
        { id: 2, username: 'bob', display_name: 'Bob', department_id: 6 },
        { id: 3, username: 'gone', display_name: '', deleted: true },
      ],
      (departmentId) =>
        departmentId === 6 ? { top: 4, mid: 6 } : { top: departmentId, mid: 0 }
    )
    expect(rows.map((item) => [item.username, item.quota])).toEqual([
      ['alice', 3],
      ['bob', 0],
    ])
    expect(rows[1]).toMatchObject({
      department_id: 6,
      top_department_id: 4,
      mid_department_id: 6,
    })
  })
})

describe('groupByUserSnapshot', () => {
  it("keeps a moved user's model usage apart per department, largest first", () => {
    const groups = groupByUserSnapshot([
      row({
        user_id: 1,
        department_id: 2,
        top_department_id: 1,
        model_name: 'a',
        quota: 1,
      }),
      row({
        user_id: 1,
        department_id: 2,
        top_department_id: 1,
        model_name: 'b',
        quota: 9,
      }),
      row({
        user_id: 1,
        department_id: 3,
        top_department_id: 3,
        model_name: 'a',
        quota: 4,
      }),
    ])
    expect(groups.get('1:2:1:0')?.map((item) => item.model_name)).toEqual([
      'b',
      'a',
    ])
    expect(groups.get('1:3:3:0')?.map((item) => item.quota)).toEqual([4])
  })
})

describe('department level grouping', () => {
  // R&D (1) / Frontend (3) / Web (5); Sales (2) has no sub-departments.
  const rows = [
    row({
      top_department_id: 1,
      mid_department_id: 3,
      department_id: 5,
      created_at: 100,
      quota: 10,
    }),
    row({
      top_department_id: 1,
      mid_department_id: 3,
      department_id: 3,
      created_at: 100,
      quota: 4,
    }),
    row({ top_department_id: 1, department_id: 1, created_at: 200, quota: 2 }),
    row({ top_department_id: 2, department_id: 2, created_at: 200, quota: 7 }),
    row({ created_at: 200, quota: 1 }),
  ]

  it('groups level 1 by top-level department', () => {
    const { matrix } = buildDepartmentLevelMatrix(rows, 1)
    expect(matrix.rows.map((item) => [item.key, item.total.quota])).toEqual([
      ['1', 16],
      ['2', 7],
      ['0', 1],
    ])
  })

  it('keeps usage recorded above the level as a direct group', () => {
    const { matrix, groups } = buildDepartmentLevelMatrix(rows, 2)
    expect(matrix.rows.map((item) => [item.key, item.total.quota])).toEqual([
      ['3', 14],
      ['2:direct', 7],
      ['1:direct', 2],
      ['0', 1],
    ])
    expect(groups.get('3')?.path).toEqual([1, 3])
    expect(matrix.rows[0].cells.get(100)?.quota).toBe(14)
  })

  it('splits level 3 from members directly in level 2', () => {
    expect(departmentGroupOf(rows[0], 3)).toMatchObject({
      key: '5',
      path: [1, 3, 5],
    })
    expect(departmentGroupOf(rows[1], 3)).toMatchObject({
      key: '3:direct',
      direct: true,
    })
  })

  it('tracks per-bucket usage on every tree node and direct row', () => {
    const [rd] = buildDepartmentUsage(rows)
    expect(rd.periods.get(100)?.quota).toBe(14)
    expect(rd.periods.get(200)?.quota).toBe(2)
    const [direct, frontend] = rd.children
    expect(direct.direct).toBe(true)
    expect(direct.periods.get(200)?.quota).toBe(2)
    expect(frontend.children[0].periods.get(100)?.quota).toBe(4)
  })
})
