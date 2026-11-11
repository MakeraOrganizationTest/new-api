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
import { useMutation } from '@tanstack/react-query'
import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { MultiSelect } from '@/components/multi-select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useDepartments } from '@/features/departments/hooks/use-departments'
import { getDepartmentOptions } from '@/features/departments/lib/tree'
import { getCurrencyDisplay, getCurrencyLabel } from '@/lib/currency'
import { formatQuota, parseQuotaFromDollars } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

import { batchAdjustUserQuota } from '../api'
import type {
  BatchQuotaGrantPayload,
  BatchQuotaGrantResult,
  QuotaGrantMode,
  QuotaGrantScope,
  User,
} from '../types'

/** Matches the server-side limit on the remark stored with each grant. */
export const QUOTA_GRANT_REMARK_MAX_LENGTH = 64

interface BatchQuotaDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When set, the grant targets exactly these users instead of a scope. */
  selectedUsers?: readonly User[]
  onSuccess: () => void
}

export function BatchQuotaDialog(props: BatchQuotaDialogProps) {
  const { t } = useTranslation()
  const id = useId()
  const { departments } = useDepartments()
  const [scope, setScope] = useState<Exclude<QuotaGrantScope, 'users'>>('all')
  const [departmentIds, setDepartmentIds] = useState<string[]>([])
  const [mode, setMode] = useState<QuotaGrantMode>('add')
  const [amount, setAmount] = useState('')
  const [remark, setRemark] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)

  const { meta: currencyMeta } = getCurrencyDisplay()
  const currencyLabel = getCurrencyLabel()
  const tokensOnly = currencyMeta.kind === 'tokens'
  const fixedUsers = props.selectedUsers
  const departmentOptions = useMemo(
    () =>
      getDepartmentOptions(departments).map((option) => ({
        value: option.value,
        label: option.label,
      })),
    [departments]
  )

  const amountValue = Number.parseFloat(amount)
  const quota = Number.isFinite(amountValue)
    ? parseQuotaFromDollars(amountValue)
    : Number.NaN
  const amountValid = mode === 'add' ? quota > 0 : quota >= 0
  const targetsValid =
    fixedUsers !== undefined
      ? fixedUsers.length > 0
      : scope === 'all' || departmentIds.length > 0

  const reset = () => {
    setScope('all')
    setDepartmentIds([])
    setMode('add')
    setAmount('')
    setRemark('')
    setConfirmOpen(false)
  }

  const grant = useMutation({
    mutationFn: async (payload: BatchQuotaGrantPayload) => {
      const result = await batchAdjustUserQuota(payload)
      if (!result.success || !result.data) throw createServerError(result)
      return result.data
    },
    onSuccess: (result: BatchQuotaGrantResult) => {
      const failed = result.failed.length
      const message = t(
        'Granted quota to {{succeeded}} users, {{skipped}} skipped, {{failed}} failed',
        { succeeded: result.succeeded, skipped: result.skipped, failed }
      )
      if (failed > 0) {
        toast.warning(message, {
          description: result.failed.map((user) => user.username).join(', '),
        })
      } else {
        toast.success(message)
      }
      reset()
      props.onOpenChange(false)
      props.onSuccess()
    },
    onError: (error) => {
      setConfirmOpen(false)
      handleServerError(error, t('Failed to grant quota'))
    },
  })

  const submit = () => {
    const payload: BatchQuotaGrantPayload = {
      scope: fixedUsers !== undefined ? 'users' : scope,
      mode,
      value: quota,
      remark: remark.trim(),
    }
    if (fixedUsers !== undefined) {
      payload.user_ids = fixedUsers.map((user) => user.id)
    } else if (scope === 'departments') {
      payload.department_ids = departmentIds.map(Number)
    }
    grant.mutate(payload)
  }

  let targetText = t('All enabled users')
  if (fixedUsers !== undefined) {
    targetText = t('{{count}} selected users', { count: fixedUsers.length })
  } else if (scope === 'departments') {
    targetText = t('Enabled members of {{count}} departments', {
      count: departmentIds.length,
    })
  }
  const operationText =
    mode === 'add'
      ? t('Add {{quota}} to each user', { quota: formatQuota(quota || 0) })
      : t('Set each user to {{quota}}', { quota: formatQuota(quota || 0) })

  return (
    <>
      <Dialog
        open={props.open}
        onOpenChange={(open) => {
          if (grant.isPending) return
          if (!open) reset()
          props.onOpenChange(open)
        }}
        title={t('Batch grant quota')}
        description={t(
          'Each user gets a top-up log entry, the same as a single manual adjustment.'
        )}
        contentClassName='sm:max-w-md'
        contentHeight='auto'
        bodyClassName='space-y-4'
        footer={
          <>
            <Button
              variant='outline'
              onClick={() => {
                reset()
                props.onOpenChange(false)
              }}
              disabled={grant.isPending}
            >
              {t('Cancel')}
            </Button>
            <Button
              disabled={!amountValid || !targetsValid || grant.isPending}
              onClick={() => setConfirmOpen(true)}
            >
              {t('Grant')}
            </Button>
          </>
        }
      >
        <div className='space-y-2'>
          <Label>{t('Recipients')}</Label>
          {fixedUsers !== undefined ? (
            <p className='text-muted-foreground text-sm'>{targetText}</p>
          ) : (
            <div className='flex gap-1'>
              {(['all', 'departments'] as const).map((value) => (
                <Button
                  key={value}
                  type='button'
                  variant='outline'
                  size='sm'
                  aria-pressed={scope === value}
                  className={cn(
                    scope === value &&
                      'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground'
                  )}
                  onClick={() => setScope(value)}
                >
                  {value === 'all' ? t('All users') : t('By department')}
                </Button>
              ))}
            </div>
          )}
        </div>

        {fixedUsers === undefined && scope === 'departments' && (
          <div className='space-y-2'>
            <Label htmlFor={`${id}-departments`}>{t('Departments')}</Label>
            <MultiSelect
              id={`${id}-departments`}
              options={departmentOptions}
              selected={departmentIds}
              onChange={setDepartmentIds}
              placeholder={t('Select departments')}
              emptyText={t('No departments found')}
            />
            <p className='text-muted-foreground text-xs'>
              {t('Sub-departments are included. Disabled users are skipped.')}
            </p>
          </div>
        )}

        <div className='space-y-2'>
          <Label>{t('Mode')}</Label>
          <div className='flex gap-1'>
            {(['add', 'override'] as const).map((value) => (
              <Button
                key={value}
                type='button'
                variant='outline'
                size='sm'
                aria-pressed={mode === value}
                className={cn(
                  mode === value &&
                    'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground'
                )}
                onClick={() => setMode(value)}
              >
                {value === 'add' ? t('Add to balance') : t('Set balance to')}
              </Button>
            ))}
          </div>
        </div>

        <div className='space-y-2'>
          <Label htmlFor={`${id}-amount`}>
            {t('Amount')} ({currencyLabel})
          </Label>
          <Input
            id={`${id}-amount`}
            type='number'
            step={tokensOnly ? 1 : 0.000001}
            min={0}
            placeholder={
              tokensOnly
                ? t('Enter amount in tokens')
                : t('Enter amount in {{currency}}', { currency: currencyLabel })
            }
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        <div className='space-y-2'>
          <Label htmlFor={`${id}-remark`}>{t('Remark')}</Label>
          <Input
            id={`${id}-remark`}
            maxLength={QUOTA_GRANT_REMARK_MAX_LENGTH}
            placeholder={t('For example: December allowance')}
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
          />
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!grant.isPending) setConfirmOpen(open)
        }}
        title={t('Confirm batch grant')}
        desc={`${targetText} · ${operationText}`}
        confirmText={t('Grant')}
        isLoading={grant.isPending}
        handleConfirm={submit}
      />
    </>
  )
}
