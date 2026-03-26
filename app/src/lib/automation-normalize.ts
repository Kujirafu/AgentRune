import type { AutomationConfig, AutomationSchedule } from "../data/automation-types"

const DEFAULT_DAILY_TIME = "09:00"
const DEFAULT_WEEKDAYS = [1, 2, 3, 4, 5]
const TIME_OF_DAY_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/

function cloneDefaultWeekdays(): number[] {
  return [...DEFAULT_WEEKDAYS]
}

function normalizeWeekdays(input: unknown): number[] | undefined {
  if (!Array.isArray(input)) return undefined
  const unique = Array.from(new Set(
    input.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6)
  ))
  return unique.length > 0 ? unique.sort((a, b) => a - b) : undefined
}

export function normalizeAutomationSchedule(input: unknown): AutomationSchedule {
  if (input && typeof input === "object") {
    const schedule = input as Partial<AutomationSchedule>

    if (schedule.type === "interval") {
      const intervalMinutes = Number.isFinite(schedule.intervalMinutes)
        && typeof schedule.intervalMinutes === "number"
        && schedule.intervalMinutes > 0
        ? Math.round(schedule.intervalMinutes)
        : 30
      return {
        type: "interval",
        intervalMinutes,
      }
    }

    const timeOfDay = typeof schedule.timeOfDay === "string" && TIME_OF_DAY_PATTERN.test(schedule.timeOfDay)
      ? schedule.timeOfDay
      : DEFAULT_DAILY_TIME
    const weekdays = normalizeWeekdays(schedule.weekdays) ?? cloneDefaultWeekdays()
    return {
      type: "daily",
      timeOfDay,
      weekdays,
    }
  }

  return {
    type: "daily",
    timeOfDay: DEFAULT_DAILY_TIME,
    weekdays: cloneDefaultWeekdays(),
  }
}

export function normalizeAutomationConfig<T extends object & { schedule?: unknown }>(input: T): T & { schedule: AutomationSchedule } {
  return {
    ...input,
    schedule: normalizeAutomationSchedule(input.schedule),
  }
}

export function normalizeAutomationList<T extends object & { schedule?: unknown }>(input: unknown): Array<T & { schedule: AutomationSchedule }> {
  if (!Array.isArray(input)) return []
  return input
    .filter((item): item is T => !!item && typeof item === "object")
    .map(item => normalizeAutomationConfig(item))
}

export function normalizeAutomationConfigs(input: unknown): AutomationConfig[] {
  return normalizeAutomationList<AutomationConfig>(input)
}
