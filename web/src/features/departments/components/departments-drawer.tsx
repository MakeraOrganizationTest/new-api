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
import { Building2, FolderPlus, Pencil, Plus, Trash2 } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  sideDrawerContentClassName,
  sideDrawerFormClassName,
  sideDrawerHeaderClassName,
} from '@/components/drawer-layout'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

import { deleteDepartment } from '../api'
import { DEPARTMENTS_QUERY_KEY, useDepartments } from '../hooks/use-departments'
import {
  type DepartmentTreeNode,
  MAX_DEPARTMENT_DEPTH,
  buildDepartmentTree,
} from '../lib/tree'
import type { Department } from '../types'
import { DepartmentFormDialog } from './department-form-dialog'

interface DepartmentsDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after members change department, so user lists can refresh. */
  onMembersChanged?: () => void
}

type FormState = { department?: Department; defaultParentId?: number }

export function DepartmentsDrawer(props: DepartmentsDrawerProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { departments, isLoading, isError, refetch } = useDepartments({
    enabled: props.open,
  })
  const tree = useMemo(() => buildDepartmentTree(departments), [departments])
  const [form, setForm] = useState<FormState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Department | null>(null)

  const deletion = useMutation({
    mutationFn: async (department: Department) => {
      const result = await deleteDepartment(department.id)
      if (!result.success) throw createServerError(result)
      return result.data?.moved_members ?? 0
    },
    onSuccess: (moved) => {
      toast.success(t('Department deleted'))
      setDeleteTarget(null)
      queryClient.invalidateQueries({ queryKey: DEPARTMENTS_QUERY_KEY })
      if (moved > 0) props.onMembersChanged?.()
    },
    onError: (error) => {
      handleServerError(error, t('Failed to delete department'))
    },
  })

  const renderNode = (node: DepartmentTreeNode): ReactNode => (
    <li key={node.department.id}>
      {renderRow(node.department, node.depth)}
      {node.children.length > 0 && (
        <ul className='space-y-1'>{node.children.map(renderNode)}</ul>
      )}
    </li>
  )

  const renderRow = (department: Department, depth: number) => (
    <div
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2 hover:bg-muted/50',
        depth === 1 && 'ms-6',
        depth === 2 && 'ms-12'
      )}
    >
      <div className='min-w-0 flex-1'>
        <p className='truncate text-sm font-medium'>{department.name}</p>
        <p className='text-muted-foreground truncate text-xs'>
          {t('{{count}} members', { count: department.members })}
          {department.remark ? ` · ${department.remark}` : ''}
        </p>
      </div>
      {depth + 1 < MAX_DEPARTMENT_DEPTH && (
        <Button
          variant='ghost'
          size='icon'
          className='size-8'
          aria-label={t('Add sub-department to {{name}}', {
            name: department.name,
          })}
          title={t('Add sub-department')}
          onClick={() => setForm({ defaultParentId: department.id })}
        >
          <FolderPlus aria-hidden='true' />
        </Button>
      )}
      <Button
        variant='ghost'
        size='icon'
        className='size-8'
        aria-label={t('Edit {{name}}', { name: department.name })}
        title={t('Edit')}
        onClick={() => setForm({ department })}
      >
        <Pencil aria-hidden='true' />
      </Button>
      <Button
        variant='ghost'
        size='icon'
        className='text-destructive size-8'
        aria-label={t('Delete {{name}}', { name: department.name })}
        title={t('Delete')}
        onClick={() => setDeleteTarget(department)}
      >
        <Trash2 aria-hidden='true' />
      </Button>
    </div>
  )

  const deleteTargetHasChildren =
    deleteTarget !== null &&
    departments.some((department) => department.parent_id === deleteTarget.id)

  let body: ReactNode
  if (isLoading) {
    body = <LoadingState />
  } else if (isError) {
    body = (
      <ErrorState
        title={t('Failed to load departments')}
        onRetry={() => refetch()}
      />
    )
  } else if (tree.length === 0) {
    body = (
      <EmptyState
        icon={Building2}
        title={t('No departments yet')}
        description={t(
          'Create departments to group users and see their usage in the dashboard.'
        )}
      />
    )
  } else {
    body = <ul className='space-y-1'>{tree.map(renderNode)}</ul>
  }

  return (
    <>
      <Sheet open={props.open} onOpenChange={props.onOpenChange}>
        <SheetContent
          className={sideDrawerContentClassName('sm:max-w-[520px]')}
        >
          <SheetHeader className={sideDrawerHeaderClassName()}>
            <SheetTitle>{t('Departments')}</SheetTitle>
            <SheetDescription>
              {t(
                'Departments group users for usage reports. They do not affect pricing or channel routing.'
              )}
            </SheetDescription>
          </SheetHeader>
          <div className={sideDrawerFormClassName('gap-4')}>
            <div>
              <Button size='sm' onClick={() => setForm({})}>
                <Plus className='h-4 w-4' aria-hidden='true' />
                {t('Create department')}
              </Button>
            </div>
            {body}
          </div>
        </SheetContent>
      </Sheet>

      <DepartmentFormDialog
        open={form !== null}
        onOpenChange={(open) => !open && setForm(null)}
        departments={departments}
        department={form?.department}
        defaultParentId={form?.defaultParentId}
      />

      <ConfirmDialog
        destructive
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deletion.isPending) setDeleteTarget(null)
        }}
        title={t('Delete department {{name}}?', {
          name: deleteTarget?.name ?? '',
        })}
        desc={
          deleteTargetHasChildren
            ? t('Delete or move its sub-departments first')
            : t(
                '{{count}} members will become unassigned. Usage already recorded stays under this department.',
                { count: deleteTarget?.members ?? 0 }
              )
        }
        confirmText={deletion.isPending ? t('Deleting...') : t('Delete')}
        isLoading={deletion.isPending}
        disabled={deleteTargetHasChildren}
        handleConfirm={() => {
          if (deleteTarget && !deletion.isPending) deletion.mutate(deleteTarget)
        }}
      />
    </>
  )
}
