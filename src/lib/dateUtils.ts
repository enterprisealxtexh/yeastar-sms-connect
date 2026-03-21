/**
 * Format date/time in Africa/Nairobi timezone.
 *
 * Current canonical storage is Kenya local format: YYYY-MM-DD HH:MM:SS.
 * Legacy rows may still exist as ISO UTC strings (with Z).
 */
export const formatDateNairobi = (date?: Date | string | null): string => {
  if (!date) {
    date = new Date();
  }

  if (typeof date === 'string') {
    // Kenya-local canonical storage format: "YYYY-MM-DD HH:MM:SS".
    // Do not add timezone conversion here to avoid double +3h shifts.
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(date)) {
      const [d, t] = date.split(' ');
      const [y, m, day] = d.split('-');
      const [hh, mm, ss] = t.split(':');
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${parseInt(day, 10)} ${monthNames[parseInt(m, 10) - 1]} ${hh}:${mm}:${ss}`;
    }
    date = new Date(date);
  }

  if (!(date instanceof Date) || isNaN(date.getTime())) {
    return 'Invalid date';
  }

  return date.toLocaleString('en-US', {
    timeZone: 'Africa/Nairobi',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

/**
 * Format date only (without time) in Africa/Nairobi timezone - shows as "15 Feb".
 */
export const formatDateOnlyNairobi = (date?: Date | string | null): string => {
  if (!date) {
    date = new Date();
  }

  if (typeof date === 'string') {
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(date)) {
      const [d] = date.split(' ');
      const [, m, day] = d.split('-');
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${parseInt(day, 10)} ${monthNames[parseInt(m, 10) - 1]}`;
    }
    date = new Date(date);
  }

  if (!(date instanceof Date) || isNaN(date.getTime())) {
    return 'Invalid date';
  }

  return date.toLocaleString('en-US', {
    timeZone: 'Africa/Nairobi',
    day: 'numeric',
    month: 'short',
  });
};

/**
 * Format time only in Africa/Nairobi timezone.
 */
export const formatTimeOnlyNairobi = (date?: Date | string | null): string => {
  if (!date) {
    date = new Date();
  }

  if (typeof date === 'string') {
    // Kenya-local canonical storage format.
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(date)) {
      const [, t] = date.split(' ');
      return t || 'Invalid time';
    }
    date = new Date(date);
  }

  if (!(date instanceof Date) || isNaN(date.getTime())) {
    return 'Invalid time';
  }

  return date.toLocaleString('en-US', {
    timeZone: 'Africa/Nairobi',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
};
