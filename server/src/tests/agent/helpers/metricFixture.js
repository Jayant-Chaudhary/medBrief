// Synthetic, in-memory Supabase-shaped queries. No provider or network access.
function metricFixture(tables = {}, failures = {}) {
  return { from(table) {
    let rows = [...(tables[table] || [])];
    const query = {};
    for (const method of ['select', 'eq', 'in', 'limit']) query[method] = () => query;
    query.order = (field, { ascending = true, nullsFirst = false } = {}) => {
      rows.sort((a, b) => {
        if (a[field] == null) return b[field] == null ? 0 : nullsFirst ? -1 : 1;
        if (b[field] == null) return nullsFirst ? 1 : -1;
        const comparison = a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0;
        return ascending ? comparison : -comparison;
      });
      return query;
    };
    const response = data => ({ data: failures[table] ? null : data, error: failures[table] || null });
    query.maybeSingle = async () => response(rows[0] || null);
    query.then = (resolve, reject) => Promise.resolve(response(rows)).then(resolve, reject);
    return query;
  } };
}
module.exports = { metricFixture };
