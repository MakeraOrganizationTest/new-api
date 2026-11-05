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
import { Filter, RotateCcw, Calendar, Search } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DateTimePicker } from '@/components/datetime-picker'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TIME_GRANULARITY_OPTIONS } from '@/features/dashboard/constants'
import {
  buildDefaultDashboardFilters,
  cleanFilters,
} from '@/features/dashboard/lib'
import {
  REPORT_MAX_RANGE_DAYS,
  REPORT_RANGE_PRESETS,
  type ReportRangePresetId,
  detectReportRangePreset,
  fitGranularity,
  getAllowedGranularities,
  getDefaultGranularity,
  resolveReportRangePreset,
  validateReportRange,
} from '@/features/dashboard/lib/report-range'
import type {
  DashboardChartPreferences,
  DashboardFilters,
} from '@/features/dashboard/types'
import { getRollingDateRange, type TimeGranularity } from '@/lib/time'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

interface ModelsFilterProps {
  preferences: DashboardChartPreferences
  // The filters currently applied to the dashboard. The dialog edits a copy of
  // these so reopening it never discards a manually picked range.
  currentFilters: DashboardFilters
  onFilterChange: (filters: DashboardFilters) => void
  onReset: () => void
  titleKey?: string
  descriptionKey?: string
}

function rangeOf(filters: DashboardFilters | undefined) {
  return { start: filters?.start_timestamp, end: filters?.end_timestamp }
}

/**
 * Section divider component for better visual organization
 */
const SectionDivider = ({ label }: { label: string }) => (
  <div className='relative'>
    <div className='absolute inset-0 flex items-center'>
      <span className='w-full border-t' />
    </div>
    <div className='relative flex justify-center text-xs uppercase'>
      <span className='bg-background text-muted-foreground px-2'>{label}</span>
    </div>
  </div>
)

export function ModelsFilter(props: ModelsFilterProps) {
  const { t } = useTranslation()
  // 使用已缓存的用户数据，避免重复调用 API
  const user = useAuthStore((state) => state.auth.user)
  const isAdmin = user?.role && user.role >= 10

  const [open, setOpen] = useState(false)
  const [filters, setFilters] = useState<DashboardFilters>(
    () =>
      props.currentFilters ?? buildDefaultDashboardFilters(props.preferences)
  )
  const [selectedRange, setSelectedRange] =
    useState<ReportRangePresetId | null>(() =>
      detectReportRangePreset(rangeOf(props.currentFilters))
    )
  const [rangeError, setRangeError] = useState<string | null>(null)
  const allowedGranularities =
    filters.start_timestamp && filters.end_timestamp
      ? getAllowedGranularities({
          start: filters.start_timestamp,
          end: filters.end_timestamp,
        })
      : TIME_GRANULARITY_OPTIONS.map((option) => option.value)
  const granularityOptions = TIME_GRANULARITY_OPTIONS.filter((option) =>
    allowedGranularities.includes(option.value)
  )

  const handleOpenChange = (nextOpen: boolean) => {
    // Sync the editing state from the applied filters every time the dialog
    // opens so a previously applied manual range is preserved.
    if (nextOpen) {
      const applied =
        props.currentFilters ?? buildDefaultDashboardFilters(props.preferences)
      setFilters(applied)
      setSelectedRange(detectReportRangePreset(rangeOf(applied)))
      setRangeError(null)
    }
    setOpen(nextOpen)
  }

  const handleApply = () => {
    const error = validateReportRange(rangeOf(filters))
    if (error) {
      setRangeError(t(error, { days: REPORT_MAX_RANGE_DAYS }))
      return
    }
    const range = {
      start: filters.start_timestamp as Date,
      end: filters.end_timestamp as Date,
    }
    props.onFilterChange(
      cleanFilters({
        ...filters,
        time_granularity: fitGranularity(range, filters.time_granularity),
      } as unknown as Record<string, unknown>) as typeof filters
    )
    setOpen(false)
  }

  const handleReset = () => {
    const days = props.preferences.defaultTimeRangeDays
    const { start, end } = getRollingDateRange(days)
    setFilters({
      ...buildDefaultDashboardFilters(props.preferences),
      start_timestamp: start,
      end_timestamp: end,
    })
    setSelectedRange(null)
    setRangeError(null)
    props.onReset()
    setOpen(false)
  }

  const handleChange = (
    field: keyof DashboardFilters,
    value: Date | string | undefined
  ) => {
    setFilters((prev) => ({ ...prev, [field]: value }))
    if (field === 'start_timestamp' || field === 'end_timestamp') {
      setSelectedRange(null)
      setRangeError(null)
    }
  }

  const handleQuickRange = (id: ReportRangePresetId) => {
    const range = resolveReportRangePreset(id)
    setFilters((prev) => ({
      ...prev,
      start_timestamp: range.start,
      end_timestamp: range.end,
      time_granularity: getDefaultGranularity(range),
    }))
    setSelectedRange(id)
    setRangeError(null)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      trigger={
        <Button variant='outline' size='sm'>
          <Filter className='mr-2 h-4 w-4' />
          {t('Filter')}
        </Button>
      }
      title={t(props.titleKey ?? 'Model Analytics Filters')}
      description={t(
        props.descriptionKey ??
          'Filter the model analytics view by time range and user.'
      )}
      contentClassName='max-sm:h-dvh max-sm:w-screen max-sm:max-w-none max-sm:rounded-none max-sm:p-4 sm:max-w-lg'
      contentHeight='min(48vh, 460px)'
      footerClassName='grid grid-cols-2 gap-2 sm:flex'
      footer={
        <>
          <Button onClick={handleReset} variant='outline' type='button'>
            <RotateCcw className='mr-2 h-4 w-4' />
            {t('Reset')}
          </Button>
          <Button onClick={handleApply} type='submit'>
            <Search className='mr-2 h-4 w-4' />
            {t('Apply Filters')}
          </Button>
        </>
      }
    >
      <ScrollArea className='h-full pr-3 sm:pr-4'>
        <div className='grid gap-2.5 py-2'>
          {/* Quick time range selection */}
          <div className='grid gap-2'>
            <Label className='flex items-center gap-2'>
              <Calendar className='h-4 w-4' />
              {t('Quick Range')}
            </Label>
            <div className='grid grid-cols-3 gap-2'>
              {REPORT_RANGE_PRESETS.map((preset) => (
                <Button
                  key={preset.id}
                  type='button'
                  size='sm'
                  variant={selectedRange === preset.id ? 'default' : 'outline'}
                  aria-pressed={selectedRange === preset.id}
                  onClick={() => handleQuickRange(preset.id)}
                  className={cn(
                    selectedRange === preset.id &&
                      'ring-ring ring-2 ring-offset-2'
                  )}
                >
                  {t(preset.labelKey)}
                </Button>
              ))}
            </div>
          </div>

          <SectionDivider label={t('Custom Time Range')} />

          {/* Custom time range */}
          <div className='grid gap-2.5'>
            <div className='grid gap-2'>
              <Label htmlFor='start_timestamp'>{t('Start Time')}</Label>
              <DateTimePicker
                value={filters.start_timestamp}
                onChange={(date) =>
                  handleChange('start_timestamp', date || undefined)
                }
                placeholder={t('Select start time')}
              />
            </div>

            <div className='grid gap-2'>
              <Label htmlFor='end_timestamp'>{t('End Time')}</Label>
              <DateTimePicker
                value={filters.end_timestamp}
                onChange={(date) =>
                  handleChange('end_timestamp', date || undefined)
                }
                placeholder={t('Select end time')}
              />
            </div>
            {rangeError && (
              <p className='text-destructive text-xs' role='alert'>
                {rangeError}
              </p>
            )}
          </div>

          <SectionDivider label={t('Chart Settings')} />

          <div className='grid gap-2'>
            <Label htmlFor='time_granularity'>{t('Time Granularity')}</Label>
            <Select
              items={granularityOptions.map((option) => ({
                value: option.value,
                label: t(option.label),
              }))}
              value={filters.time_granularity}
              onValueChange={(value) =>
                handleChange('time_granularity', value as TimeGranularity)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder={t('Select time granularity')} />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {granularityOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {t(option.label)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {/* Admin-only fields */}
          {isAdmin && (
            <>
              <SectionDivider label={t('Admin Only')} />

              <div className='grid gap-2'>
                <Label htmlFor='username'>{t('Username')}</Label>
                <Input
                  id='username'
                  placeholder={t('Filter by username')}
                  value={filters.username}
                  onChange={(e) => handleChange('username', e.target.value)}
                />
              </div>
            </>
          )}
        </div>
      </ScrollArea>
    </Dialog>
  )
}
