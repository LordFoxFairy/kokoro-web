import type { AuditOutcome, EntityStatus, SessionStatus } from './view-models'

export type DateDisplayOptions = {
  readonly locale: string
  readonly timeZone: string
}

export type RelativeTimeOptions = {
  readonly locale: string
  readonly now: string
}

export type NumberDisplayOptions = {
  readonly locale: string
}

const ISO_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/

const entityStatusLabels = {
  active: 'Active',
  suspended: 'Suspended',
  deleted: 'Deleted',
  unknown: 'Unknown',
} as const satisfies Record<EntityStatus, string>

const sessionStatusLabels = {
  active: 'Active',
  expired: 'Expired',
  revoked: 'Revoked',
  unknown: 'Unknown',
} as const satisfies Record<SessionStatus, string>

const auditOutcomeLabels = {
  success: 'Success',
  denied: 'Denied',
  failure: 'Failure',
  unknown: 'Unknown',
} as const satisfies Record<AuditOutcome, string>

function parseInstant(instant: string): Date {
  const match = ISO_INSTANT.exec(instant)
  const date = new Date(instant)

  if (!match || Number.isNaN(date.getTime())) {
    throw new RangeError(`Invalid ISO instant: ${instant}`)
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1]

  if (daysInMonth === undefined || day < 1 || day > daysInMonth) {
    throw new RangeError(`Invalid ISO instant: ${instant}`)
  }

  return date
}

export function formatInstantDate(
  instant: string,
  options: DateDisplayOptions
): string {
  return new Intl.DateTimeFormat(options.locale, {
    dateStyle: 'medium',
    timeZone: options.timeZone,
  }).format(parseInstant(instant))
}

export function formatInstantDateTime(
  instant: string,
  options: DateDisplayOptions
): string {
  return new Intl.DateTimeFormat(options.locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: options.timeZone,
  }).format(parseInstant(instant))
}

export function formatRelativeInstant(
  instant: string,
  options: RelativeTimeOptions
): string {
  const differenceSeconds =
    (parseInstant(instant).getTime() - parseInstant(options.now).getTime()) /
    1_000
  const absoluteSeconds = Math.abs(differenceSeconds)

  const [unit, unitSeconds]: [Intl.RelativeTimeFormatUnit, number] =
    absoluteSeconds < 60
      ? ['second', 1]
      : absoluteSeconds < 3_600
        ? ['minute', 60]
        : absoluteSeconds < 86_400
          ? ['hour', 3_600]
          : ['day', 86_400]

  return new Intl.RelativeTimeFormat(options.locale, {
    numeric: 'auto',
    style: 'long',
  }).format(Math.round(differenceSeconds / unitSeconds), unit)
}

export function formatCount(
  count: number,
  options: NumberDisplayOptions
): string {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError('Count must be a non-negative integer')
  }

  return new Intl.NumberFormat(options.locale, {
    maximumFractionDigits: 0,
    useGrouping: true,
  }).format(count)
}

export function formatStableId(id: string): string {
  const normalized = id.trim()

  if (!normalized) throw new TypeError('ID must not be empty')
  if (normalized.length <= 16) return normalized

  return `${normalized.slice(0, 8)}…${normalized.slice(-4)}`
}

function labelFrom<T extends string>(
  labels: Readonly<Record<T, string>>,
  value: T,
  kind: string
): string {
  if (!Object.prototype.hasOwnProperty.call(labels, value)) {
    throw new RangeError(`Unsupported ${kind}: ${value}`)
  }

  return labels[value]
}

export function formatEntityStatus(status: EntityStatus): string {
  return labelFrom(entityStatusLabels, status, 'entity status')
}

export function formatSessionStatus(status: SessionStatus): string {
  return labelFrom(sessionStatusLabels, status, 'session status')
}

export function formatAuditOutcome(outcome: AuditOutcome): string {
  return labelFrom(auditOutcomeLabels, outcome, 'audit outcome')
}
