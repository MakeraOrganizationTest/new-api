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
import { snapshotLevels } from '@/features/departments/lib/tree'

import type { QuotaReportRow } from '../types'

export interface UsageTotals {
  count: number
  quota: number
  token_used: number
  cache_read_tokens: number
  cache_creation_tokens: number
}

const EMPTY_USAGE_TOTALS: UsageTotals = {
  count: 0,
  quota: 0,
  token_used: 0,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
}

function addUsage(target: UsageTotals, row: UsageTotals): void {
  target.count += row.count || 0
  target.quota += row.quota || 0
  target.token_used += row.token_used || 0
  target.cache_read_tokens += row.cache_read_tokens || 0
  target.cache_creation_tokens += row.cache_creation_tokens || 0
}

export function sumUsage(rows: readonly UsageTotals[]): UsageTotals {
  const total = { ...EMPTY_USAGE_TOTALS }
  for (const row of rows) addUsage(total, row)
  return total
}

/** Share of a part in a whole, 0 when the whole is empty. */
export function usageShare(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0
}

/** A member of a department in a report: usage of one user in one place. */
export interface DepartmentMemberUsage extends UsageTotals {
  userId: number
  username: string
  displayName: string
  userDeleted: boolean
}

/**
 * Usage of one department and everything below it. A department with both
 * its own members and sub-departments gets a "direct" child for its own
 * members, so every member row sits at exactly one place.
 */
export interface DepartmentUsageNode extends UsageTotals {
  /** 0 for usage without a department. */
  departmentId: number
  /** True for the "direct members" row of a department with sub-departments. */
  direct: boolean
  depth: number
  /** Distinct users with usage in this subtree. */
  memberCount: number
  /** Members, for a department without sub-departments or a direct row. */
  members: DepartmentMemberUsage[]
  children: DepartmentUsageNode[]
  /** Usage per bucket start, when the rows were bucketed. */
  periods: Map<number, UsageTotals>
}

interface BuildingNode extends DepartmentUsageNode {
  ownMembers: Map<number, DepartmentMemberUsage>
  /** Usage recorded directly in this department, per bucket. */
  ownPeriods: Map<number, UsageTotals>
  childMap: Map<number, BuildingNode>
  users: Set<number>
}

function newNode(departmentId: number, depth: number): BuildingNode {
  return {
    ...EMPTY_USAGE_TOTALS,
    departmentId,
    direct: false,
    depth,
    memberCount: 0,
    members: [],
    children: [],
    periods: new Map(),
    ownPeriods: new Map(),
    ownMembers: new Map(),
    childMap: new Map(),
    users: new Set(),
  }
}

function addPeriodUsage(
  periods: Map<number, UsageTotals>,
  row: QuotaReportRow
): void {
  const period = row.created_at ?? 0
  let usage = periods.get(period)
  if (!usage) {
    usage = { ...EMPTY_USAGE_TOTALS }
    periods.set(period, usage)
  }
  addUsage(usage, row)
}

function memberOf(row: QuotaReportRow): DepartmentMemberUsage {
  return {
    ...EMPTY_USAGE_TOTALS,
    userId: row.user_id ?? 0,
    username: row.username ?? '',
    displayName: row.display_name ?? '',
    userDeleted: row.user_deleted ?? false,
  }
}

function byQuotaDesc(a: UsageTotals, b: UsageTotals): number {
  return b.quota - a.quota || b.count - a.count
}

function finishNode(node: BuildingNode): DepartmentUsageNode {
  const members = [...node.ownMembers.values()].sort(byQuotaDesc)
  const children = [...node.childMap.values()].map(finishNode).sort(byQuotaDesc)
  const result: DepartmentUsageNode = {
    departmentId: node.departmentId,
    direct: false,
    depth: node.depth,
    memberCount: node.users.size,
    count: node.count,
    quota: node.quota,
    token_used: node.token_used,
    cache_read_tokens: node.cache_read_tokens,
    cache_creation_tokens: node.cache_creation_tokens,
    members: [],
    children,
    periods: node.periods,
  }
  if (children.length === 0) {
    result.members = members
  } else if (members.length > 0) {
    // Direct members come first, then sub-departments by usage.
    result.children = [
      {
        ...sumUsage(members),
        departmentId: node.departmentId,
        direct: true,
        depth: node.depth + 1,
        memberCount: members.length,
        members,
        children: [],
        periods: node.ownPeriods,
      },
      ...children,
    ]
  }
  return result
}

/**
 * Builds the department report from rows grouped by department_id,
 * top_department_id, mid_department_id and user_id. Usage stays where it was
 * recorded: a user who moved departments appears under each department with
 * that period's usage, at the levels the tree had then.
 */
export function buildDepartmentUsage(
  rows: readonly QuotaReportRow[]
): DepartmentUsageNode[] {
  const roots = new Map<number, BuildingNode>()
  for (const row of rows) {
    const levels = snapshotLevels(
      row.department_id ?? 0,
      row.top_department_id ?? 0,
      row.mid_department_id ?? 0
    )
    const path = levels.length > 0 ? levels : [0]
    let root = roots.get(path[0])
    if (!root) {
      root = newNode(path[0], 0)
      roots.set(path[0], root)
    }
    let node: BuildingNode = root
    const visited = [root]
    for (let depth = 1; depth < path.length; depth++) {
      let child = node.childMap.get(path[depth])
      if (!child) {
        child = newNode(path[depth], depth)
        node.childMap.set(path[depth], child)
      }
      node = child
      visited.push(node)
    }
    const userId = row.user_id ?? 0
    for (const visitedNode of visited) {
      addUsage(visitedNode, row)
      addPeriodUsage(visitedNode.periods, row)
      visitedNode.users.add(userId)
    }
    addPeriodUsage(node.ownPeriods, row)
    let member = node.ownMembers.get(userId)
    if (!member) {
      member = memberOf(row)
      node.ownMembers.set(userId, member)
    }
    addUsage(member, row)
  }
  // Usage without a department goes last.
  return [...roots.values()].map(finishNode).sort((a, b) => {
    const aUnassigned = a.departmentId === 0
    if (aUnassigned !== (b.departmentId === 0)) return aUnassigned ? 1 : -1
    return byQuotaDesc(a, b)
  })
}

export interface UsageMatrix {
  /** Bucket starts in ascending order (seconds). */
  periods: number[]
  rows: { key: string; cells: Map<number, UsageTotals>; total: UsageTotals }[]
}

/** Pivots bucketed rows into key x period cells, rows by total quota. */
export function buildUsageMatrix(
  rows: readonly QuotaReportRow[],
  keyOf: (row: QuotaReportRow) => string
): UsageMatrix {
  const periods = new Set<number>()
  const byKey = new Map<string, UsageMatrix['rows'][number]>()
  for (const row of rows) {
    const period = row.created_at ?? 0
    periods.add(period)
    const key = keyOf(row)
    let entry = byKey.get(key)
    if (!entry) {
      entry = { key, cells: new Map(), total: { ...EMPTY_USAGE_TOTALS } }
      byKey.set(key, entry)
    }
    let cell = entry.cells.get(period)
    if (!cell) {
      cell = { ...EMPTY_USAGE_TOTALS }
      entry.cells.set(period, cell)
    }
    addUsage(cell, row)
    addUsage(entry.total, row)
  }
  return {
    periods: [...periods].sort((a, b) => a - b),
    rows: [...byKey.values()].sort((a, b) => byQuotaDesc(a.total, b.total)),
  }
}

export interface UserDirectoryEntry {
  id: number
  username: string
  display_name: string
  department_id?: number
  deleted?: boolean
}

/**
 * Adds a zero-usage row for each active user without usage in the report,
 * under their current department, so a report can list every user.
 */
export function withZeroUsageUsers(
  rows: readonly QuotaReportRow[],
  users: readonly UserDirectoryEntry[],
  levelsOf: (departmentId: number) => { top: number; mid: number }
): QuotaReportRow[] {
  const used = new Set(rows.map((row) => row.user_id ?? 0))
  const extra: QuotaReportRow[] = users
    .filter((user) => !user.deleted && !used.has(user.id))
    .map((user) => {
      const departmentId = user.department_id ?? 0
      return {
        ...EMPTY_USAGE_TOTALS,
        user_id: user.id,
        username: user.username,
        display_name: user.display_name,
        department_id: departmentId,
        top_department_id: departmentId ? levelsOf(departmentId).top : 0,
        mid_department_id: departmentId ? levelsOf(departmentId).mid : 0,
      }
    })
  return [...rows, ...extra]
}

/** Key of a user's usage under one department snapshot. */
export function userSnapshotKey(row: QuotaReportRow): string {
  return `${row.user_id ?? 0}:${row.department_id ?? 0}:${row.top_department_id ?? 0}:${row.mid_department_id ?? 0}`
}

/**
 * Groups detail rows (user, department snapshot and another dimension such
 * as model) by userSnapshotKey, each group ordered by quota.
 */
export function groupByUserSnapshot(
  rows: readonly QuotaReportRow[]
): Map<string, QuotaReportRow[]> {
  const groups = new Map<string, QuotaReportRow[]>()
  for (const row of rows) {
    const key = userSnapshotKey(row)
    const group = groups.get(key)
    if (group) group.push(row)
    else groups.set(key, [row])
  }
  for (const group of groups.values()) {
    group.sort((a, b) => b.quota - a.quota || b.count - a.count)
  }
  return groups
}

/**
 * Where a row's usage falls when departments are compared at one level (1 to
 * 3). Usage recorded at a shallower level than requested, such as a member
 * directly in a level-1 department when comparing level 2, becomes that
 * department's "direct" group so nothing is dropped.
 */
export interface DepartmentGroup {
  key: string
  /** 0 for usage without a department. */
  departmentId: number
  direct: boolean
  /** Department ids from level 1 down to departmentId. */
  path: number[]
}

export function departmentGroupOf(
  row: QuotaReportRow,
  level: number
): DepartmentGroup {
  const levels = snapshotLevels(
    row.department_id ?? 0,
    row.top_department_id ?? 0,
    row.mid_department_id ?? 0
  )
  if (levels.length === 0) {
    return { key: '0', departmentId: 0, direct: false, path: [] }
  }
  if (levels.length >= level) {
    const path = levels.slice(0, level)
    const departmentId = path.at(-1) ?? 0
    return { key: String(departmentId), departmentId, direct: false, path }
  }
  const departmentId = levels.at(-1) ?? 0
  return {
    key: `${departmentId}:direct`,
    departmentId,
    direct: true,
    path: levels,
  }
}

/**
 * Pivots bucketed rows into department groups at a level, with each group's
 * total; drives the level charts and the monthly table.
 */
export function buildDepartmentLevelMatrix(
  rows: readonly QuotaReportRow[],
  level: number
): { matrix: UsageMatrix; groups: Map<string, DepartmentGroup> } {
  const groups = new Map<string, DepartmentGroup>()
  const matrix = buildUsageMatrix(rows, (row) => {
    const group = departmentGroupOf(row, level)
    if (!groups.has(group.key)) groups.set(group.key, group)
    return group.key
  })
  return { matrix, groups }
}
