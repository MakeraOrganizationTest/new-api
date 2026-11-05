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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'

import { createDepartment, updateDepartment } from '../api'
import { DEPARTMENTS_QUERY_KEY } from '../hooks/use-departments'
import { MAX_DEPARTMENT_DEPTH } from '../lib/tree'
import type { Department, DepartmentInput } from '../types'
import { DepartmentSelect } from './department-select'

interface DepartmentFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  departments: readonly Department[]
  /** The department to edit; undefined creates one. */
  department?: Department
  /** Parent preselected when creating a sub-department. */
  defaultParentId?: number
}

const EMPTY_INPUT: DepartmentInput = {
  parent_id: 0,
  name: '',
  sort: 0,
  remark: '',
}

export function DepartmentFormDialog(props: DepartmentFormDialogProps) {
  const { t } = useTranslation()
  const id = useId()
  const queryClient = useQueryClient()
  const [input, setInput] = useState<DepartmentInput>(EMPTY_INPUT)
  const [nameError, setNameError] = useState('')
  const isEdit = props.department !== undefined

  useEffect(() => {
    if (!props.open) return
    setNameError('')
    setInput(
      props.department
        ? {
            parent_id: props.department.parent_id,
            name: props.department.name,
            sort: props.department.sort,
            remark: props.department.remark,
          }
        : { ...EMPTY_INPUT, parent_id: props.defaultParentId ?? 0 }
    )
  }, [props.open, props.department, props.defaultParentId])

  const save = useMutation({
    mutationFn: async (data: DepartmentInput) => {
      const result = props.department
        ? await updateDepartment({ ...data, id: props.department.id })
        : await createDepartment(data)
      if (!result.success) throw createServerError(result)
      return result.data
    },
    onSuccess: () => {
      toast.success(isEdit ? t('Department updated') : t('Department created'))
      queryClient.invalidateQueries({ queryKey: DEPARTMENTS_QUERY_KEY })
      props.onOpenChange(false)
    },
    onError: (error) => {
      handleServerError(error, t('Failed to save department'))
    },
  })

  const handleSubmit = () => {
    const name = input.name.trim()
    if (!name) {
      setNameError(t('Department name is required'))
      return
    }
    save.mutate({ ...input, name, remark: input.remark.trim() })
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!save.isPending) props.onOpenChange(open)
      }}
      title={isEdit ? t('Edit department') : t('Create department')}
      contentClassName='sm:max-w-md'
      bodyClassName='space-y-4'
      footer={
        <>
          <Button
            variant='outline'
            onClick={() => props.onOpenChange(false)}
            disabled={save.isPending}
          >
            {t('Cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={save.isPending}>
            {save.isPending ? t('Saving...') : t('Save')}
          </Button>
        </>
      }
    >
      <form
        className='space-y-4'
        onSubmit={(event) => {
          event.preventDefault()
          handleSubmit()
        }}
      >
        <div className='space-y-2'>
          <Label htmlFor={`${id}-name`}>{t('Department name')}</Label>
          <Input
            id={`${id}-name`}
            value={input.name}
            maxLength={64}
            aria-invalid={nameError ? true : undefined}
            onChange={(event) => {
              setNameError('')
              setInput({ ...input, name: event.target.value })
            }}
          />
          {nameError && (
            <p className='text-destructive text-xs' role='alert'>
              {nameError}
            </p>
          )}
        </div>
        <div className='space-y-2'>
          <Label htmlFor={`${id}-parent`}>{t('Parent department')}</Label>
          <DepartmentSelect
            id={`${id}-parent`}
            departments={props.departments}
            value={input.parent_id}
            onValueChange={(parentId) =>
              setInput({ ...input, parent_id: parentId })
            }
            emptyLabel={t('None (top-level department)')}
            parentFor={props.department?.id ?? 0}
          />
          <p className='text-muted-foreground text-xs'>
            {t('Departments can have at most {{levels}} levels', {
              levels: MAX_DEPARTMENT_DEPTH,
            })}
          </p>
        </div>
        <div className='space-y-2'>
          <Label htmlFor={`${id}-sort`}>{t('Sort order')}</Label>
          <Input
            id={`${id}-sort`}
            type='number'
            value={input.sort}
            onChange={(event) =>
              setInput({
                ...input,
                sort: Number.parseInt(event.target.value, 10) || 0,
              })
            }
          />
        </div>
        <div className='space-y-2'>
          <Label htmlFor={`${id}-remark`}>{t('Remark')}</Label>
          <Textarea
            id={`${id}-remark`}
            value={input.remark}
            maxLength={255}
            onChange={(event) =>
              setInput({ ...input, remark: event.target.value })
            }
          />
        </div>
      </form>
    </Dialog>
  )
}
