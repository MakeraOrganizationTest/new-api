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
import type { Department } from '../types'

/** The deepest level a department can sit at; matches the server. */
export const MAX_DEPARTMENT_DEPTH = 3

export type DepartmentIndex = Map<number, Department>

export interface DepartmentTreeNode {
  department: Department
  /** 0 for a top-level department. */
  depth: number
  children: DepartmentTreeNode[]
}

function compareDepartments(a: Department, b: Department): number {
  return a.sort - b.sort || a.id - b.id
}

export function buildDepartmentIndex(
  departments: readonly Department[]
): DepartmentIndex {
  return new Map(departments.map((department) => [department.id, department]))
}

/**
 * The department tree in display order. A department whose parent is missing
 * from the list is shown at the top level so it never disappears.
 */
export function buildDepartmentTree(
  departments: readonly Department[]
): DepartmentTreeNode[] {
  const index = buildDepartmentIndex(departments)
  const childrenOf = new Map<number, Department[]>()
  const roots: Department[] = []
  for (const department of departments) {
    if (department.parent_id === 0 || !index.has(department.parent_id)) {
      roots.push(department)
      continue
    }
    const siblings = childrenOf.get(department.parent_id)
    if (siblings) siblings.push(department)
    else childrenOf.set(department.parent_id, [department])
  }
  const build = (
    department: Department,
    depth: number
  ): DepartmentTreeNode => ({
    department,
    depth,
    // The depth guard keeps corrupt parent cycles from recursing forever.
    children:
      depth + 1 < MAX_DEPARTMENT_DEPTH
        ? (childrenOf.get(department.id) ?? [])
            .sort(compareDepartments)
            .map((child) => build(child, depth + 1))
        : [],
  })
  return roots.sort(compareDepartments).map((root) => build(root, 0))
}

/** Every node of the tree, parents before their children. */
function flattenDepartmentTree(
  tree: readonly DepartmentTreeNode[]
): DepartmentTreeNode[] {
  return tree.flatMap((node) => [node, ...flattenDepartmentTree(node.children)])
}

/** The department and its ancestors from the top level down. */
export function getDepartmentChain(
  index: DepartmentIndex,
  departmentId: number
): Department[] {
  const chain: Department[] = []
  let current = index.get(departmentId)
  while (current && chain.length < MAX_DEPARTMENT_DEPTH) {
    chain.unshift(current)
    current = current.parent_id ? index.get(current.parent_id) : undefined
  }
  return chain
}

/** "Level 1 / Level 2 / Level 3" for a department, or null if unknown. */
export function formatDepartmentPath(
  index: DepartmentIndex,
  departmentId: number
): string | null {
  const chain = getDepartmentChain(index, departmentId)
  if (chain.length === 0) return null
  return chain.map((department) => department.name).join(' / ')
}

/**
 * The department levels recorded with usage, from the top level down, as
 * ids. The server stores the assigned department and its level-1 and
 * level-2 ancestors at the time.
 */
export function snapshotLevels(
  departmentId: number,
  topDepartmentId: number,
  midDepartmentId: number
): number[] {
  if (departmentId === 0) return []
  const levels = [topDepartmentId || departmentId]
  if (midDepartmentId && midDepartmentId !== levels[0]) {
    levels.push(midDepartmentId)
  }
  if (!levels.includes(departmentId)) levels.push(departmentId)
  return levels
}

/**
 * Label of usage recorded under a department snapshot, using the levels it
 * had at that time. Deleted departments get deletedSuffix.
 */
export function formatDepartmentSnapshot(
  index: DepartmentIndex,
  departmentId: number,
  topDepartmentId: number,
  deletedSuffix: string,
  midDepartmentId = 0
): string | null {
  const levels = snapshotLevels(departmentId, topDepartmentId, midDepartmentId)
  if (levels.length === 0) return null
  return levels
    .map((id) => {
      const department = index.get(id)
      if (!department) return `#${id}`
      return department.deleted
        ? `${department.name} ${deletedSuffix}`
        : department.name
    })
    .join(' / ')
}

/**
 * Departments in tree order, labelled with their full path. Filters over
 * history pass deletedSuffix so deleted departments stay recognizable.
 */
export function getDepartmentOptions(
  departments: readonly Department[],
  deletedSuffix?: string
): { value: string; label: string; depth: number }[] {
  const index = buildDepartmentIndex(departments)
  return flattenDepartmentTree(buildDepartmentTree(departments)).map((node) => {
    const path =
      formatDepartmentPath(index, node.department.id) ?? node.department.name
    return {
      value: String(node.department.id),
      label:
        node.department.deleted && deletedSuffix
          ? `${path} ${deletedSuffix}`
          : path,
      depth: node.depth,
    }
  })
}

/** Ids of a department and everything below it. */
export function getSubtreeIds(
  departments: readonly Department[],
  departmentId: number
): Set<number> {
  const ids = new Set([departmentId])
  let grew = true
  while (grew) {
    grew = false
    for (const department of departments) {
      if (ids.has(department.parent_id) && !ids.has(department.id)) {
        ids.add(department.id)
        grew = true
      }
    }
  }
  return ids
}

/** Number of levels in the subtree rooted at a department. */
export function getSubtreeHeight(
  departments: readonly Department[],
  departmentId: number
): number {
  const children = departments.filter(
    (department) =>
      department.parent_id === departmentId && department.id !== departmentId
  )
  if (children.length === 0) return 1
  return (
    1 +
    Math.max(
      ...children.map((child) => getSubtreeHeight(departments, child.id))
    )
  )
}
