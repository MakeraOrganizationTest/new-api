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

import type { Department } from '../../types'
import {
  buildDepartmentIndex,
  buildDepartmentTree,
  formatDepartmentPath,
  formatDepartmentSnapshot,
  getDepartmentOptions,
  getSubtreeHeight,
  getSubtreeIds,
} from '../tree'

function department(
  id: number,
  name: string,
  parentId = 0,
  sort = 0
): Department {
  return {
    id,
    parent_id: parentId,
    name,
    sort,
    remark: '',
    created_at: 0,
    updated_at: 0,
    members: 0,
  }
}

const departments = [
  department(3, 'Frontend', 1, 2),
  department(1, 'R&D', 0, 1),
  department(2, 'Sales', 0, 0),
  department(4, 'Backend', 1, 1),
  department(5, 'Web', 3),
]

describe('department tree', () => {
  it('nests three levels ordered by sort then id', () => {
    const tree = buildDepartmentTree(departments)
    expect(tree.map((node) => node.department.name)).toEqual(['Sales', 'R&D'])
    expect(tree[1].children.map((child) => child.department.name)).toEqual([
      'Backend',
      'Frontend',
    ])
    expect(tree[1].children[1].children[0]).toMatchObject({
      depth: 2,
      department: { name: 'Web' },
    })
  })

  it('keeps a department visible when its parent is missing', () => {
    const tree = buildDepartmentTree([department(6, 'Orphan', 99)])
    expect(tree.map((node) => node.department.name)).toEqual(['Orphan'])
  })

  it('labels departments with their full path', () => {
    const index = buildDepartmentIndex(departments)
    expect(formatDepartmentPath(index, 5)).toBe('R&D / Frontend / Web')
    expect(formatDepartmentPath(index, 1)).toBe('R&D')
    expect(formatDepartmentPath(index, 42)).toBeNull()
  })

  it('lists options in tree order with depth', () => {
    expect(getDepartmentOptions(departments)).toEqual([
      { value: '2', label: 'Sales', depth: 0 },
      { value: '1', label: 'R&D', depth: 0 },
      { value: '4', label: 'R&D / Backend', depth: 1 },
      { value: '3', label: 'R&D / Frontend', depth: 1 },
      { value: '5', label: 'R&D / Frontend / Web', depth: 2 },
    ])
  })

  it('finds a subtree and its height', () => {
    expect([...getSubtreeIds(departments, 1)].sort()).toEqual([1, 3, 4, 5])
    expect(getSubtreeHeight(departments, 1)).toBe(3)
    expect(getSubtreeHeight(departments, 5)).toBe(1)
  })
})

describe('formatDepartmentSnapshot', () => {
  const index = buildDepartmentIndex([
    ...departments,
    { ...department(9, 'Old team', 1), deleted: true },
  ])

  it('labels usage with the levels recorded at that time', () => {
    // Web is under R&D / Frontend now, but was recorded under Sales / Backend.
    expect(formatDepartmentSnapshot(index, 5, 2, '(Deleted)', 4)).toBe(
      'Sales / Backend / Web'
    )
    expect(formatDepartmentSnapshot(index, 3, 1, '(Deleted)', 3)).toBe(
      'R&D / Frontend'
    )
    expect(formatDepartmentSnapshot(index, 1, 1, '(Deleted)')).toBe('R&D')
  })

  it('marks deleted and unknown departments', () => {
    expect(formatDepartmentSnapshot(index, 9, 1, '(Deleted)', 9)).toBe(
      'R&D / Old team (Deleted)'
    )
    expect(formatDepartmentSnapshot(index, 77, 77, '(Deleted)')).toBe('#77')
  })

  it('returns null for usage without a department', () => {
    expect(formatDepartmentSnapshot(index, 0, 0, '(Deleted)')).toBeNull()
  })
})

describe('getDepartmentOptions with deleted departments', () => {
  it('marks deleted departments only when a suffix is given', () => {
    const list = [
      department(1, 'R&D'),
      { ...department(2, 'Old', 1), deleted: true },
    ]
    expect(getDepartmentOptions(list, '(Deleted)').map((o) => o.label)).toEqual(
      ['R&D', 'R&D / Old (Deleted)']
    )
    expect(getDepartmentOptions(list).map((o) => o.label)).toEqual([
      'R&D',
      'R&D / Old',
    ])
  })
})
