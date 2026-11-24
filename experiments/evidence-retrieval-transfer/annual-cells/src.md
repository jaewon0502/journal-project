# Annual Korean Industrial Standards (KS) counts

The Ministry of Trade, Industry and Resources (산업통상부) published the CSV 산업통상부_한국산업표준통계_연도별 한국산업표준(KS) 현황_20251231 through the Korean Public Data Portal. The portal lists the file as free and labels its reuse scope ‘이용허락범위 제한 없음’. It lists 2026-08-20 as its modification date. The CSV was downloaded from the public file-data page on 2026-11-25 KST. [Original file and reuse information](https://www.data.go.kr/data/15065278/fileData.do)

The original download was 815 bytes (SHA-256 `b9a96b8a3f2c331eb6b86873e6d7f44e6310f579be34aa4b65bef73ecded2e50`). It decodes as CP949 and has one header and 26 annual records spanning 2000–2025. The excerpt uses original CSV line 1 and lines 24–26, covering 2022–2024. It preserves all six column names, original positions and digits. The CSV prints no unit suffix or thousands separator. The metrics count standards. The questions use the Korean counting unit ‘종’.

The Korean Agency for Technology and Standards (국가기술표준원) separately displays the same figures for all 15 metric cells in those three years. Its rendered table groups thousands with commas and labels the last column ‘유효KS(종)’. The two official displays differ for 2025, outside this excerpt. [Agency annual table](https://standard.go.kr/KSCI/stats/searchStandardStatsList.do?menuId=521&topMenuId=502)

## Answer locations

Coordinates in the excerpt start at 1 and include the header and year column.

| Case | Year | Original CSV field | Verified result |
| --- | --- | --- | --- |
| ks-01 | 2022 | 제정 | 356, excerpt row 2 column 2 |
| ks-02 | 2023 | 폐지 | 143, excerpt row 3 column 5. The draft's 130 is the 2022 value in the same column. |
| ks-03 | 2024 | 보유표준수 | 22272, excerpt row 4 column 6 |
| ks-04 | 2023 | 개정 | 1526, excerpt row 3 column 3 |
| ks-05 | 1999 | 제정 | No matching year in the original CSV or the excerpt. |
| ks-06 | 2024 | 제정 | The table counts all newly established standards together. It gives no breakdown by proposer or business size. |

The questions and expected answers were written from the published data before running a project retrieval method. The pool measures whether the supplied table contains a cell that answers each question.
