export const createUuid = (): string => crypto.randomUUID();

export const buildTaskSourceKey = (
  batchId: string,
  date: string,
  cropId: string,
  bedId: string,
  type: string,
): string => [batchId, date, cropId, bedId, type].join('_').toLowerCase();
