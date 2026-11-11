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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import type { User } from '../../types'
import { BatchQuotaDialog } from '../batch-quota-dialog'

vi.mock('@/features/departments/hooks/use-departments', () => ({
  DEPARTMENTS_QUERY_KEY: ['departments'],
  useDepartments: () => ({
    departments: [{ id: 1, parent_id: 0, name: 'R&D', sort: 0, members: 2 }],
  }),
}))

const i18n = createInstance()
await i18n.init({
  lng: 'en',
  resources: { en: { translation: {} } },
  initAsync: false,
})

const selectedUsers = [
  { id: 1, username: 'alice' },
  { id: 2, username: 'bob' },
] as User[]

function renderDialog(props: { selectedUsers?: User[] }) {
  const onSuccess = vi.fn()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <BatchQuotaDialog
          open
          onOpenChange={() => undefined}
          selectedUsers={props.selectedUsers}
          onSuccess={onSuccess}
        />
      </QueryClientProvider>
    </I18nextProvider>
  )
  return { onSuccess }
}

describe('BatchQuotaDialog', () => {
  beforeEach(() => {
    useSystemConfigStore.getState().setConfig({
      currency: { ...DEFAULT_CURRENCY_CONFIG },
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  test('granting to selected users posts their ids after confirmation', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      data: {
        success: true,
        data: { total: 2, succeeded: 2, skipped: 0, failed: [] },
      },
    })
    const user = userEvent.setup()
    const { onSuccess } = renderDialog({ selectedUsers })

    const grant = screen.getByRole('button', { name: 'Grant' })
    expect(grant).toBeDisabled()
    await user.type(screen.getByLabelText(/Amount/), '5')
    await user.type(screen.getByLabelText('Remark'), 'December allowance')
    await user.click(grant)

    const confirm = within(await screen.findByRole('alertdialog'))
    await user.click(confirm.getByRole('button', { name: 'Grant' }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce())
    expect(post).toHaveBeenCalledWith('/api/user/quota/batch', {
      scope: 'users',
      user_ids: [1, 2],
      mode: 'add',
      value: 5 * DEFAULT_CURRENCY_CONFIG.quotaPerUnit,
      remark: 'December allowance',
    })
  })

  test('department scope stays disabled until a department is chosen', async () => {
    const user = userEvent.setup()
    renderDialog({})

    await user.type(screen.getByLabelText(/Amount/), '5')
    expect(screen.getByRole('button', { name: 'Grant' })).toBeEnabled()

    const byDepartment = screen.getByRole('button', { name: 'By department' })
    await user.click(byDepartment)
    expect(byDepartment).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Grant' })).toBeDisabled()
  })

  test('setting balances to zero is allowed while adding zero is not', async () => {
    const user = userEvent.setup()
    renderDialog({ selectedUsers })

    await user.type(screen.getByLabelText(/Amount/), '0')
    expect(screen.getByRole('button', { name: 'Grant' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Set balance to' }))
    expect(screen.getByRole('button', { name: 'Grant' })).toBeEnabled()
  })
})
