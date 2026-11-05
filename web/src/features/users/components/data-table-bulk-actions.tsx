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
import type { Table } from '@tanstack/react-table'
import { Building2 } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DataTableBulkActions as BulkActionsToolbar } from '@/components/data-table'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { setUsersDepartment } from '@/features/departments/api'
import { DepartmentSelect } from '@/features/departments/components/department-select'
import {
  DEPARTMENTS_QUERY_KEY,
  useDepartments,
} from '@/features/departments/hooks/use-departments'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'

import type { User } from '../types'
import { useUsers } from './users-provider'

interface DataTableBulkActionsProps {
  table: Table<User>
}

export function DataTableBulkActions(props: DataTableBulkActionsProps) {
  const { t } = useTranslation()
  const id = useId()
  const queryClient = useQueryClient()
  const { triggerRefresh } = useUsers()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [departmentId, setDepartmentId] = useState(0)
  const { departments } = useDepartments()
  const selectedUsers = props.table
    .getFilteredSelectedRowModel()
    .rows.map((row) => row.original)

  const assignment = useMutation({
    mutationFn: async (targets: {
      userIds: number[]
      departmentId: number
    }) => {
      const result = await setUsersDepartment(
        targets.userIds,
        targets.departmentId
      )
      if (!result.success) throw createServerError(result)
      return result.data?.updated ?? targets.userIds.length
    },
    onSuccess: (count) => {
      toast.success(t('Updated the department of {{count}} users', { count }))
      setDialogOpen(false)
      props.table.resetRowSelection()
      queryClient.invalidateQueries({ queryKey: DEPARTMENTS_QUERY_KEY })
      triggerRefresh()
    },
    onError: (error) => {
      handleServerError(error, t('Failed to update department'))
    },
  })

  return (
    <>
      <BulkActionsToolbar table={props.table} entityName='user'>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant='outline'
                size='icon'
                className='size-8'
                aria-label={t('Set department')}
                onClick={() => {
                  setDepartmentId(0)
                  setDialogOpen(true)
                }}
              />
            }
          >
            <Building2 aria-hidden='true' />
          </TooltipTrigger>
          <TooltipContent>{t('Set department')}</TooltipContent>
        </Tooltip>
      </BulkActionsToolbar>
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!assignment.isPending) setDialogOpen(open)
        }}
        title={t('Set department')}
        description={t(
          'Move {{count}} selected users. Usage already recorded stays under their previous department.',
          { count: selectedUsers.length }
        )}
        contentClassName='sm:max-w-md'
        bodyClassName='space-y-2'
        footer={
          <>
            <Button
              variant='outline'
              onClick={() => setDialogOpen(false)}
              disabled={assignment.isPending}
            >
              {t('Cancel')}
            </Button>
            <Button
              disabled={assignment.isPending || selectedUsers.length === 0}
              onClick={() =>
                assignment.mutate({
                  userIds: selectedUsers.map((user) => user.id),
                  departmentId,
                })
              }
            >
              {assignment.isPending ? t('Saving...') : t('Save')}
            </Button>
          </>
        }
      >
        <Label htmlFor={`${id}-department`}>{t('Department')}</Label>
        <DepartmentSelect
          id={`${id}-department`}
          departments={departments}
          value={departmentId}
          onValueChange={setDepartmentId}
          emptyLabel={t('Unassigned')}
        />
      </Dialog>
    </>
  )
}
