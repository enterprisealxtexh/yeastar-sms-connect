/**
 * Format date/time in Africa/Nairobi timezone
 * This is the standard timezone for this application
 * 
 * Database timestamps are stored in UTC format (YYYY-MM-DD HH:MM:SS)
 * This function correctly parses them as UTC and displays in Africa/Nairobi timezone
 */
export const formatDateNairobi = (date?: Date | string | null): string => {
  if (!date) {
    date = new Date();
  }

  if (typeof date === 'string') {
    // If string looks like "2026-02-15 07:23:43" (UTC from database)
    // Parse it as UTC by replacing space with 'T' and appending 'Z'
    if (date.includes(' ') && !date.includes('Z') && !date.includes('+') && !date.includes('-', 10)) {
      const utcString = date.replace(' ', 'T') + 'Z';
      date = new Date(utcString);
    } else {
      date = new Date(date);
    }
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
 * Format date only (without time) in Africa/Nairobi timezone - shows as "15 Feb"
 * Correctly handles UTC timestamps from database
 */
export const formatDateOnlyNairobi = (date?: Date | string | null): string => {
  if (!date) {
    date = new Date();
  }

  if (typeof date === 'string') {
    // If string looks like "2026-02-15 07:23:43" (UTC from database)
    if (date.includes(' ') && !date.includes('Z') && !date.includes('+') && !date.includes('-', 10)) {
      const utcString = date.replace(' ', 'T') + 'Z';
      date = new Date(utcString);
    } else {
      date = new Date(date);
    }
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
 * Format time only in Africa/Nairobi timezone
 * Correctly handles UTC timestamps from database
 */
export const formatTimeOnlyNairobi = (date?: Date | string | null): string => {
  if (!date) {
    date = new Date();
  }

  if (typeof date === 'string') {
    // If string looks like "2026-02-15 07:23:43" (UTC from database)
    if (date.includes(' ') && !date.includes('Z') && !date.includes('+') && !date.includes('-', 10)) {
      const utcString = date.replace(' ', 'T') + 'Z';
      date = new Date(utcString);
    } else {
      date = new Date(date);
    }
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
