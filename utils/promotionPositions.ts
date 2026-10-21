export const promotionPositionOptions = (currentPosition: string, titles: string[]): string[] => {
  const current = currentPosition.trim().replace(/\s+/g, " ");
  const seen = new Set<string>();

  return titles
    .map((title) => title.trim().replace(/\s+/g, " "))
    .filter((title) => {
      const key = title.toLowerCase();
      if (!title || key === current.toLowerCase() || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => left.localeCompare(right));
};
