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
export interface Department {
  id: number
  parent_id: number
  name: string
  sort: number
  remark: string
  created_at: number
  updated_at: number
  /** Only set when listed with deleted departments. */
  deleted?: boolean
  /** Current members directly in this department. */
  members: number
}

export interface DepartmentInput {
  parent_id: number
  name: string
  sort: number
  remark: string
}

/** Filter value that selects users or usage with no department. */
export const DEPARTMENT_UNASSIGNED = -1
