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
import { useQuery } from '@tanstack/react-query'

import { getUsers } from '@/features/users/api'
import { isUserDeleted } from '@/features/users/constants'
import { requireServerSuccess } from '@/lib/server-error-message'

import type { UserDirectoryEntry } from '../lib/report'

const PAGE_SIZE = 100
// A safety stop for the page loop; far above an internal deployment's size.
const MAX_PAGES = 200

/** Every user, for reports that list users without usage. Admin only. */
async function fetchUserDirectory(): Promise<UserDirectoryEntry[]> {
  const users: UserDirectoryEntry[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = requireServerSuccess(
      await getUsers({ p: page, page_size: PAGE_SIZE })
    )
    const items = result.data?.items ?? []
    for (const user of items) {
      users.push({
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        department_id: user.department_id,
        deleted: isUserDeleted(user),
      })
    }
    const total = result.data?.total ?? 0
    if (items.length < PAGE_SIZE || users.length >= total) break
  }
  return users
}

export function useUserDirectory(enabled: boolean) {
  return useQuery({
    queryKey: ['dashboard', 'user-directory'],
    queryFn: fetchUserDirectory,
    enabled,
    staleTime: 5 * 60_000,
  })
}
