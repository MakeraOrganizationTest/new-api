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
import { api } from '@/lib/api'

import type { Department, DepartmentInput } from './types'

interface ApiResponse<T> {
  success: boolean
  message?: string
  data?: T
}

/** Active departments with their current member counts. */
export async function getDepartments(): Promise<ApiResponse<Department[]>> {
  const res = await api.get('/api/department/')
  return res.data
}

/**
 * Active and deleted departments. Reports and logs use it to name usage
 * recorded under a department that was deleted later.
 */
export async function getAllDepartments(): Promise<ApiResponse<Department[]>> {
  const res = await api.get('/api/department/', {
    params: { include_deleted: true },
  })
  return res.data
}

export async function createDepartment(
  data: DepartmentInput
): Promise<ApiResponse<Department>> {
  const res = await api.post('/api/department/', data)
  return res.data
}

export async function updateDepartment(
  data: DepartmentInput & { id: number }
): Promise<ApiResponse<Department>> {
  const res = await api.put('/api/department/', data)
  return res.data
}

export async function deleteDepartment(
  id: number
): Promise<ApiResponse<{ moved_members: number }>> {
  const res = await api.delete(`/api/department/${id}`)
  return res.data
}

/** Assigns users to a department; departmentId 0 unassigns them. */
export async function setUsersDepartment(
  userIds: number[],
  departmentId: number
): Promise<ApiResponse<{ updated: number }>> {
  const res = await api.put('/api/user/department', {
    user_ids: userIds,
    department_id: departmentId,
  })
  return res.data
}
