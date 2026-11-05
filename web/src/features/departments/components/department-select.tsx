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
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Combobox } from '@/components/ui/combobox'

import {
  MAX_DEPARTMENT_DEPTH,
  getDepartmentOptions,
  getSubtreeHeight,
  getSubtreeIds,
} from '../lib/tree'
import type { Department } from '../types'

interface DepartmentSelectProps {
  departments: readonly Department[]
  /** Department id; 0 means no department. */
  value: number
  onValueChange: (value: number) => void
  /** Label of the 0 option, such as "Unassigned" or "None (top level)". */
  emptyLabel: string
  /**
   * Choose a parent for this department (0 for a new one): only parents that
   * keep its subtree within the level limit, and never itself or below it.
   */
  parentFor?: number
  disabled?: boolean
  id?: string
  'aria-label'?: string
}

export function DepartmentSelect(props: DepartmentSelectProps) {
  const { t } = useTranslation()
  const options = useMemo(() => {
    let departmentOptions = getDepartmentOptions(props.departments)
    if (props.parentFor !== undefined) {
      const self = props.parentFor
      const blocked = self ? getSubtreeIds(props.departments, self) : new Set()
      const height = self ? getSubtreeHeight(props.departments, self) : 1
      departmentOptions = departmentOptions.filter(
        (option) =>
          !blocked.has(Number(option.value)) &&
          option.depth + 1 + height <= MAX_DEPARTMENT_DEPTH
      )
    }
    return [
      { value: '0', label: props.emptyLabel },
      ...departmentOptions.map((option) => ({
        value: option.value,
        label: option.label,
      })),
    ]
  }, [props.departments, props.parentFor, props.emptyLabel])

  return (
    <Combobox
      id={props.id}
      aria-label={props['aria-label']}
      options={options}
      value={String(props.value)}
      onValueChange={(value) => props.onValueChange(Number(value ?? 0) || 0)}
      placeholder={t('Select a department')}
      searchPlaceholder={t('Search departments...')}
      emptyText={t('No departments found')}
      disabled={props.disabled}
      className='w-full'
    />
  )
}
