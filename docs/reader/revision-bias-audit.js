/* Count precisely what the cited passages support about agreement on a bias improvement. */
(function (root) {
  'use strict';
  const node = typeof module === 'object' && !!module.exports;
  const evidence = node ? require('./revision-bias-evidence.js') : root.JournalRevisionBiasEvidence;
  const workspace = node ? require('./workspace-snapshot.js') : root.JournalWorkspaceSnapshot;
  const series = node ? require('./revision-series.js') : root.JournalRevisionSeries;

  const categories = ['aligned', 'different', 'unresolved'];
  function together(values) {
    if (values.includes('different')) return 'different';
    return values.every(value => value === 'aligned') ? 'aligned' : 'unresolved';
  }
  function article(joint, snapshots) {
    const counts = {aligned:0, different:0, unresolved:0};
    const rows = joint.dimensions.map(dimension => {
      const {id} = dimension;
      const ratings = snapshots.map(pair => pair.map(view => view.assessment.bias.items.find(item => item.id === id)?.rating));
      const sameEdition = [0, 1].map(role => evidence.compare(ratings[0][role],ratings[1][role],
        snapshots[0][role],snapshots[1][role],id).category);
      const sourcesAcross = snapshots.map(([before,after], editor) =>
        evidence.compareSources(ratings[editor][0],ratings[editor][1],before,after,id).category);
      const category = together([...sameEdition,...sourcesAcross]);
      const improved = dimension.first.change === 'improved' && dimension.second.change === 'improved';
      if (improved) counts[category]++;
      return {id, title:dimension.title, improved, sameEdition, sourcesAcross, category};
    });
    return {rows, counts};
  }
  async function audit(records, archives) {
    const verification = node ? require('./correction-series-audit.js') : root.JournalCorrectionSeriesAudit;
    const report = series.summarize(records);
    const selected = new Set(records.filter(record => record.version === series.currentVersion).map(record => series.reviewId(record)));
    const result = {articles:report.articleCount, improved:report.improved.numerator, aligned:0, different:0, unresolved:0,
      unopened:report.improved.numerator};
    const checked = await verification.inspectArchives(selected, archives, ({pair, joint}) => {
      const snapshots = pair.map(editor => [editor.before, editor.after].map(work => workspace.read(work)));
      const {counts} = article(joint, snapshots);
      for (const category of categories) {
        result[category] += counts[category];
        result.unopened -= counts[category];
      }
    });
    return {...result, ...checked};
  }
  const api = Object.freeze({article, audit});
  if (node) module.exports = api;
  else root.JournalRevisionBiasAudit = api;
})(globalThis);
