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
import { type QueryClient, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { requireServerSuccess } from '@/lib/server-error-message'

import { getAllDepartments, getDepartments } from '../api'
import { buildDepartmentIndex } from '../lib/tree'

export const DEPARTMENTS_QUERY_KEY = ['departments'] as const

async function loadDepartments(includeDeleted: boolean) {
  const result = requireServerSuccess(
    includeDeleted ? await getAllDepartments() : await getDepartments()
  )
  return Array.isArray(result?.data) ? result.data : []
}

/** Active and deleted departments as an index, from the query cache. */
export async function fetchDepartmentIndex(queryClient: QueryClient) {
  const departments = await queryClient.fetchQuery({
    queryKey: [...DEPARTMENTS_QUERY_KEY, 'all'],
    queryFn: () => loadDepartments(true),
    staleTime: 60 * 1000,
  })
  return buildDepartmentIndex(departments)
}

/**
 * Departments for administrators. includeDeleted also loads deleted
 * departments so historical usage keeps its department name.
 */
export function useDepartments(options?: {
  includeDeleted?: boolean
  enabled?: boolean
}) {
  const includeDeleted = options?.includeDeleted ?? false
  const query = useQuery({
    queryKey: [...DEPARTMENTS_QUERY_KEY, includeDeleted ? 'all' : 'active'],
    queryFn: () => loadDepartments(includeDeleted),
    enabled: options?.enabled ?? true,
    staleTime: 60 * 1000,
  })
  const departments = useMemo(
    () => (Array.isArray(query.data) ? query.data : []),
    [query.data]
  )
  const index = useMemo(() => buildDepartmentIndex(departments), [departments])
  return { ...query, departments, index }
}
