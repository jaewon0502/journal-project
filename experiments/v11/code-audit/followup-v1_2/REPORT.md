# Independent frozen v1.2 audit: encoding bypass remains

Frozen manifest SHA-256: `b2b840e295405d298b9c5ba50a84ade1ccbb9ddfdb2ecfc8ceef63bf18c5d499`. All 45 listed files and two legacy dependencies match. Original and v1.1 freezes also remain unchanged. No frozen code or evidence was modified; no hidden confirmation was accessed.

## Confirmed failure

The new scanner processes bytes as if every JSON encoding were UTF-8, but the unchanged Python JSON decoder also accepts UTF-16 and UTF-32. For those encodings, a zero byte immediately following an escape byte consumes the scanner's `escaped` state. An escaped quote can then incorrectly toggle its `quoted` state. Subsequent array delimiters are ignored as apparent string content.

A complete, correctly bound final audit with one escaped-quote metadata string followed by an actual **65-container** nested metadata array:

- rejects under UTF-8, as required by the new 64-container limit;
- **mints and emits `verified`** under UTF-16, UTF-16BE, and UTF-32, violating that declared limit.

The larger variant `{"escape":"\\\"","deep":` followed by 10,000 nested arrays and closing delimiters passes the scanner and escapes `emit` as **uncaught `RecursionError`**. Measured sizes are 40,050 bytes for UTF-16, 40,048 for UTF-16BE, and 80,100 for UTF-32, all below the 2 MiB input bound. UTF-8 correctly rejects and returns the fixed failure object.

See `checks.py` for the exact byte construction and `results.json` for independently reproduced outcomes. The encoding contract did not prohibit these raw encodings in v1.2, and the pinned decoder accepts them. This is a demonstrated resource-bound and structured-failure defect, not a semantic-resolution or false patch-application claim. No implementation fix was made here.

## Passing coverage kept separate

- **16 native tests pass**: nine existing receipt tests, five nesting tests, and two size-bound tests. The costly 30,000-finding size case was not redundantly rerun; its changed rejection contract was independently established in v1.1.
- Genuine near/exact 2 MiB boundaries still round-trip; oversized constructed receipts reject before writes.
- UTF-8 quoted brackets, escaped quotes with odd/even slash runs, and literal Unicode-escape text are handled correctly.
- Invalid leading closers cannot offset later excessive nesting.
- An unrelated programming `RecursionError` remains visible; the patch does not broadly swallow programming errors.
- The exact frozen v1.2 was separately bundled through the documented portable intake. Ten synthetic state/language cases have identical inputs, receipt bytes, and annotations versus the original loader (`../../portable/parity-v1_2.json`). This parity does not cure the encoding defect.

The v1.2 failure remains explicit and unfixed in this frozen artifact. Any later UTF-8-only repair requires a separate contract and audit; it must not replace these failure results.
