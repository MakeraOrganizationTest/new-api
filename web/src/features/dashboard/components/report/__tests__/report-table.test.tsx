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
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { ReportTable, type ReportColumn } from '../report-table'

interface Row {
  name: string
  quota: number
}

const columns: ReportColumn<Row>[] = [
  {
    id: 'name',
    header: 'Name',
    sortValue: (row) => row.name,
    cell: (row) => row.name,
    footer: 'Total',
  },
  {
    id: 'quota',
    header: 'Quota',
    numeric: true,
    sortValue: (row) => row.quota,
    cell: (row) => String(row.quota),
    footer: '60',
  },
]

const rows: Row[] = [
  { name: 'bob', quota: 10 },
  { name: 'alice', quota: 30 },
  { name: 'carol', quota: 20 },
]

function bodyNames(): string[] {
  const table = screen.getByRole('table', { name: 'Usage' })
  const [, body] = within(table).getAllByRole('rowgroup')
  return within(body)
    .getAllByRole('row')
    .map((row) => within(row).getAllByRole('cell')[0].textContent ?? '')
}

afterEach(cleanup)

describe('ReportTable', () => {
  it('sorts by the default column and shows the totals row', () => {
    render(
      <ReportTable
        label='Usage'
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.name}
        defaultSort={{ id: 'quota', desc: true }}
      />
    )
    expect(bodyNames()).toEqual(['alice', 'carol', 'bob'])
    expect(screen.getByRole('columnheader', { name: /Quota/ })).toHaveAttribute(
      'aria-sort',
      'descending'
    )
    expect(screen.getByText('Total')).toBeInTheDocument()
  })

  it('sorts descending on the first header click and toggles on the second', async () => {
    const user = userEvent.setup()
    render(
      <ReportTable
        label='Usage'
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.name}
        defaultSort={{ id: 'quota', desc: true }}
      />
    )
    await user.click(screen.getByRole('button', { name: /Name/ }))
    expect(bodyNames()).toEqual(['carol', 'bob', 'alice'])
    await user.click(screen.getByRole('button', { name: /Name/ }))
    expect(bodyNames()).toEqual(['alice', 'bob', 'carol'])
    expect(screen.getByRole('columnheader', { name: /Name/ })).toHaveAttribute(
      'aria-sort',
      'ascending'
    )
  })

  it('shows an empty state without a totals row when there are no rows', () => {
    render(
      <ReportTable
        label='Usage'
        columns={columns}
        rows={[]}
        getRowKey={(row) => row.name}
      />
    )
    expect(screen.getByText('No data available')).toBeInTheDocument()
    expect(screen.queryByText('Total')).not.toBeInTheDocument()
  })
})
