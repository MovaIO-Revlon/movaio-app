export function now() {
  return new Date();
}

export function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function addDays(base: Date, days: number) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

export function subDays(base: Date, days: number) {
  const d = new Date(base);
  d.setDate(d.getDate() - days);
  return d;
}
export function generateRanges() {
  const current = new Date();
  const todayEnd = endOfDay(current).toISOString();
  const allTimeStart = new Date('2000-01-01');

  return {
    today: {
      start: startOfDay(current).toISOString(),
      end: todayEnd,
      year: current.getFullYear(),
      month: current.getMonth(),
    },
    yesterday: {
      start: startOfDay(subDays(current, 1)).toISOString(),
      end: endOfDay(subDays(current, 1)).toISOString(),
    },
    last7: {
      start: startOfDay(subDays(current, 6)).toISOString(),
      end: todayEnd,
    },
    last30: {
      start: startOfDay(subDays(current, 29)).toISOString(),
      end: todayEnd,
    },
    thisMonth: {
      start: startOfDay(
        new Date(current.getFullYear(), current.getMonth(), 1),
      ).toISOString(),
      end: todayEnd,
    },
    lastMonth: {
      start: startOfDay(
        new Date(current.getFullYear(), current.getMonth() - 1, 1),
      ).toISOString(),
      end: endOfDay(
        new Date(current.getFullYear(), current.getMonth(), 0),
      ).toISOString(),
    },
    last6Month: {
      start: startOfDay(
        new Date(current.getFullYear(), current.getMonth() - 5, 1),
      ).toISOString(),
      end: todayEnd,
    },
    lastYear: {
      start: startOfDay(
        new Date(
          current.getFullYear() - 1,
          current.getMonth(),
          current.getDate(),
        ),
      ).toISOString(),
      end: todayEnd,
    },
    allTime: {
      start: startOfDay(allTimeStart).toISOString(),
      end: endOfDay(current).toISOString(),
    },
  };
}

export function isSameDay(a?: Date, b?: Date): boolean {
  if (!a || !b || !(a instanceof Date) || !(b instanceof Date)) return false;

  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
