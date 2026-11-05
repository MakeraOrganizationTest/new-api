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
import { ChartColumn, Table2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

import type { ReportView } from '../../hooks/use-report-view'

interface ReportViewToggleProps {
  value: ReportView
  onValueChange: (view: ReportView) => void
}

export function ReportViewToggle(props: ReportViewToggleProps) {
  const { t } = useTranslation()
  return (
    <ToggleGroup
      value={[props.value]}
      onValueChange={(values) => {
        const next = values.find((value) => value !== props.value)
        if (next === 'chart' || next === 'table') props.onValueChange(next)
      }}
      aria-label={t('Display mode')}
      variant='outline'
      size='sm'
    >
      <ToggleGroupItem value='chart' aria-label={t('Chart view')}>
        <ChartColumn aria-hidden='true' />
        <span className='max-sm:sr-only'>{t('Chart')}</span>
      </ToggleGroupItem>
      <ToggleGroupItem value='table' aria-label={t('Table view')}>
        <Table2 aria-hidden='true' />
        <span className='max-sm:sr-only'>{t('Table')}</span>
      </ToggleGroupItem>
    </ToggleGroup>
  )
}
