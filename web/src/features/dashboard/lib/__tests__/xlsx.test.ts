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
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { buildXlsx, columnName, normalizeSheetNames } from '../xlsx'

describe('xlsx writer', () => {
  it('names columns past Z', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual([
      'A',
      'Z',
      'AA',
      'AB',
      'ZZ',
      'AAA',
    ])
  })

  it('makes sheet names valid and unique', () => {
    expect(
      normalizeSheetNames(['Users', 'users', 'a/b:c', '', 'x'.repeat(40)])
    ).toEqual(['Users', 'users (2)', 'a b c', 'Sheet4', 'x'.repeat(31)])
  })

  it('writes one worksheet per sheet with numbers and escaped text', () => {
    const files = unzipSync(
      buildXlsx([
        {
          name: 'Usage',
          header: true,
          rows: [
            ['User', 'Quota'],
            ['=HYPERLINK("x") & <b>', 1500],
          ],
        },
        { name: 'Notes', rows: [['ok']] },
      ])
    )
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        '[Content_Types].xml',
        'xl/workbook.xml',
        'xl/worksheets/sheet1.xml',
        'xl/worksheets/sheet2.xml',
      ])
    )
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml'])
    expect(sheet).toContain('<c r="B2"><v>1500</v></c>')
    // Text that looks like a formula is stored as an inline string.
    expect(sheet).toContain(
      't="inlineStr"><is><t xml:space="preserve">=HYPERLINK(&quot;x&quot;) &amp; &lt;b&gt;</t>'
    )
    expect(sheet).toContain('state="frozen"')
    expect(strFromU8(files['xl/workbook.xml'])).toContain('name="Notes"')
  })
})
