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
import { Download } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useDepartments } from '@/features/departments/hooks/use-departments'
import { toCsvLine } from '@/features/usage-logs/lib/export'
import { getCurrencyDisplay, getCurrencyLabel } from '@/lib/currency'
import dayjs from '@/lib/dayjs'
import { handleServerError } from '@/lib/handle-server-error'
import { ROLE } from '@/lib/roles'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import { getQuotaReport } from '../../api'
import { buildReportParams } from '../../hooks/use-quota-report'
import {
  EXPORT_SHEETS,
  type ExportSheetId,
  buildExportSheets,
  getExportRequest,
} from '../../lib/report-export'
import type { WorkbookSheet } from '../../lib/xlsx'
import type { DashboardFilters, QuotaReportRow } from '../../types'

type ExportFormat = 'xlsx' | 'csv'

interface DashboardExportDialogProps {
  filters: DashboardFilters
  role: number
  maskSensitive: boolean
}

function download(filename: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * Converts quota the way the wallet balance does, as a number rounded to
 * four decimals so spreadsheets can sum it.
 */
function quotaAmountConverter(): (quota: number) => number {
  const { config, meta } = getCurrencyDisplay()
  if (meta.kind === 'tokens') return (quota) => quota
  return (quota) =>
    Math.round((quota / config.quotaPerUnit) * meta.exchangeRate * 10000) /
    10000
}

function sheetToCsv(sheet: WorkbookSheet): string {
  const lines = sheet.rows.map((cells) =>
    toCsvLine(cells.map((cell) => (cell == null ? '' : String(cell))))
  )
  return `﻿${lines.join('')}`
}

/**
 * Exports the dashboard for the applied range: one sheet per section in an
 * .xlsx workbook, or one CSV per sheet in a .zip archive.
 */
export function DashboardExportDialog(props: DashboardExportDialogProps) {
  const { t } = useTranslation()
  const id = useId()
  const username = useAuthStore((state) => state.auth.user?.username ?? '')
  const isAdmin = props.role >= ROLE.ADMIN
  const sheetOptions = useMemo(
    () => EXPORT_SHEETS.filter((sheet) => isAdmin || !sheet.adminOnly),
    [isAdmin]
  )
  const [open, setOpen] = useState(false)
  const [format, setFormat] = useState<ExportFormat>('xlsx')
  const [selected, setSelected] = useState<Set<ExportSheetId>>(
    () => new Set(EXPORT_SHEETS.map((sheet) => sheet.id))
  )
  const [exporting, setExporting] = useState(false)
  const departmentsQuery = useDepartments({
    includeDeleted: true,
    enabled: open && isAdmin,
  })
  const index = departmentsQuery.index
  // Department names must be loaded, or sheets would show department ids.
  const departmentsReady = !isAdmin || departmentsQuery.isSuccess

  // The applied range, resolved once so every sheet covers the same period.
  const baseParams = useMemo(
    () =>
      buildReportParams(props.filters, {
        dimensions: ['model_name'],
        isAdmin,
      }),
    [props.filters, isAdmin]
  )
  const start = new Date(baseParams.start_timestamp * 1000)
  const end = new Date(baseParams.end_timestamp * 1000)
  const chosen = sheetOptions.filter((sheet) => selected.has(sheet.id))

  const toggleSheet = (sheetId: ExportSheetId, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(sheetId)
      else next.delete(sheetId)
      return next
    })
  }

  const handleExport = async () => {
    if (chosen.length === 0) return
    setExporting(true)
    try {
      // Sheets that share a request reuse one response.
      const requests = new Map<string, Promise<QuotaReportRow[]>>()
      const data: Partial<Record<ExportSheetId, QuotaReportRow[]>> = {}
      await Promise.all(
        chosen.map(async (sheet) => {
          const request = getExportRequest(sheet.id, props.role)
          const params = { ...baseParams, ...request }
          const key = JSON.stringify(params)
          let pending = requests.get(key)
          if (!pending) {
            pending = getQuotaReport(params, isAdmin).then(
              (response) => requireServerSuccess(response).data ?? []
            )
            requests.set(key, pending)
          }
          data[sheet.id] = await pending
        })
      )
      const sheets = buildExportSheets(data, {
        t,
        role: props.role,
        departments: index,
        start,
        end,
        tzOffset: baseParams.tz_offset ?? 0,
        exportedBy: username,
        exportedAt: new Date(),
        amountOf: quotaAmountConverter(),
        amountUnit: getCurrencyLabel(),
      })
      const name = `dashboard-${dayjs(start).format('YYYYMMDD')}-${dayjs(end).format('YYYYMMDD')}`
      if (format === 'xlsx') {
        const { buildXlsx } = await import('../../lib/xlsx')
        download(
          `${name}.xlsx`,
          buildXlsx(sheets) as Uint8Array<ArrayBuffer>,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
      } else {
        const [{ zipSync, strToU8 }, { normalizeSheetNames }] =
          await Promise.all([import('fflate'), import('../../lib/xlsx')])
        const names = normalizeSheetNames(sheets.map((sheet) => sheet.name))
        const files: Record<string, Uint8Array> = {}
        sheets.forEach((sheet, sheetIndex) => {
          files[
            `${String(sheetIndex + 1).padStart(2, '0')}-${names[sheetIndex]}.csv`
          ] = new Uint8Array(strToU8(sheetToCsv(sheet)))
        })
        download(
          `${name}.zip`,
          zipSync(files) as Uint8Array<ArrayBuffer>,
          'application/zip'
        )
      }
      toast.success(t('Dashboard exported'))
      setOpen(false)
    } catch (error) {
      handleServerError(error, t('Failed to export the dashboard'))
    } finally {
      setExporting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!exporting) setOpen(next)
      }}
      trigger={
        <Button variant='outline' size='sm'>
          <Download className='mr-2 h-4 w-4' aria-hidden='true' />
          {t('Export')}
        </Button>
      }
      title={t('Export dashboard')}
      description={t(
        'Exports {{start}} to {{end}}, the range applied in the filter. Amounts match the wallet balance; raw quota is kept for reconciliation.',
        {
          start: dayjs(start).format('YYYY-MM-DD HH:mm'),
          end: dayjs(end).format('YYYY-MM-DD HH:mm'),
        }
      )}
      contentClassName='sm:max-w-md'
      bodyClassName='space-y-5'
      footer={
        <Button
          onClick={handleExport}
          disabled={exporting || chosen.length === 0 || !departmentsReady}
        >
          {exporting ? t('Exporting...') : t('Export')}
        </Button>
      }
    >
      <div className='space-y-2'>
        <Label>{t('Format')}</Label>
        <RadioGroup
          value={format}
          onValueChange={(value) => {
            if (value === 'xlsx' || value === 'csv') setFormat(value)
          }}
          aria-label={t('Format')}
          className='flex flex-wrap gap-x-5 gap-y-3'
        >
          <div className='flex items-center gap-2'>
            <RadioGroupItem value='xlsx' id={`${id}-xlsx`} />
            <Label htmlFor={`${id}-xlsx`}>
              {t('Excel (.xlsx), one sheet per tab')}
            </Label>
          </div>
          <div className='flex items-center gap-2'>
            <RadioGroupItem value='csv' id={`${id}-csv`} />
            <Label htmlFor={`${id}-csv`}>
              {t('CSV (.zip), one file per tab')}
            </Label>
          </div>
        </RadioGroup>
      </div>
      {isAdmin && departmentsQuery.isError && (
        <p className='text-destructive text-sm' role='alert'>
          {t('Failed to load departments')}
        </p>
      )}
      <fieldset className='space-y-2'>
        <legend className='text-sm font-medium'>{t('Sheets')}</legend>
        {sheetOptions.map((sheet) => (
          <div key={sheet.id} className='flex items-center gap-2'>
            <Checkbox
              id={`${id}-${sheet.id}`}
              checked={selected.has(sheet.id)}
              onCheckedChange={(checked) =>
                toggleSheet(sheet.id, checked === true)
              }
            />
            <Label htmlFor={`${id}-${sheet.id}`}>{t(sheet.labelKey)}</Label>
          </div>
        ))}
      </fieldset>
    </Dialog>
  )
}
