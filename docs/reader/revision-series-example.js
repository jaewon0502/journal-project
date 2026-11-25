/* Blind revision exports from the synthetic birth-statistics and library-hours browser exercises. */
// In the incomplete exercise the original ratings are identical. Hide selected
// revised ratings in a new score-only record: the full exercise remains available.
globalThis.JournalPartialRevisionExample = function () {
  return globalThis.JournalRevisionSeriesExample.map(({name, evidenceExample, record}) => {
    const library = evidenceExample === 'library';
    const dimensions = record.dimensions.map(({id, first, second}) => {
      const hideBoth = library && (id === 'framing' || id === 'omission');
      const hideFirst = hideBoth || (!library && id === 'framing');
      return {id, first:{before:first.before, after:hideFirst ? null : first.after},
        second:{before:second.before, after:hideBoth ? null : second.after}};
    });
    return {name, record:{format:record.format, version:1, demo:true, before:{...record.before},
      after:{...record.after}, dimensions}};
  });
};

globalThis.JournalRevisionSeriesExample = [
  {
    name: "출생 통계 연습 기사",
    record: {
      format: "journal-revision-series-record", version: 3, demo: true,
      factMatches: [],
      before: {
        articleSha256: "f547c62441edde7a41887552eb5f6d6efe02b98ea3ee52fefe0aef7393e98a87",
        sourcesSha256: "1647c730022bcee65e2d0d742c95bfbf34294930f708d249beec09ea5a54f625"
      },
      after: {
        articleSha256: "309afcb6d7d32208396b14d1cf16e2ed2def3963d5af578c3e4f94dc97b6be44",
        sourcesSha256: "1647c730022bcee65e2d0d742c95bfbf34294930f708d249beec09ea5a54f625"
      },
      dimensions: [
        {"id": "wording", "first": {"before": null, "after": null}, "second": {"before": null, "after": null}},
        {"id": "framing", "first": {"before": 2, "after": 0}, "second": {"before": 2, "after": 2}},
        {"id": "omission", "first": {"before": null, "after": null}, "second": {"before": null, "after": null}},
        {"id": "standards", "first": {"before": null, "after": null}, "second": {"before": null, "after": null}}
      ],
      facts: {
        before: [
          {"outcome": "contradicted", "flag": "article"},
          {"outcome": "pending", "flag": "none"},
          {"outcome": "pending", "flag": "none"},
          {"outcome": "pending", "flag": "none"},
          {"outcome": "pending", "flag": "none"},
          {"outcome": "pending", "flag": "none"}
        ],
        after: [
          {"outcome": "supported", "flag": "none"},
          {"outcome": "pending", "flag": "none"},
          {"outcome": "pending", "flag": "none"},
          {"outcome": "pending", "flag": "none"},
          {"outcome": "pending", "flag": "none"},
          {"outcome": "pending", "flag": "none"}
        ]
      }
    }
  },
  {
    name: "도서관 운영 연습 기사",
    evidenceExample: "library",
    record: {
      format: "journal-revision-series-record", version: 5, demo: true,
      factMatches: [[1, null]],
      factContext: {beforeCore: [0, 0, 0], afterCore: [0, 0, 0], matches: [[2, 2]]},
      before: {
        articleSha256: "c34e8e647282edeb0eb6df2402a07e63e3c37a37c8269924bd4bd592134fe4b6",
        sourcesSha256: "a0b010359825ef61737e7b9f4d4ddda9fd3a4cd138303bdb79aca5933a3dc8b8"
      },
      after: {
        articleSha256: "bb60c470353193d70bf18a89f979e9f00483230f38b26047cefa392e1a495499",
        sourcesSha256: "a0b010359825ef61737e7b9f4d4ddda9fd3a4cd138303bdb79aca5933a3dc8b8"
      },
      dimensions: [
        {"id": "wording", "first": {"before": 2, "after": 0}, "second": {"before": 3, "after": 1}},
        {"id": "framing", "first": {"before": 3, "after": 1}, "second": {"before": 2, "after": 0}},
        {"id": "omission", "first": {"before": 2, "after": 0}, "second": {"before": 2, "after": 1}},
        {"id": "standards", "first": {"before": null, "after": null}, "second": {"before": null, "after": null}}
      ],
      facts: {
        before: [
          {"outcome": "contradicted", "flag": "article"},
          {"outcome": "supported", "flag": "none"},
          {"outcome": "pending", "flag": "quote"}
        ],
        after: [
          {"outcome": "supported", "flag": "none"},
          {"outcome": "supported", "flag": "none"},
          {"outcome": "pending", "flag": "quote"}
        ]
      }
    }
  }
];
