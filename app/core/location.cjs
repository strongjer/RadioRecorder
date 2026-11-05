'use strict';
function sanitizeLocation(value) {
  if (!value?.enabled) return { enabled: false };
  const precision = ['locale', 'region', 'neighborhood', 'precise'].includes(value.precision) ? value.precision : 'locale';
  const result = { enabled: true, precision, label: String(value.label || '').slice(0, 120), source: value.source === 'device' ? 'device' : 'manual' };
  if (precision !== 'locale' && Number.isFinite(value.latitude) && Number.isFinite(value.longitude) && Math.abs(value.latitude) <= 90 && Math.abs(value.longitude) <= 180) {
    const places = { region: 1, neighborhood: 2, precise: 5 }[precision];
    result.latitude = Number(value.latitude.toFixed(places)); result.longitude = Number(value.longitude.toFixed(places));
    result.approximate = precision !== 'precise';
    if (precision === 'precise' && Number.isFinite(value.accuracy)) result.accuracyMeters = Math.round(value.accuracy);
  }
  return result;
}
module.exports = { sanitizeLocation };
